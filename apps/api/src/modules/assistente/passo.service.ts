import { z } from "zod";
import { CUSTO_ESTIMADO_BUSCA_MICROS, MAX_RESULTADOS_DA_BUSCA } from "@yu-book/shared";
import type { AiCallUsage, AiFavorite, AiTask } from "@yu-book/shared";
import { AppError } from "../../lib/errors.js";
import {
  comBusca,
  custoDaResposta,
  estimarComBusca,
  garantirTeto,
  MAX_SAIDA_TOKENS,
  registrarUso,
  tokensAproximados,
} from "./custo.service.js";
import type { CustoApurado } from "./custo.service.js";
import type { FerramentaParaProvedor } from "./ferramentas.service.js";
import { lerFluxo } from "./fluxo.js";
import type { Citacao, PedidoDeFerramenta } from "./fluxo.js";
import { abrirNoProvedor, politicaDeDados } from "./openrouter.service.js";
import type { PreferenciaDeIa } from "./preferencias.service.js";

/**
 * Um passo com o provedor: conferir o teto, abrir o fluxo, repassar os
 * deltas, apurar o custo e gravar o uso.
 *
 * Extraído de `conversar()` na Etapa E, quando a rotina virou a segunda
 * superfície com laço de ferramenta. O chat e o motor de rotina chamam
 * **este** passo, e é por isso que o INV-47 vale para os dois por construção:
 * `garantirTeto` roda aqui dentro, antes do `fetch`, em toda chamada. Quem
 * precisa de um corte a mais — o teto por execução da rotina — o passa em
 * `tetoExtra`, que roda no mesmo ponto, também antes de qualquer conexão.
 *
 * O que **não** mora aqui é o que difere entre as superfícies: o que gravar
 * de cada fala, o que fazer com os pedidos de ferramenta e como transformar
 * falha em evento. O passo lança; quem chama traduz.
 */

/// Geração de texto é lenta, e aqui ela acontece até cinco vezes — o orçamento
/// é **por passo**, não pela mensagem inteira.
const ORCAMENTO_MS = 60_000;
const FOLGA_SAIDA_TOKENS = 512;
/// Abaixo disto não sobra resposta: o histórico já não cabe no modelo.
const MINIMO_SAIDA_TOKENS = 256;

export type MensagemDoProvedor =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function charsDe(mensagens: MensagemDoProvedor[]): number {
  return mensagens.reduce((soma, m) => soma + m.content.length, 0);
}

/**
 * Quanto o passo deve custar, para o teto decidir antes de conectar (INV-47).
 * Com a busca na web, soma a tarifa dela **e** os tokens dos resultados que o
 * provedor injeta no contexto desta mesma chamada (`estimarComBusca`): um teto
 * que só olhasse as mensagens deixaria passar a chamada que o estoura.
 * `buscaNaWeb` sem valor padrão: esquecê-la é erro de compilação, não uma
 * estimativa que perde a busca calada.
 */
export function estimarPasso(
  modelo: AiFavorite,
  mensagens: MensagemDoProvedor[],
  buscaNaWeb: boolean,
): number {
  return estimarComBusca(modelo, charsDe(mensagens), MAX_SAIDA_TOKENS, buscaNaWeb);
}

/**
 * O plugin de busca. `engine: "exa"` fixa o motor para que a tarifa de
 * `CUSTO_ESTIMADO_BUSCA_MICROS` valha: sem ele o OpenRouter escolhe, e a busca
 * nativa de alguns modelos tem outro preço. O campo `engine` e o preço do Exa
 * vêm da documentação do OpenRouter e não foram conferidos com uma chamada
 * real — a conferir em produção junto do custo (ver `comBusca`).
 */
const PLUGIN_DA_BUSCA = { id: "web", engine: "exa", max_results: MAX_RESULTADOS_DA_BUSCA };

export function paraToolCalls(pedidos: PedidoDeFerramenta[]): unknown[] {
  return pedidos.map((p) => ({
    id: p.id,
    type: "function",
    function: { name: p.nome, arguments: p.argumentos },
  }));
}

/** O que dizer ao modelo sobre a própria chamada malfeita. */
export function motivoDaFalha(erro: unknown): string {
  if (erro instanceof z.ZodError) {
    return erro.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join("; ");
  }
  if (erro instanceof SyntaxError) return "os argumentos não são JSON válido";
  if (erro instanceof AppError) return erro.message;
  return "falha ao executar";
}

/**
 * Quanto de saída cabe, ou `null` quando o histórico já não deixa espaço para
 * uma resposta. Quem chama decide a frase — "a conversa já não cabe" no chat,
 * "o rascunho já não cabe" na rotina.
 */
export function saidaDisponivel(
  modelo: AiFavorite,
  mensagens: MensagemDoProvedor[],
): { maxTokens: number; tokensEntrada: number } | { maxTokens: null; tokensEntrada: number } {
  const tokensEntrada = tokensAproximados(charsDe(mensagens));
  const maxTokens = Math.min(
    MAX_SAIDA_TOKENS,
    modelo.contextLength - tokensEntrada - FOLGA_SAIDA_TOKENS,
  );
  return maxTokens < MINIMO_SAIDA_TOKENS
    ? { maxTokens: null, tokensEntrada }
    : { maxTokens, tokensEntrada };
}

/** A que o uso gravado se prende. Um ou outro, nunca os dois. */
export type VinculoDoUso = { conversationId: string } | { runId: string };

export interface PedidoDoPasso {
  userId: string;
  preferencia: PreferenciaDeIa;
  modelo: AiFavorite;
  mensagens: MensagemDoProvedor[];
  /// Vazio, o campo `tools` sai da requisição: lista vazia é recusada por
  /// alguns provedores, e o modelo sem ferramenta não tem o que pedir.
  catalogo: FerramentaParaProvedor[];
  maxTokens: number;
  task: AiTask;
  vinculo: VinculoDoUso;
  /**
   * Leva o plugin de busca na web do provedor (Etapa G). Quem chama liga só na
   * **primeira** chamada de cada mensagem do chat e de cada passo de rotina:
   * as voltas do laço de ferramenta não buscam de novo, porque cada busca é
   * cobrada. Sem valor padrão, pelo mesmo motivo de `estimarPasso`.
   */
  buscaNaWeb: boolean;
  /**
   * Um segundo corte, conferido **depois** do teto diário e antes de qualquer
   * conexão, com a mesma estimativa. Lança para recusar. É o teto por
   * execução da rotina; o chat não tem.
   */
  tetoExtra?: (estimativaMicros: number) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface ResultadoDoPasso {
  texto: string;
  /// As páginas que a busca na web citou. Vazio sem busca.
  citacoes: Citacao[];
  pedidos: PedidoDeFerramenta[];
  usage: AiCallUsage;
  custo: CustoApurado;
  modelUsed: string | null;
  generationId: string | null;
  durationMs: number;
}

/**
 * O passo. Gera os deltas de texto e devolve o passo inteiro no fim.
 *
 * **Lança** em três situações, e as três deixam trilha diferente:
 *
 * - teto (diário ou o extra): antes de qualquer conexão, **sem** linha de uso
 *   — nada foi chamado, nada foi pago (INV-47);
 * - falha do provedor ou do fluxo: com linha de uso `ok: false`, custo
 *   `desconhecido` — a chamada existiu;
 * - cancelamento por `signal`: idem, com `errorCode` `CANCELADA`. O erro sobe
 *   cru; quem cancelou confere `signal.aborted`.
 */
export async function* passoNoProvedor(
  pedido: PedidoDoPasso,
): AsyncGenerator<string, ResultadoDoPasso, undefined> {
  const { userId, preferencia, modelo, mensagens, catalogo } = pedido;

  const estimativa = estimarPasso(modelo, mensagens, pedido.buscaNaWeb);
  const { localDay } = await garantirTeto(userId, preferencia, estimativa);
  if (pedido.tetoExtra) await pedido.tetoExtra(estimativa);

  const inicio = Date.now();
  const registro = {
    userId,
    task: pedido.task,
    modelId: modelo.id,
    localDay,
    ...pedido.vinculo,
  };

  let resultado;
  try {
    const resposta = await abrirNoProvedor("/chat/completions", {
      metodo: "POST",
      orcamentoMs: ORCAMENTO_MS,
      signal: pedido.signal,
      corpo: {
        model: modelo.id,
        max_tokens: pedido.maxTokens,
        stream: true,
        /// Sem isto o `usage` não vem, e todo passo gravaria custo
        /// `desconhecido` — o teto viraria decorativo (INV-48).
        stream_options: { include_usage: true },
        messages: mensagens,
        ...(catalogo.length > 0 && { tools: catalogo }),
        ...(pedido.buscaNaWeb && {
          plugins: [PLUGIN_DA_BUSCA],
        }),
        ...politicaDeDados(preferencia.allowTraining),
      },
    });

    const fluxo = lerFluxo(resposta);
    while (true) {
      const pedaco = await fluxo.next();
      if (pedaco.done) {
        resultado = pedaco.value;
        break;
      }
      yield pedaco.value;
    }
  } catch (erro) {
    /// Com a busca ligada, ela pode ter sido cobrada mesmo assim: o provedor
    /// busca antes de gerar, e a falha pode vir depois (no meio do fluxo, por
    /// cancelamento, por tempo). Esta linha grava 0 e `desconhecido` mesmo
    /// então — não há `usage` para ler, e inventar a tarifa aqui tiraria a
    /// chamada da contagem de "sem custo", que é o sinal do INV-48. O gasto
    /// real, se houve, fica no painel do OpenRouter e fora do teto.
    await registrarUso({
      ...registro,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      costSource: "desconhecido",
      durationMs: Date.now() - inicio,
      ok: false,
      errorCode: pedido.signal?.aborted
        ? "CANCELADA"
        : erro instanceof AppError
          ? erro.code
          : "INTERNAL_ERROR",
    });
    throw erro;
  }

  const durationMs = Date.now() - inicio;
  const custo = comBusca(
    custoDaResposta(resultado.usage, modelo),
    pedido.buscaNaWeb,
    CUSTO_ESTIMADO_BUSCA_MICROS,
  );
  await registrarUso({
    ...registro,
    modelUsed: resultado.modelUsed,
    generationId: resultado.generationId,
    durationMs,
    ok: true,
    ...custo,
  });

  return {
    texto: resultado.texto,
    citacoes: resultado.citacoes,
    pedidos: resultado.pedidos,
    usage: {
      modelId: modelo.id,
      modelUsed: resultado.modelUsed,
      promptTokens: custo.promptTokens,
      completionTokens: custo.completionTokens,
      costMicros: custo.costMicros,
      costSource: custo.costSource,
    },
    custo,
    modelUsed: resultado.modelUsed,
    generationId: resultado.generationId,
    durationMs,
  };
}
