import { AI_COST_SOURCES, AI_TASKS, diaLocal, somarDias } from "@yu-book/shared";
import type {
  AiUsageByModel,
  AiUsageCall,
  AiUsageDay,
  AiUsageReport,
  PeriodoDeUso,
} from "@yu-book/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { preferenciaDe } from "./preferencias.service.js";

/**
 * AI usage dash em `/ajustes/uso`: o que o Yu-book gravou em `ai_usage`. Só lê —
 * nenhuma chamada ao provedor, e por isso a rota não tem limite próprio.
 *
 * **A janela é sobre `localDay`, nunca sobre `createdAt`** (INV-50). O dia foi
 * gravado no fuso que valia na hora da chamada; se o usuário trocar o fuso em
 * `/ajustes`, as linhas antigas ficam no dia em que foram gravadas, e é esse o
 * dia que o teto usou. Recortar por `createdAt` com o fuso de hoje contaria a
 * mesma chamada num dia diferente do que o teto contou.
 *
 * A comparação `gte`/`lte` é de texto e vale porque o formato é fixo,
 * `AAAA-MM-DD`; o índice `(userId, localDay)` cobre o recorte.
 */

const CAMPOS_DA_CHAMADA = {
  id: true,
  createdAt: true,
  localDay: true,
  task: true,
  modelId: true,
  modelUsed: true,
  promptTokens: true,
  completionTokens: true,
  costMicros: true,
  costSource: true,
  durationMs: true,
  ok: true,
  errorCode: true,
  noteId: true,
  conversationId: true,
  runId: true,
} satisfies Prisma.AiUsageSelect;

type LinhaDaChamada = Prisma.AiUsageGetPayload<{ select: typeof CAMPOS_DA_CHAMADA }>;

/// Quantas chamadas `recent` traz. A tela mostra uma tabela, não uma trilha.
const MAX_RECENTES = 50;
/// Quantos códigos de erro `errors` traz.
const MAX_ERROS = 5;

/// O modelo que custou: o que o provedor serviu, ou o pedido quando ele não disse.
function modeloDe(linha: { modelId: string; modelUsed: string | null }): string {
  return linha.modelUsed ?? linha.modelId;
}

function paraChamada(linha: LinhaDaChamada): AiUsageCall {
  return {
    id: linha.id,
    createdAt: linha.createdAt.toISOString(),
    localDay: linha.localDay,
    task: linha.task,
    model: modeloDe(linha),
    promptTokens: linha.promptTokens,
    completionTokens: linha.completionTokens,
    costMicros: linha.costMicros,
    costSource: linha.costSource,
    durationMs: linha.durationMs,
    ok: linha.ok,
    errorCode: linha.errorCode ?? null,
    noteId: linha.noteId ?? null,
    conversationId: linha.conversationId ?? null,
    runId: linha.runId ?? null,
  };
}

/// Duração média arredondada; `null` quando não houve chamada para medir.
function media(somaMs: number, chamadas: number): number | null {
  return chamadas > 0 ? Math.round(somaMs / chamadas) : null;
}

/** O relatório do período, `days` dias até hoje no fuso do usuário, inclusive. */
export async function relatorio(userId: string, days: PeriodoDeUso): Promise<AiUsageReport> {
  const { timezone } = await preferenciaDe(userId);
  const to = diaLocal(new Date(), timezone);
  const from = somarDias(to, -(days - 1));
  /// O período anterior tem o mesmo tamanho e termina na véspera de `from`.
  const anteriorAte = somarDias(from, -1);
  const anteriorDe = somarDias(anteriorAte, -(days - 1));

  /// INV-01: `userId` em todas as consultas, inclusive na do período anterior.
  const where = { userId, localDay: { gte: from, lte: to } } satisfies Prisma.AiUsageWhereInput;

  const [porDia, porModelo, porTarefa, porOrigem, erros, recentes, anterior] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["localDay", "ok"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true, promptTokens: true, completionTokens: true, durationMs: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["modelId", "modelUsed", "ok"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true, promptTokens: true, completionTokens: true, durationMs: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["task", "ok"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    prisma.aiUsage.groupBy({
      by: ["costSource"],
      where,
      _count: { _all: true },
      _sum: { costMicros: true },
    }),
    /// Falha sem código fica fora da lista: sem código não há o que agrupar
    /// nem o que mostrar como causa. Hoje todo `registrarUso` com `ok: false`
    /// grava um (`passo.service.ts`, `formatar.service.ts`), então só a vê quem
    /// esquecer de passá-lo. Ela continua contada em `failedCalls` e visível em
    /// `recent`, com `errorCode: null`. O desempate por código deixa o corte em
    /// cinco estável entre duas leituras.
    prisma.aiUsage.groupBy({
      by: ["errorCode"],
      where: { ...where, ok: false, errorCode: { not: null } },
      _count: { errorCode: true },
      orderBy: [{ _count: { errorCode: "desc" } }, { errorCode: "asc" }],
      take: MAX_ERROS,
    }),
    prisma.aiUsage.findMany({
      where,
      select: CAMPOS_DA_CHAMADA,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_RECENTES,
    }),
    prisma.aiUsage.aggregate({
      where: { userId, localDay: { gte: anteriorDe, lte: anteriorAte } },
      _sum: { costMicros: true },
    }),
  ]);

  /// Os `days` pontos já existem antes de somar: dia sem linha sai com zero,
  /// não some do gráfico.
  const daily = new Map<string, AiUsageDay>();
  for (let dia = from; dia <= to; dia = somarDias(dia, 1)) {
    daily.set(dia, { localDay: dia, costMicros: 0, calls: 0, failedCalls: 0 });
  }

  const totais = { costMicros: 0, calls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0 };
  let duracaoTotal = 0;
  for (const grupo of porDia) {
    const chamadas = grupo._count._all;
    const falhas = grupo.ok ? 0 : chamadas;
    const custo = grupo._sum.costMicros ?? 0;
    totais.calls += chamadas;
    totais.failedCalls += falhas;
    totais.costMicros += custo;
    totais.promptTokens += grupo._sum.promptTokens ?? 0;
    totais.completionTokens += grupo._sum.completionTokens ?? 0;
    duracaoTotal += grupo._sum.durationMs ?? 0;

    /// O recorte do `where` garante que o dia está no mapa; a guarda é para o
    /// compilador e para uma linha gravada com `localDay` fora do formato.
    const ponto = daily.get(grupo.localDay);
    if (!ponto) continue;
    ponto.calls += chamadas;
    ponto.failedCalls += falhas;
    ponto.costMicros += custo;
  }

  /// Dobrado em JS pelo modelo que custou: o mesmo `modelUsed` pedido por dois
  /// `modelId` diferentes é uma linha só.
  const modelos = new Map<string, AiUsageByModel & { duracaoMs: number }>();
  for (const grupo of porModelo) {
    const model = modeloDe(grupo);
    const linha = modelos.get(model) ?? {
      model,
      calls: 0,
      failedCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      avgDurationMs: 0,
      duracaoMs: 0,
    };
    linha.calls += grupo._count._all;
    if (!grupo.ok) linha.failedCalls += grupo._count._all;
    linha.promptTokens += grupo._sum.promptTokens ?? 0;
    linha.completionTokens += grupo._sum.completionTokens ?? 0;
    linha.costMicros += grupo._sum.costMicros ?? 0;
    linha.duracaoMs += grupo._sum.durationMs ?? 0;
    modelos.set(model, linha);
  }
  const byModel: AiUsageByModel[] = [...modelos.values()]
    .map(({ duracaoMs, ...linha }) => ({
      ...linha,
      avgDurationMs: media(duracaoMs, linha.calls) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.costMicros - a.costMicros || b.calls - a.calls || a.model.localeCompare(b.model),
    );

  /// Sempre as três, na ordem do enum: a tabela não muda de forma com o período.
  const byTask = AI_TASKS.map((task) => {
    const grupos = porTarefa.filter((g) => g.task === task);
    return {
      task,
      calls: grupos.reduce((s, g) => s + g._count._all, 0),
      failedCalls: grupos.reduce((s, g) => s + (g.ok ? 0 : g._count._all), 0),
      costMicros: grupos.reduce((s, g) => s + (g._sum.costMicros ?? 0), 0),
    };
  });

  const byCostSource = AI_COST_SOURCES.map((source) => {
    const grupo = porOrigem.find((g) => g.costSource === source);
    return { source, calls: grupo?._count._all ?? 0, costMicros: grupo?._sum.costMicros ?? 0 };
  });
  const origem = (fonte: (typeof AI_COST_SOURCES)[number]) =>
    byCostSource.find((o) => o.source === fonte);

  return {
    days,
    timezone,
    from,
    to,
    totals: {
      ...totais,
      avgDurationMs: media(duracaoTotal, totais.calls),
      estimatedMicros: origem("estimado")?.costMicros ?? 0,
      callsWithoutCost: origem("desconhecido")?.calls ?? 0,
    },
    previousCostMicros: anterior._sum.costMicros ?? 0,
    daily: [...daily.values()],
    byModel,
    byTask,
    byCostSource,
    /// `errorCode` não é nulo aqui pelo `where`; o `?? ""` é para o compilador.
    errors: erros.map((e) => ({ code: e.errorCode ?? "", calls: e._count.errorCode })),
    recent: recentes.map(paraChamada),
  };
}
