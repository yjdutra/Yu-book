import { AI_TASKS, diaLocal, precoAnthropic, somarDias } from "@yu-book/shared";
import type { ClaudeUsageByModel, ClaudeUsageReport, PeriodoDeUso } from "@yu-book/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { temChaveAnthropic } from "./anthropic.service.js";
import { preferenciaDe } from "./preferencias.service.js";

/**
 * A tela de custo do Claude em `/ajustes/claude` (docs/plano-provedor-anthropic.md,
 * F4): o que o Yu-book gravou em `ai_usage` das chamadas à Anthropic. Só lê o
 * banco, como o AI usage dash (`uso.service.ts`), e pelas mesmas regras —
 * janela sobre `localDay`, nunca sobre `createdAt` (INV-50), e `userId` em
 * toda consulta (INV-01).
 *
 * O que ela tem a mais que o dash geral é o que só a Anthropic informa: os
 * tokens de cache, e com eles o quanto o cache poupou. E o mês civil, que é a
 * janela dos créditos mensais do plano.
 *
 * O custo segundo a própria Anthropic não entra: a Admin API, que o daria,
 * não existe para contas individuais do Console — e é numa delas que caem os
 * créditos do plano. Aqui é a estimativa pela tabela, dita como tal na tela.
 */

/// O dia 1 do mês de `dia` (`AAAA-MM-DD`). Texto, porque `localDay` é texto.
function inicioDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/**
 * Quanto a leitura de cache poupou, pela tabela: os tokens lidos custariam o
 * preço de entrada, e custaram o de leitura; a escrita custou o prêmio sobre a
 * entrada. Modelo fora da tabela não entra — sem preço, a conta inventaria.
 * Pode ser negativo: cache escrito e nunca lido é gasto a mais.
 */
function economiaDoCache(linha: ClaudeUsageByModel): number {
  const preco = precoAnthropic(linha.model);
  if (!preco) return 0;
  const lido = (linha.cacheReadTokens * (preco.promptMicros - preco.cacheReadMicros)) / 1_000_000;
  const escrito =
    (linha.cacheWriteTokens * (preco.cacheWriteMicros - preco.promptMicros)) / 1_000_000;
  return Math.round(lido - escrito);
}

export async function relatorioClaude(
  userId: string,
  days: PeriodoDeUso,
): Promise<ClaudeUsageReport> {
  const { timezone, anthropicMonthlyCreditMicros } = await preferenciaDe(userId);
  const to = diaLocal(new Date(), timezone);
  const from = somarDias(to, -(days - 1));
  const anteriorAte = somarDias(from, -1);
  const anteriorDe = somarDias(anteriorAte, -(days - 1));
  const mesDe = inicioDoMes(to);

  const daAnthropic = { userId, provider: "anthropic" } satisfies Prisma.AiUsageWhereInput;
  const where = {
    ...daAnthropic,
    localDay: { gte: from, lte: to },
  } satisfies Prisma.AiUsageWhereInput;
  const somas = {
    costMicros: true,
    promptTokens: true,
    completionTokens: true,
    cacheReadTokens: true,
    cacheWriteTokens: true,
  } as const;

  const [porDia, porModelo, porTarefa, erros, anterior, mes, hoje] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["localDay", "ok"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["modelId", "modelUsed"],
      where,
      _count: { _all: true },
      _sum: somas,
    }),
    prisma.aiUsage.groupBy({
      by: ["task"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["errorCode"],
      where: { ...where, ok: false, errorCode: { in: ["COTA_EXCEDIDA", "RECUSA_DO_MODELO"] } },
      _count: { _all: true },
    }),
    prisma.aiUsage.aggregate({
      where: { ...daAnthropic, localDay: { gte: anteriorDe, lte: anteriorAte } },
      _sum: { costMicros: true },
    }),
    prisma.aiUsage.aggregate({
      where: { ...daAnthropic, localDay: { gte: mesDe, lte: to } },
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    prisma.aiUsage.aggregate({
      where: { ...daAnthropic, localDay: to },
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
  ]);

  /// Os `days` pontos existem antes de somar: dia sem chamada sai com zero.
  const daily = new Map<string, ClaudeUsageReport["daily"][number]>();
  for (let dia = from; dia <= to; dia = somarDias(dia, 1)) {
    daily.set(dia, { localDay: dia, costMicros: 0, calls: 0, failedCalls: 0 });
  }
  let calls = 0;
  let failedCalls = 0;
  for (const grupo of porDia) {
    const chamadas = grupo._count._all;
    calls += chamadas;
    if (!grupo.ok) failedCalls += chamadas;
    const ponto = daily.get(grupo.localDay);
    if (!ponto) continue;
    ponto.calls += chamadas;
    if (!grupo.ok) ponto.failedCalls += chamadas;
    ponto.costMicros += grupo._sum.costMicros ?? 0;
  }

  /// Pelo modelo que respondeu, como no dash geral.
  const modelos = new Map<string, ClaudeUsageByModel>();
  for (const grupo of porModelo) {
    const model = grupo.modelUsed ?? grupo.modelId;
    const linha = modelos.get(model) ?? {
      model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
    };
    linha.calls += grupo._count._all;
    linha.inputTokens += grupo._sum.promptTokens ?? 0;
    linha.outputTokens += grupo._sum.completionTokens ?? 0;
    linha.cacheReadTokens += grupo._sum.cacheReadTokens ?? 0;
    linha.cacheWriteTokens += grupo._sum.cacheWriteTokens ?? 0;
    linha.costMicros += grupo._sum.costMicros ?? 0;
    modelos.set(model, linha);
  }
  const byModel = [...modelos.values()].sort(
    (a, b) => b.costMicros - a.costMicros || b.calls - a.calls || a.model.localeCompare(b.model),
  );

  const soma = (campo: keyof ClaudeUsageByModel) =>
    byModel.reduce((total, linha) => total + (linha[campo] as number), 0);
  const inputTokens = soma("inputTokens");
  const cacheReadTokens = soma("cacheReadTokens");
  const cacheWriteTokens = soma("cacheWriteTokens");
  const prompt = inputTokens + cacheReadTokens + cacheWriteTokens;

  const erro = (codigo: string) => erros.find((e) => e.errorCode === codigo)?._count._all ?? 0;

  return {
    configured: temChaveAnthropic(env.ANTHROPIC_API_KEY),
    days,
    timezone,
    from,
    to,
    totals: {
      costMicros: soma("costMicros"),
      calls,
      failedCalls,
      inputTokens,
      outputTokens: soma("outputTokens"),
      cacheReadTokens,
      cacheWriteTokens,
      cacheSavingsMicros: byModel.reduce((total, linha) => total + economiaDoCache(linha), 0),
      cacheHitRate: prompt > 0 ? cacheReadTokens / prompt : null,
    },
    previousCostMicros: anterior._sum.costMicros ?? 0,
    month: { from: mesDe, costMicros: mes._sum.costMicros ?? 0, calls: mes._count._all },
    today: { costMicros: hoje._sum.costMicros ?? 0, calls: hoje._count._all },
    monthlyCreditMicros: anthropicMonthlyCreditMicros,
    daily: [...daily.values()],
    byModel,
    /// Sempre as três, na ordem do enum: a tabela não muda de forma com o período.
    byTask: AI_TASKS.map((task) => {
      const grupo = porTarefa.find((g) => g.task === task);
      return { task, calls: grupo?._count._all ?? 0, costMicros: grupo?._sum.costMicros ?? 0 };
    }),
    creditErrors: erro("COTA_EXCEDIDA"),
    refusals: erro("RECUSA_DO_MODELO"),
  };
}
