import type { AiCostSource, AiTask, AiUsageSummary } from "@yu-book/shared";
import { diaLocal, microsParaDolares } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";

/**
 * Registro de custo e teto diário.
 *
 * Este módulo **não** lê a preferência do usuário: recebe os dois campos de que
 * precisa. É o que impede um ciclo de import com `preferencias.service.ts`, que
 * consulta o resumo daqui para montar a tela de ajustes.
 */

/// Heurística, e declarada como tal: quatro caracteres por token é a média
/// grosseira do inglês e do português. Serve para **decidir um corte**, não
/// para cobrar — quem cobra é o provedor, e o custo real dele é gravado depois.
const CHARS_POR_TOKEN = 4;

/** Tokens aproximados de um texto, pela heurística acima. */
export function tokensAproximados(chars: number): number {
  return Math.ceil(chars / CHARS_POR_TOKEN);
}

export interface TetoDoUsuario {
  timezone: string;
  dailyCapMicros: number;
}

interface PrecoDoModelo {
  promptMicros: number;
  completionMicros: number;
}

/** µUSD por milhão → µUSD do pedido. */
function custoDeTokens(tokens: number, microsPorMilhao: number): number {
  return (tokens * microsPorMilhao) / 1_000_000;
}

function emDolares(micros: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(microsParaDolares(micros));
}

/**
 * Quanto o pedido deve custar, para o teto poder decidir **antes** de a chamada
 * existir. Arredonda para cima: na dúvida, o teto protege.
 */
export function estimarCustoMicros(
  preco: PrecoDoModelo,
  charsEntrada: number,
  maxTokensSaida: number,
): number {
  const tokensEntrada = tokensAproximados(charsEntrada);
  return Math.ceil(
    custoDeTokens(tokensEntrada, preco.promptMicros) +
      custoDeTokens(maxTokensSaida, preco.completionMicros),
  );
}

/**
 * O gasto de hoje, na janela do **usuário**.
 *
 * `localDay` é coluna gravada, não conta feita aqui: a soma tem que usar a
 * mesma fronteira de dia que a tela mostra, e o fuso do processo não é o do
 * operador — a API roda em UTC na Railway.
 */
export async function resumoDoDia(userId: string, timezone: string): Promise<AiUsageSummary> {
  const localDay = diaLocal(new Date(), timezone);

  const [soma, semCusto] = await Promise.all([
    prisma.aiUsage.aggregate({ where: { userId, localDay }, _sum: { costMicros: true } }),
    prisma.aiUsage.count({ where: { userId, localDay, costSource: "desconhecido" } }),
  ]);

  return {
    localDay,
    /// Sem nenhuma linha o `_sum` vem `null`, e é o caso do primeiro uso do dia.
    spentMicros: soma._sum.costMicros ?? 0,
    callsWithoutCostToday: semCusto,
  };
}

/**
 * Recusa antes de qualquer conexão sair.
 *
 * Devolve o resumo para quem chama não reler o banco, e porque `localDay` é o
 * que a linha de uso vai gravar — o dia do corte e o dia do registro precisam
 * ser o mesmo, mesmo que a chamada atravesse a meia-noite.
 */
export async function garantirTeto(
  userId: string,
  teto: TetoDoUsuario,
  estimativaMicros: number,
): Promise<AiUsageSummary> {
  const resumo = await resumoDoDia(userId, teto.timezone);

  if (resumo.spentMicros + estimativaMicros > teto.dailyCapMicros) {
    throw new AppError(
      402,
      "TETO_DIARIO_ATINGIDO",
      `Teto diário de IA atingido: já foram ${emDolares(resumo.spentMicros)} de ` +
        `${emDolares(teto.dailyCapMicros)} hoje. Ajuste o teto ou espere amanhã.`,
    );
  }

  return resumo;
}

export interface UsoDoProvedor {
  cost?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

export interface CustoApurado {
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  costSource: AiCostSource;
}

function inteiroNaoNegativo(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? Math.round(valor) : 0;
}

/**
 * A cascata de três degraus, e o degrau escolhido fica gravado.
 *
 * O terceiro é o perigoso: grava zero, e zero **não move o teto**. Um provedor
 * que parasse de informar tornaria o teto decorativo em silêncio — por isso
 * `desconhecido` é contado e mostrado na tela, em vez de virar só um log.
 */
export function custoDaResposta(uso: UsoDoProvedor | undefined, preco: PrecoDoModelo): CustoApurado {
  const promptTokens = inteiroNaoNegativo(uso?.prompt_tokens);
  const completionTokens = inteiroNaoNegativo(uso?.completion_tokens);

  /// O provedor informa `cost` em toda resposta, em dólares. É o caminho normal.
  const custo = uso?.cost;
  if (typeof custo === "number" && Number.isFinite(custo) && custo >= 0) {
    return {
      promptTokens,
      completionTokens,
      costMicros: Math.round(custo * 1_000_000),
      costSource: "provedor",
    };
  }

  if (promptTokens > 0 || completionTokens > 0) {
    return {
      promptTokens,
      completionTokens,
      costMicros: Math.ceil(
        custoDeTokens(promptTokens, preco.promptMicros) +
          custoDeTokens(completionTokens, preco.completionMicros),
      ),
      costSource: "estimado",
    };
  }

  return { promptTokens: 0, completionTokens: 0, costMicros: 0, costSource: "desconhecido" };
}

export interface RegistroDeUso extends CustoApurado {
  userId: string;
  task: AiTask;
  modelId: string;
  /// O que o provedor de fato usou. Sem isto, uma estimativa usaria o preço do
  /// modelo pedido quando o roteamento escolheu outro.
  modelUsed?: string | null;
  generationId?: string | null;
  durationMs: number;
  ok: boolean;
  errorCode?: string | null;
  localDay: string;
  noteId?: string | null;
}

/** Uma linha por chamada, **inclusive as que falharam** — é a trilha de auditoria. */
export async function registrarUso(registro: RegistroDeUso): Promise<void> {
  await prisma.aiUsage.create({
    data: {
      userId: registro.userId,
      task: registro.task,
      modelId: registro.modelId,
      modelUsed: registro.modelUsed ?? null,
      generationId: registro.generationId ?? null,
      promptTokens: registro.promptTokens,
      completionTokens: registro.completionTokens,
      costMicros: registro.costMicros,
      costSource: registro.costSource,
      durationMs: registro.durationMs,
      ok: registro.ok,
      errorCode: registro.errorCode ?? null,
      localDay: registro.localDay,
      noteId: registro.noteId ?? null,
    },
  });
}
