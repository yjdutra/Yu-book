import type { Prisma } from "@prisma/client";
import { diaLocal, FUSO_PADRAO } from "@yu-book/shared";
import type { AiUsageReport } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { relatorio } from "../src/modules/assistente/uso.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";

/**
 * AI usage dash (`/ajustes/uso`): o que o Yu-book gravou em `ai_usage`.
 *
 * O que esta suíte protege, acima da aritmética, é **que o relatório só enxerga
 * as linhas de quem pediu** (INV-01) e **que a janela é o `localDay` gravado,
 * nunca o `createdAt`** (INV-50): o dia do painel tem que ser o mesmo dia que o
 * teto contou.
 *
 * As linhas são semeadas direto no banco, e cada teste usa contas próprias —
 * o relatório é por usuário, então uma conta nova é um relatório limpo, mesmo
 * no banco de desenvolvimento, que guarda o gasto real do operador.
 */

/// Quinze horas UTC, meio-dia em São Paulo: longe da meia-noite nos dois fusos,
/// e "hoje" é 2026-09-25 em qualquer um deles.
const AGORA = new Date("2026-09-25T15:00:00.000Z");
const HOJE = "2026-09-25";

let app: FastifyInstance;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  await limpar();
});

afterEach(() => {
  vi.useRealTimers();
});

/// Só o `Date`, como em `openrouter-painel.test.ts`: o Prisma e o Fastify
/// seguem nos timers de verdade.
function congelarRelogio(instante: Date = AGORA): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instante);
}

/** Uma chamada bem-sucedida de hoje; cada teste muda só o que examina. */
function uso(
  userId: string,
  extra: Partial<Prisma.AiUsageCreateManyInput> = {},
): Prisma.AiUsageCreateManyInput {
  return {
    userId,
    task: "formatar",
    modelId: "estudio/gpt-x",
    costSource: "provedor",
    costMicros: 1_000,
    promptTokens: 100,
    completionTokens: 10,
    durationMs: 1_000,
    ok: true,
    localDay: HOJE,
    ...extra,
  };
}

async function semear(linhas: Prisma.AiUsageCreateManyInput[]): Promise<void> {
  await prisma.aiUsage.createMany({ data: linhas });
}

async function preferirFuso(userId: string, timezone: string): Promise<void> {
  await prisma.aiPreference.create({
    data: { userId, dailyCapMicros: 200_000, timezone, allowTraining: false },
  });
}

const somaDe = <T>(xs: T[], campo: (x: T) => number) => xs.reduce((t, x) => t + campo(x), 0);

describe("a janela do relatório", () => {
  test("from e hoje entram, a véspera de from e o dia seguinte a hoje ficam fora", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-janela");
    await semear([
      uso(dono.id, { localDay: "2026-09-19", costMicros: 100 }),
      uso(dono.id, { localDay: HOJE, costMicros: 200 }),
      uso(dono.id, { localDay: "2026-09-18", costMicros: 10_000 }),
      // Dia local à frente de hoje: só existe se o fuso mudou depois da
      // gravação. Não é do período que a tela mostra.
      uso(dono.id, { localDay: "2026-09-26", costMicros: 20_000 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r).toMatchObject({ days: 7, timezone: FUSO_PADRAO, from: "2026-09-19", to: HOJE });
    expect(r.totals.calls).toBe(2);
    expect(r.totals.costMicros).toBe(300);
    expect(r.daily[0]).toEqual({ localDay: "2026-09-19", costMicros: 100, calls: 1, failedCalls: 0 });
    expect(r.daily[6]).toEqual({ localDay: HOJE, costMicros: 200, calls: 1, failedCalls: 0 });
    expect(r.daily.map((d) => d.localDay)).not.toContain("2026-09-18");
    expect(r.daily.map((d) => d.localDay)).not.toContain("2026-09-26");
  });

  test("o recorte é pelo dia local gravado, nunca pelo instante da gravação (INV-50)", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-dia-gravado");
    await semear([
      // Gravada há semanas, mas contada pelo teto num dia do período.
      uso(dono.id, {
        localDay: "2026-09-20",
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        costMicros: 11,
      }),
      // Gravada agora, mas com um dia local fora do período.
      uso(dono.id, { localDay: "2026-09-10", createdAt: AGORA, costMicros: 5_000 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.totals).toMatchObject({ calls: 1, costMicros: 11 });
    expect(r.daily.find((d) => d.localDay === "2026-09-20")?.calls).toBe(1);
    expect(r.recent.map((c) => c.costMicros)).toEqual([11]);
  });

  test("7, 30 e 90 dias dão exatamente 7, 30 e 90 pontos consecutivos, com zero no dia vazio", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-pontos");
    await semear([uso(dono.id, { localDay: HOJE, costMicros: 42 })]);

    const esperado = { 7: "2026-09-19", 30: "2026-08-27", 90: "2026-06-28" } as const;
    for (const days of [7, 30, 90] as const) {
      const r = await relatorio(dono.id, days);

      expect(r.days).toBe(days);
      expect(r.from).toBe(esperado[days]);
      expect(r.to).toBe(HOJE);
      expect(r.daily).toHaveLength(days);
      expect(r.daily[0]?.localDay).toBe(r.from);
      expect(r.daily[days - 1]).toEqual({ localDay: HOJE, costMicros: 42, calls: 1, failedCalls: 0 });
      // Consecutivos, sem buraco nem repetição, atravessando a virada de mês.
      for (let i = 1; i < r.daily.length; i++) {
        const anterior = Date.parse(`${r.daily[i - 1]?.localDay}T00:00:00Z`);
        expect(Date.parse(`${r.daily[i]?.localDay}T00:00:00Z`) - anterior).toBe(86_400_000);
      }
      // Todo dia fora de hoje existe, e com zero.
      for (const dia of r.daily.slice(0, -1)) {
        expect(dia).toEqual({ localDay: dia.localDay, costMicros: 0, calls: 0, failedCalls: 0 });
      }
    }
  });
});

describe("o fuso do usuário", () => {
  test("à 01:00 UTC, em São Paulo ainda é ontem: to é o dia anterior ao dia UTC", async () => {
    congelarRelogio(new Date("2026-09-25T01:00:00.000Z"));
    const dono = await criarUsuario("uso-fuso-sp");
    await preferirFuso(dono.id, "America/Sao_Paulo");
    await semear([
      uso(dono.id, { localDay: "2026-09-24", costMicros: 7 }),
      // O dia UTC do relógio é amanhã em São Paulo: fica fora.
      uso(dono.id, { localDay: "2026-09-25", costMicros: 9_000 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r).toMatchObject({ timezone: "America/Sao_Paulo", from: "2026-09-18", to: "2026-09-24" });
    expect(r.totals).toMatchObject({ calls: 1, costMicros: 7 });
    expect(r.daily.at(-1)?.localDay).toBe("2026-09-24");
  });

  test("no mesmo instante, quem prefere UTC já está no dia seguinte: to segue a preferência", async () => {
    congelarRelogio(new Date("2026-09-25T01:00:00.000Z"));
    const dono = await criarUsuario("uso-fuso-utc");
    await preferirFuso(dono.id, "UTC");

    const r = await relatorio(dono.id, 7);

    expect(r).toMatchObject({ timezone: "UTC", from: "2026-09-19", to: "2026-09-25" });
  });
});

describe("por modelo", () => {
  test("o modelo é o que o provedor serviu: dois pedidos que viraram o mesmo somam numa linha", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-modelo");
    await semear([
      // O roteador pediu um, o provedor serviu outro: custou o servido.
      uso(dono.id, { modelId: "roteador/auto", modelUsed: "estudio/gpt-x", costMicros: 300, durationMs: 1_000 }),
      uso(dono.id, { modelId: "estudio/gpt-x", modelUsed: "estudio/gpt-x", costMicros: 200, durationMs: 3_000 }),
      // Sem `modelUsed`, vale o pedido.
      uso(dono.id, {
        modelId: "estudio/gpt-x",
        modelUsed: null,
        costMicros: 0,
        durationMs: 2_001,
        ok: false,
        errorCode: "PROVEDOR_INDISPONIVEL",
      }),
      uso(dono.id, { modelId: "meta/llama:free", modelUsed: null, costMicros: 0, durationMs: 500 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.byModel).toEqual([
      {
        model: "estudio/gpt-x",
        calls: 3,
        failedCalls: 1,
        promptTokens: 300,
        completionTokens: 30,
        costMicros: 500,
        // (1000 + 3000 + 2001) / 3 = 2000,33…
        avgDurationMs: 2_000,
      },
      {
        model: "meta/llama:free",
        calls: 1,
        failedCalls: 0,
        promptTokens: 100,
        completionTokens: 10,
        costMicros: 0,
        avgDurationMs: 500,
      },
    ]);
    expect(r.byModel.map((m) => m.model)).not.toContain("roteador/auto");
  });

  test("a ordem é custo, depois chamadas, depois nome", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-modelo-ordem");
    await semear([
      uso(dono.id, { modelId: "d/barato", costMicros: 10 }),
      uso(dono.id, { modelId: "c/uma-vez", costMicros: 500 }),
      uso(dono.id, { modelId: "b/duas-vezes", costMicros: 250 }),
      uso(dono.id, { modelId: "b/duas-vezes", costMicros: 250 }),
      uso(dono.id, { modelId: "a/duas-vezes", costMicros: 250 }),
      uso(dono.id, { modelId: "a/duas-vezes", costMicros: 250 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.byModel.map((m) => m.model)).toEqual([
      "a/duas-vezes",
      "b/duas-vezes",
      "c/uma-vez",
      "d/barato",
    ]);
  });
});

describe("totais", () => {
  test("falhas, tokens e duração média somam o período, e a falha conta na duração", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-totais");
    await semear([
      uso(dono.id, { promptTokens: 100, completionTokens: 20, durationMs: 1_000, costMicros: 500 }),
      uso(dono.id, {
        localDay: "2026-09-24",
        promptTokens: 50,
        completionTokens: 10,
        durationMs: 2_001,
        costMicros: 250,
      }),
      // Falha: não custou, mas demorou — e demorar é o que a média mede.
      uso(dono.id, {
        promptTokens: 0,
        completionTokens: 0,
        durationMs: 500,
        costMicros: 0,
        ok: false,
        errorCode: "PROVEDOR_INDISPONIVEL",
      }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.totals).toEqual({
      costMicros: 750,
      calls: 3,
      failedCalls: 1,
      promptTokens: 150,
      completionTokens: 30,
      // 3501 / 3 = 1167.
      avgDurationMs: 1_167,
      estimatedMicros: 0,
      callsWithoutCost: 0,
    });
    expect(r.daily.find((d) => d.localDay === HOJE)).toEqual({
      localDay: HOJE,
      costMicros: 500,
      calls: 2,
      failedCalls: 1,
    });
    // O diário e o total são o mesmo número.
    expect(somaDe(r.daily, (d) => d.costMicros)).toBe(r.totals.costMicros);
    expect(somaDe(r.daily, (d) => d.calls)).toBe(r.totals.calls);
    expect(somaDe(r.daily, (d) => d.failedCalls)).toBe(r.totals.failedCalls);
  });

  test("sem nenhuma chamada, a duração média é nula e não zero, e as tabelas fixas vêm zeradas", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-vazio");

    const r = await relatorio(dono.id, 30);

    expect(r.totals).toEqual({
      costMicros: 0,
      calls: 0,
      failedCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      avgDurationMs: null,
      estimatedMicros: 0,
      callsWithoutCost: 0,
    });
    expect(r.previousCostMicros).toBe(0);
    expect(r.daily).toHaveLength(30);
    expect(r.byModel).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.recent).toEqual([]);
    expect(r.byTask).toHaveLength(3);
    expect(r.byCostSource).toHaveLength(3);
  });
});

describe("tarefa e origem do custo", () => {
  test("por tarefa e por origem vêm sempre as três entradas, na ordem dos enums, com zero", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-tarefa");
    await semear([
      uso(dono.id, { task: "chat", costSource: "estimado", costMicros: 30 }),
      uso(dono.id, {
        task: "chat",
        costSource: "estimado",
        costMicros: 0,
        ok: false,
        errorCode: "TETO_ATINGIDO",
      }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.byTask).toEqual([
      { task: "formatar", calls: 0, failedCalls: 0, costMicros: 0 },
      { task: "chat", calls: 2, failedCalls: 1, costMicros: 30 },
      { task: "rotina", calls: 0, failedCalls: 0, costMicros: 0 },
    ]);
    expect(r.byCostSource).toEqual([
      { source: "provedor", calls: 0, costMicros: 0 },
      { source: "estimado", calls: 2, costMicros: 30 },
      { source: "desconhecido", calls: 0, costMicros: 0 },
    ]);
  });

  test("estimatedMicros é a parte estimada do custo, e callsWithoutCost conta as de custo desconhecido", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-origem");
    await semear([
      uso(dono.id, { costSource: "provedor", costMicros: 1_000 }),
      uso(dono.id, { costSource: "estimado", costMicros: 300 }),
      uso(dono.id, { costSource: "estimado", costMicros: 200, task: "rotina" }),
      // INV-48: o terceiro degrau grava zero. A soma do período fica abaixo
      // do gasto real, e a tela precisa saber quantas foram.
      uso(dono.id, { costSource: "desconhecido", costMicros: 0 }),
      uso(dono.id, { costSource: "desconhecido", costMicros: 0, task: "chat" }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.totals).toMatchObject({ costMicros: 1_500, estimatedMicros: 500, callsWithoutCost: 2 });
    expect(r.byCostSource).toEqual([
      { source: "provedor", calls: 1, costMicros: 1_000 },
      { source: "estimado", calls: 2, costMicros: 500 },
      { source: "desconhecido", calls: 2, costMicros: 0 },
    ]);
  });
});

describe("erros mais comuns", () => {
  test("ordena por frequência, desempata pelo código e corta em cinco; falha sem código fica fora", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-erros");
    const falha = (errorCode: string | null) =>
      uso(dono.id, { ok: false, errorCode, costMicros: 0 });
    await semear([
      ...Array.from({ length: 4 }, () => falha("PROVEDOR_INDISPONIVEL")),
      falha("TETO_ATINGIDO"),
      falha("TETO_ATINGIDO"),
      falha("CANCELADA"),
      falha("CANCELADA"),
      falha("BETA"),
      falha("ALFA"),
      falha("GAMA"),
      // Mais frequente que qualquer código: se vazasse para a lista, seria o
      // primeiro.
      ...Array.from({ length: 5 }, () => falha(null)),
      uso(dono.id),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.errors).toEqual([
      { code: "PROVEDOR_INDISPONIVEL", calls: 4 },
      { code: "CANCELADA", calls: 2 },
      { code: "TETO_ATINGIDO", calls: 2 },
      { code: "ALFA", calls: 1 },
      { code: "BETA", calls: 1 },
    ]);
    // A falha sem código continua contada e visível.
    expect(r.totals.failedCalls).toBe(16);
    expect(r.recent.filter((c) => !c.ok && c.errorCode === null)).toHaveLength(5);
  });
});

describe("últimas chamadas", () => {
  test("no máximo 50, da mais nova para a mais velha, com o modelo já resolvido", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-recentes");
    const base = Date.parse("2026-09-25T10:00:00.000Z");
    const minuto = (i: number) => new Date(base + i * 60_000);
    await semear([
      ...Array.from({ length: 55 }, (_, i) =>
        uso(dono.id, {
          createdAt: minuto(i),
          costMicros: i,
          // Metade servida por outro modelo que o pedido.
          ...(i % 2 === 0 && { modelId: "roteador/auto", modelUsed: "estudio/servido" }),
        }),
      ),
      // A mais nova de todas, mas de um dia fora do período: não é recente
      // deste relatório.
      uso(dono.id, { createdAt: minuto(100), localDay: "2026-09-01", costMicros: 9_999 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.recent).toHaveLength(50);
    // As 50 mais novas do período, da 54 à 5; as cinco mais velhas ficam fora.
    expect(r.recent.map((c) => c.costMicros)).toEqual(
      Array.from({ length: 50 }, (_, k) => 54 - k),
    );
    for (const c of r.recent) {
      expect(c.model).toBe(c.costMicros % 2 === 0 ? "estudio/servido" : "estudio/gpt-x");
    }
    expect(r.recent[0]).toEqual({
      id: expect.any(String) as string,
      createdAt: minuto(54).toISOString(),
      localDay: HOJE,
      task: "formatar",
      model: "estudio/servido",
      promptTokens: 100,
      completionTokens: 10,
      costMicros: 54,
      costSource: "provedor",
      durationMs: 1_000,
      ok: true,
      errorCode: null,
      noteId: null,
      conversationId: null,
      runId: null,
    });
  });

  test("duas chamadas no mesmo instante saem numa ordem estável, pelo id", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-recentes-empate");
    const mesmo = new Date("2026-09-25T12:00:00.000Z");
    await semear([
      uso(dono.id, { createdAt: mesmo }),
      uso(dono.id, { createdAt: mesmo }),
      uso(dono.id, { createdAt: mesmo }),
    ]);

    const r = await relatorio(dono.id, 7);

    // O uuid do Postgres ordena pelos bytes, que é a ordem do texto em hexa
    // minúsculo.
    const ids = r.recent.map((c) => c.id);
    expect(ids).toEqual([...ids].sort().reverse());
  });
});

describe("período anterior", () => {
  test("previousCostMicros soma só os days dias imediatamente antes de from", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-anterior");
    await semear([
      // Período: 19 a 25. Anterior: 12 a 18.
      uso(dono.id, { localDay: "2026-09-19", costMicros: 7 }),
      uso(dono.id, { localDay: "2026-09-18", costMicros: 100 }),
      uso(dono.id, { localDay: "2026-09-12", costMicros: 20, costSource: "estimado" }),
      uso(dono.id, { localDay: "2026-09-11", costMicros: 5_000 }),
    ]);

    const r = await relatorio(dono.id, 7);

    expect(r.previousCostMicros).toBe(120);
    expect(r.totals.costMicros).toBe(7);
  });
});

describe("escopo por usuário", () => {
  test("linha de outro usuário nunca aparece em nenhum corte (INV-01)", async () => {
    congelarRelogio();
    const dono = await criarUsuario("uso-escopo-dono");
    const outro = await criarUsuario("uso-escopo-outro");
    await semear([
      uso(dono.id, { costMicros: 10 }),
      // O outro tem de tudo, em todos os cortes do dono, com marcas próprias.
      uso(outro.id, { modelId: "intruso/modelo", task: "rotina", costSource: "desconhecido" }),
      uso(outro.id, {
        modelId: "intruso/modelo",
        task: "chat",
        costSource: "estimado",
        costMicros: 777,
        ok: false,
        errorCode: "INTRUSO",
      }),
      uso(outro.id, { localDay: "2026-09-18", costMicros: 5_000 }),
    ]);

    const r = await relatorio(dono.id, 7);
    const doDono = await prisma.aiUsage.findFirstOrThrow({ where: { userId: dono.id } });

    expect(r.totals).toEqual({
      costMicros: 10,
      calls: 1,
      failedCalls: 0,
      promptTokens: 100,
      completionTokens: 10,
      avgDurationMs: 1_000,
      estimatedMicros: 0,
      callsWithoutCost: 0,
    });
    expect(somaDe(r.daily, (d) => d.calls)).toBe(1);
    expect(r.byModel.map((m) => m.model)).toEqual(["estudio/gpt-x"]);
    expect(r.byTask.map((t) => t.calls)).toEqual([1, 0, 0]);
    expect(r.byCostSource.map((o) => o.calls)).toEqual([1, 0, 0]);
    expect(r.errors).toEqual([]);
    expect(r.recent.map((c) => c.id)).toEqual([doDono.id]);
    expect(r.previousCostMicros).toBe(0);

    // E o avesso: o relatório do outro não enxerga o dono.
    const doOutro = await relatorio(outro.id, 7);
    expect(doOutro.recent.map((c) => c.id)).not.toContain(doDono.id);
    expect(doOutro.totals.calls).toBe(2);
    expect(doOutro.previousCostMicros).toBe(5_000);
  });
});

describe("a rota GET /ai/usage", () => {
  test("sem days vale 30, e o relatório é de quem o token diz", async () => {
    // Relógio de verdade: o token é validado contra ele.
    const dono = await criarUsuario("uso-rota");
    const outro = await criarUsuario("uso-rota-outro");
    const hoje = diaLocal(new Date(), FUSO_PADRAO);
    await semear([uso(dono.id, { localDay: hoje, costMicros: 3 }), uso(outro.id, { localDay: hoje })]);

    const { status, body } = await chamar(app, { method: "GET", url: "/ai/usage", token: dono.token });

    expect(status).toBe(200);
    const r = body as AiUsageReport;
    expect(r.days).toBe(30);
    expect(r.daily).toHaveLength(30);
    expect(r.to).toBe(hoje);
    expect(r.totals).toMatchObject({ calls: 1, costMicros: 3 });
  });

  test("os três períodos oferecidos passam, e chegam como número", async () => {
    const dono = await criarUsuario("uso-rota-periodos");
    for (const days of [7, 30, 90]) {
      const { status, body } = await chamar(app, {
        method: "GET",
        url: `/ai/usage?days=${days}`,
        token: dono.token,
      });
      expect(status).toBe(200);
      expect((body as AiUsageReport).days).toBe(days);
    }
  });

  test("período fora da lista é recusado com 422, inclusive o que um coerce aceitaria", async () => {
    const dono = await criarUsuario("uso-rota-invalido");
    for (const days of ["15", "7.5", "07", "trinta", "0", "-7", ""]) {
      const { status, body } = await chamar(app, {
        method: "GET",
        url: `/ai/usage?days=${days}`,
        token: dono.token,
      });
      expect({ days, status }).toEqual({ days, status: 422 });
      expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/ai/usage" });
    expect(resposta.statusCode).toBe(401);
  });
});
