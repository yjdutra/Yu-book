import type Anthropic from "@anthropic-ai/sdk";
import type { UsoAnthropic } from "@yu-book/shared";
import { limparTituloDaFonte } from "../web/pagina.service.js";
import { clienteAnthropic, traduzirErroAnthropic } from "./anthropic.service.js";
import type { FerramentaParaProvedor } from "./ferramentas.service.js";
import type { Citacao, PedidoDeFerramenta } from "./fluxo.js";
import type { MensagemDoProvedor } from "./passo.service.js";

/**
 * Um passo de geração na API da Anthropic — o par de `fluxo.ts` para o
 * segundo provedor (docs/plano-provedor-anthropic.md, F2).
 *
 * **O formato interno não muda.** O chat, a rotina e o histórico gravado falam
 * `MensagemDoProvedor`, a forma do OpenRouter; a conversão para a da Anthropic
 * acontece aqui, na borda, e só aqui:
 *
 * - as mensagens `system` vão para o parâmetro `system`, que a Anthropic separa;
 * - `tool_calls` viram blocos `tool_use`, com os argumentos **parseados** — a
 *   Anthropic quer objeto, o OpenRouter manda string;
 * - mensagens `tool` seguidas viram **um** `user` com um bloco `tool_result`
 *   por chamada. Separá-las em várias mensagens é aceito pela API e ensina o
 *   modelo a parar de pedir ferramentas em paralelo.
 *
 * **Pensamento só dentro do laço.** Os modelos atuais pensam sempre, e o bloco
 * `thinking` de um passo com ferramenta precisa voltar intacto no passo
 * seguinte. O passo devolve o conteúdo nativo (`nativo`), o laço o guarda na
 * mensagem em memória, e a conversão o reenvia como veio. O histórico gravado
 * não o tem: a fala de um turno antigo volta só com texto e `tool_use`. Tirar
 * **todos** os blocos de pensamento é forma válida para a API; reenviar parte
 * deles, editados, é o que ela recusa — e reescrever o meio do histórico é o
 * que invalida o que vem depois.
 */

/// O Haiku 4.5 recusa `output_config.effort` com 400. Os demais modelos da
/// tabela de preços aceitam.
const SEM_ESFORCO = new Set(["claude-haiku-4-5"]);

/**
 * Esforço baixo em todas as chamadas do Yu-book. Os modelos atuais pensam
 * sempre (no Opus 5.5 não dá para desligar), o pensamento é cobrado como saída
 * e conta dentro de `max_tokens`. Buscar uma nota, formatar Markdown e anotar
 * uma tarefa não pedem raciocínio longo; no padrão (`medium` no Opus 5.5,
 * `high` no Sonnet 5.5) o pensamento comeria a resposta de 2 mil tokens.
 */
const ESFORCO = "low" as const;

/**
 * A ferramenta de busca do servidor. A variante com filtragem dinâmica
 * (`_20260209`) existe no Opus e no Sonnet desde a 4.6; Haiku e Fable ficam
 * na básica. `max_uses: 1` é o que mantém a estimativa do teto honesta: ela
 * conta **uma** busca por chamada, como o plugin do OpenRouter (INV-47).
 */
function ferramentaDeBusca(modelo: string): Anthropic.ToolUnion {
  return /^claude-(opus|sonnet)-/.test(modelo)
    ? { type: "web_search_20260209", name: "web_search", max_uses: 1 }
    : { type: "web_search_20250305", name: "web_search", max_uses: 1 };
}

function paraFerramenta(ferramenta: FerramentaParaProvedor): Anthropic.Tool {
  return {
    name: ferramenta.function.name,
    description: ferramenta.function.description,
    input_schema: ferramenta.function.parameters as Anthropic.Tool.InputSchema,
  };
}

/**
 * Os argumentos de um pedido de ferramenta como objeto. String que não é JSON
 * de objeto vira `{}`: a fala já foi gerada, e quem confere argumento é o
 * executor, com o schema de `packages/shared` — que devolve o erro ao modelo.
 */
function argumentosComoObjeto(argumentos: string): Record<string, unknown> {
  try {
    const valor: unknown = JSON.parse(argumentos || "{}");
    return valor !== null && typeof valor === "object" && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

interface ToolCallGravado {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** As mensagens do formato interno no formato da Anthropic. Exportada para o teste. */
export function paraAnthropic(mensagens: MensagemDoProvedor[]): {
  system: string | undefined;
  messages: Anthropic.MessageParam[];
} {
  const sistema: string[] = [];
  const messages: Anthropic.MessageParam[] = [];

  for (const mensagem of mensagens) {
    if (mensagem.role === "system") {
      sistema.push(mensagem.content);
      continue;
    }

    if (mensagem.role === "user") {
      messages.push({ role: "user", content: mensagem.content });
      continue;
    }

    if (mensagem.role === "tool") {
      const resultado: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: mensagem.tool_call_id,
        content: mensagem.content,
      };
      const anterior = messages.at(-1);
      /// Junta ao `user` anterior quando ele já é de resultados: são as
      /// respostas da mesma fala, e vão todas numa mensagem só.
      if (
        anterior?.role === "user" &&
        Array.isArray(anterior.content) &&
        anterior.content.every((b) => b.type === "tool_result")
      ) {
        anterior.content.push(resultado);
      } else {
        messages.push({ role: "user", content: [resultado] });
      }
      continue;
    }

    /// O compilador não estreita `"system" | "user"` pelos dois testes acima.
    if (mensagem.role !== "assistant") continue;

    /// Fala do assistente produzida neste mesmo laço: volta como veio, com o
    /// pensamento e os blocos da busca do servidor.
    if (mensagem.nativo) {
      messages.push({
        role: "assistant",
        content: mensagem.nativo as Anthropic.ContentBlockParam[],
      });
      continue;
    }

    const blocos: Anthropic.ContentBlockParam[] = [];
    if (mensagem.content.trim()) blocos.push({ type: "text", text: mensagem.content });
    for (const pedido of (mensagem.tool_calls ?? []) as ToolCallGravado[]) {
      if (typeof pedido.id !== "string" || typeof pedido.function?.name !== "string") continue;
      blocos.push({
        type: "tool_use",
        id: pedido.id,
        name: pedido.function.name,
        input: argumentosComoObjeto(
          typeof pedido.function.arguments === "string" ? pedido.function.arguments : "",
        ),
      });
    }
    /// Fala vazia é recusada pela API. O histórico já filtra a que perdeu todos
    /// os pedidos; esta guarda cobre o resto.
    if (blocos.length > 0) messages.push({ role: "assistant", content: blocos });
  }

  return { system: sistema.length ? sistema.join("\n\n") : undefined, messages };
}

export interface PedidoNaAnthropic {
  modelo: string;
  mensagens: MensagemDoProvedor[];
  catalogo: FerramentaParaProvedor[];
  maxTokens: number;
  buscaNaWeb: boolean;
  /**
   * Cache automático no último bloco. Vale no laço do chat e da rotina, onde
   * cada volta lê o que a anterior gravou; no formatar é sobretaxa pura — a
   * escrita custa 1,25× a entrada e a nota nunca é relida igual.
   */
  cache: boolean;
  orcamentoMs: number;
  signal?: AbortSignal;
}

export interface PassoDaAnthropic {
  texto: string;
  citacoes: Citacao[];
  pedidos: PedidoDeFerramenta[];
  uso: UsoAnthropic;
  modelUsed: string | null;
  generationId: string | null;
  /// O conteúdo da fala como a Anthropic o devolveu, para reenviar no passo
  /// seguinte do mesmo laço.
  nativo: Anthropic.ContentBlockParam[];
  /// `refusal` e `max_tokens` são decisão de quem chama: o passo já foi pago.
  parou: Anthropic.StopReason | null;
}

/// Só `http`/`https`, e sem repetir URL — a mesma regra das citações do
/// OpenRouter em `fluxo.ts`, pelo mesmo motivo: a citação vira link na tela.
function citacoesDe(conteudo: Anthropic.ContentBlock[]): Citacao[] {
  const porUrl = new Map<string, Citacao>();
  for (const bloco of conteudo) {
    if (bloco.type !== "text") continue;
    for (const citacao of bloco.citations ?? []) {
      if (citacao.type !== "web_search_result_location") continue;
      const { url } = citacao;
      if (url.length > 2_000 || !/^https?:\/\//i.test(url) || porUrl.has(url)) continue;
      porUrl.set(url, { url, title: citacao.title ? limparTituloDaFonte(citacao.title) : "" });
    }
  }
  return [...porUrl.values()];
}

/**
 * O passo: abre o fluxo, entrega cada pedaço de texto conforme chega e devolve
 * o passo inteiro no fim. Erro do SDK sobe traduzido para os códigos estáveis;
 * cancelamento sobe cru.
 */
export async function* fluxoNaAnthropic(
  pedido: PedidoNaAnthropic,
): AsyncGenerator<string, PassoDaAnthropic, undefined> {
  const { system, messages } = paraAnthropic(pedido.mensagens);
  const tools: Anthropic.ToolUnion[] = pedido.catalogo.map(paraFerramenta);
  if (pedido.buscaNaWeb) tools.push(ferramentaDeBusca(pedido.modelo));

  let final: Anthropic.Message;
  try {
    const fluxo = clienteAnthropic({ orcamentoMs: pedido.orcamentoMs }).messages.stream(
      {
        model: pedido.modelo,
        max_tokens: pedido.maxTokens,
        messages,
        ...(system !== undefined && { system }),
        ...(tools.length > 0 && { tools }),
        ...(!SEM_ESFORCO.has(pedido.modelo) && { output_config: { effort: ESFORCO } }),
        /// Cache automático no último bloco: o `system` e as ferramentas são os
        /// mesmos a cada passo do laço, e cada volta lê o que a anterior gravou.
        ...(pedido.cache && { cache_control: { type: "ephemeral" as const } }),
      },
      { signal: pedido.signal },
    );
    for await (const evento of fluxo) {
      if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
        yield evento.delta.text;
      }
    }
    final = await fluxo.finalMessage();
  } catch (erro) {
    throw traduzirErroAnthropic(erro);
  }

  const texto = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  /// Só os `tool_use` — os `server_tool_use` da busca já rodaram na Anthropic.
  const pedidos = final.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, nome: b.name, argumentos: JSON.stringify(b.input ?? {}) }));

  return {
    texto,
    citacoes: citacoesDe(final.content),
    pedidos,
    uso: {
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      webSearches: final.usage.server_tool_use?.web_search_requests ?? 0,
    },
    modelUsed: final.model,
    generationId: final.id,
    nativo: final.content as Anthropic.ContentBlockParam[],
    parou: final.stop_reason,
  };
}
