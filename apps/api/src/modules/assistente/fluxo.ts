import type { UsoDoProvedor } from "./custo.service.js";
import { AppError } from "../../lib/errors.js";
import { limparTituloDaFonte } from "../web/pagina.service.js";

/**
 * A leitura do `text/event-stream` do provedor.
 *
 * **Escrito contra a forma medida, não contra a lembrada** (captura real de
 * 2026-09-23, com `openai/gpt-oss-20b`). Três fatos que a documentação não
 * deixa óbvios e que mudam o código:
 *
 * 1. Os `tool_calls` chegam **fatiados por `index`**. O primeiro pedaço traz
 *    `id`, `type` e `function.name` com `arguments: ""`; os seguintes trazem
 *    só `index` e mais um naco de `function.arguments`. Quem esperar um objeto
 *    inteiro por chunk recebe argumentos truncados.
 * 2. O `usage` **não vem no chunk do `finish_reason`**. Vem num chunk
 *    seguinte, que repete o `finish_reason`. Parar no primeiro faria toda
 *    chamada do chat gravar custo `desconhecido` — o terceiro degrau do
 *    INV-48 —, e o teto diário viraria decorativo em silêncio.
 * 3. `delta.content` vem `""` enquanto o modelo raciocina; o raciocínio vai
 *    num campo `reasoning` à parte. Ele é **cobrado** (`reasoning_tokens`) e
 *    não é resposta — por isso não entra no texto.
 *
 * **As citações da busca na web (Etapa G) não foram capturadas ainda.** A
 * forma abaixo é a documentada pelo OpenRouter para o plugin `web` —
 * `annotations: [{ type: "url_citation", url_citation: { url, title } }]` —, e
 * a leitura aceita os dois lugares em que ela pode vir: no `delta` de um chunk
 * ou numa `message` inteira no chunk final. Anotação que não case com a forma
 * é ignorada, nunca derruba o passo: a resposta vale mais que a citação.
 */

interface AnotacaoDoProvedor {
  type?: unknown;
  url_citation?: { url?: unknown; title?: unknown };
}

interface PedacoDeToolCall {
  index?: unknown;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface ChunkDoProvedor {
  id?: unknown;
  model?: unknown;
  usage?: UsoDoProvedor;
  error?: { message?: unknown; code?: unknown };
  choices?: {
    delta?: {
      content?: unknown;
      tool_calls?: PedacoDeToolCall[];
      annotations?: unknown;
    };
    message?: { annotations?: unknown };
    finish_reason?: unknown;
  }[];
}

export interface PedidoDeFerramenta {
  /// O `tool_call_id` do provedor. É ele que amarra o resultado ao pedido no
  /// turno seguinte; sem ele o histórico é recusado.
  id: string;
  nome: string;
  /// JSON **como string**, exatamente como veio. A validação é de quem executa,
  /// com o schema de `packages/shared`.
  argumentos: string;
}

/** Uma página citada pela busca na web do provedor. */
export interface Citacao {
  url: string;
  title: string;
}

export interface PassoDoProvedor {
  texto: string;
  /// As citações da busca na web, na ordem em que vieram e sem repetir URL.
  citacoes: Citacao[];
  pedidos: PedidoDeFerramenta[];
  usage: UsoDoProvedor | undefined;
  modelUsed: string | null;
  generationId: string | null;
}

/**
 * Lê o fluxo, entregando cada pedaço de texto conforme chega e devolvendo o
 * passo inteiro no fim.
 *
 * Gerador com valor de retorno de propósito: os deltas precisam sair na hora
 * (é o que o usuário vê), e o acumulado só existe depois do `[DONE]`.
 */
export async function* lerFluxo(
  resposta: Response,
): AsyncGenerator<string, PassoDoProvedor, undefined> {
  const corpo = resposta.body;
  if (!corpo) {
    throw new AppError(502, "RESPOSTA_INVALIDA", "O provedor de IA não devolveu corpo.");
  }

  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  /// O que sobrou de um pedaço que chegou cortado no meio de uma linha. TCP não
  /// respeita fronteira de evento.
  let resto = "";

  let texto = "";
  const porIndice = new Map<number, PedidoDeFerramenta>();
  let usage: UsoDoProvedor | undefined;
  let modelUsed: string | null = null;
  let generationId: string | null = null;
  let terminou = false;
  const citacoes = new Map<string, Citacao>();

  /// Só `http`/`https`: a citação vira link clicável na tela e na saída da
  /// rotina, e um `javascript:` vindo do provedor não pode chegar lá. O título
  /// passa pela mesma limpeza do de `open_page`: o trecho da busca pode trazer
  /// `U+0001`/`U+0002`, que são o destaque da busca do Yu-book (INV-10).
  const anotar = (anotacoes: unknown) => {
    if (!Array.isArray(anotacoes)) return;
    for (const anotacao of anotacoes as AnotacaoDoProvedor[]) {
      if (anotacao?.type !== "url_citation") continue;
      const url = anotacao.url_citation?.url;
      if (typeof url !== "string" || url.length > 2_000 || !/^https?:\/\//i.test(url)) continue;
      if (citacoes.has(url)) continue;
      const titulo = anotacao.url_citation?.title;
      citacoes.set(url, {
        url,
        title: typeof titulo === "string" ? limparTituloDaFonte(titulo) : "",
      });
    }
  };

  try {
    while (!terminou) {
      const { done, value } = await leitor.read();
      if (done) break;

      resto += decodificador.decode(value, { stream: true });
      /// Eventos são separados por linha em branco. O último naco fica no
      /// `resto` porque pode estar pela metade.
      const eventos = resto.split("\n\n");
      resto = eventos.pop() ?? "";

      for (const evento of eventos) {
        const linha = evento
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!linha) continue;

        const conteudo = linha.slice("data:".length).trim();
        if (conteudo === "[DONE]") {
          terminou = true;
          break;
        }

        let chunk: ChunkDoProvedor;
        try {
          chunk = JSON.parse(conteudo) as ChunkDoProvedor;
        } catch {
          /// O provedor manda comentários SSE (`: keep-alive`) e pode mandar
          /// linha parcial. Nenhum dos dois é defeito nosso.
          continue;
        }

        /// Erro **depois** do 200. Antes do primeiro byte ele vem como status
        /// HTTP e `abrirNoProvedor` já o traduziu; aqui não há mais status.
        if (chunk.error) {
          const mensagem =
            typeof chunk.error.message === "string"
              ? chunk.error.message.slice(0, 200)
              : "O provedor interrompeu a resposta.";
          throw new AppError(502, "RESPOSTA_INVALIDA", mensagem);
        }

        if (typeof chunk.model === "string") modelUsed = chunk.model;
        if (typeof chunk.id === "string") generationId = chunk.id;
        /// Sem `??=`: o chunk final é quem traz o `usage`, e sobrescrever é o
        /// comportamento certo caso venha mais de um.
        if (chunk.usage) usage = chunk.usage;

        anotar(chunk.choices?.[0]?.message?.annotations);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        anotar(delta.annotations);

        if (typeof delta.content === "string" && delta.content.length > 0) {
          texto += delta.content;
          yield delta.content;
        }

        for (const pedaco of delta.tool_calls ?? []) {
          const indice = typeof pedaco.index === "number" ? pedaco.index : 0;
          const atual = porIndice.get(indice) ?? { id: "", nome: "", argumentos: "" };

          if (typeof pedaco.id === "string") atual.id = pedaco.id;
          if (typeof pedaco.function?.name === "string") atual.nome = pedaco.function.name;
          if (typeof pedaco.function?.arguments === "string") {
            /// Concatena: é aqui que mora o fato 1 do cabeçalho.
            atual.argumentos += pedaco.function.arguments;
          }

          porIndice.set(indice, atual);
        }
      }
    }
  } finally {
    /// Cancela o que sobrou. Sem isto, sair por erro no meio deixa a conexão
    /// com o provedor pendurada até o orçamento de tempo estourar.
    await leitor.cancel().catch(() => undefined);
  }

  /// Pela ordem de `index`, que é a ordem em que o modelo pediu.
  const pedidos = [...porIndice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pedido]) => pedido)
    .filter((pedido) => pedido.nome);

  return { texto, citacoes: [...citacoes.values()], pedidos, usage, modelUsed, generationId };
}
