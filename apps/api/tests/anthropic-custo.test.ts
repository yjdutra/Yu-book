import { diaLocal, FUSO_PADRAO, somarDias } from "@yu-book/shared";
import type { AiSettings, ClaudeUsageReport } from "@yu-book/shared";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { relatorioClaude } from "../src/modules/assistente/uso-claude.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";

/**
 * A tela de custo do Claude, Fase 4 (docs/plano-provedor-anthropic.md): o
 * relatório de `ai_usage` só da Anthropic, com cache, mês dos créditos e as
 * recusas que custaram. Só lê o banco — nenhum dublê no ar.
 */

let app: FastifyInstance;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  await limpar();
});

const hoje = () => diaLocal(new Date(), FUSO_PADRAO);

/** Uma linha de uso, com o que o relatório lê e o resto no padrão. */
function linha(
  userId: string,
  extra: Partial<Prisma.AiUsageCreateManyInput>,
): Prisma.AiUsageCreateManyInput {
  return {
    userId,
    task: "chat" as const,
    modelId: "claude-opus-5-5",
    provider: "anthropic" as const,
    promptTokens: 1_000,
    completionTokens: 500,
    cacheReadTokens: 10_000,
    cacheWriteTokens: 2_000,
    costMicros: 26_000,
    costSource: "estimado" as const,
    durationMs: 100,
    ok: true,
    localDay: hoje(),
    ...extra,
  };
}

describe("relatório de custo do Claude", () => {
  test("soma só a Anthropic, com cache, economia, mês e hoje", async () => {
    const dono = await criarUsuario("claude-custo");
    await prisma.aiUsage.createMany({
      data: [
        linha(dono.id, {}),
        linha(dono.id, { task: "formatar" }),
        // Do OpenRouter: fica fora de tudo.
        linha(dono.id, {
          provider: "openrouter",
          modelId: "estudio/x",
          costMicros: 999_999,
          costSource: "provedor",
        }),
        // Ontem: entra no período e no mês só se ontem for deste mês.
        linha(dono.id, { localDay: somarDias(hoje(), -1) }),
      ],
    });

    const r = await relatorioClaude(dono.id, 7);

    expect(r.totals).toMatchObject({
      calls: 3,
      failedCalls: 0,
      costMicros: 78_000,
      inputTokens: 3_000,
      outputTokens: 1_500,
      cacheReadTokens: 30_000,
      cacheWriteTokens: 6_000,
    });
    // Por chamada no Opus 5.5: 10 mil lidos a (US$ 4 − 0,20)/M poupam 38.000,
    // e 2 mil escritos a (US$ 5 − 4)/M custam 2.000 a mais — 36.000 por linha.
    expect(r.totals.cacheSavingsMicros).toBe(3 * 36_000);
    // 30 mil lidos de um prompt de 3 mil + 30 mil + 6 mil.
    expect(r.totals.cacheHitRate).toBeCloseTo(30_000 / 39_000);

    expect(r.today).toEqual({ costMicros: 52_000, calls: 2 });
    const ontemNoMes = somarDias(hoje(), -1) >= r.month.from;
    expect(r.month.costMicros).toBe(ontemNoMes ? 78_000 : 52_000);
    expect(r.month.from).toBe(`${hoje().slice(0, 7)}-01`);

    expect(r.byModel).toHaveLength(1);
    expect(r.byModel[0]).toMatchObject({ model: "claude-opus-5-5", calls: 3 });
    expect(r.byTask.map((t) => [t.task, t.calls])).toEqual([
      ["formatar", 1],
      ["chat", 2],
      ["rotina", 0],
    ]);
    expect(r.daily).toHaveLength(7);
    expect(r.configured).toBe(true);
  });

  test("conta as recusas por crédito acabado e as do modelo", async () => {
    const dono = await criarUsuario("claude-recusas");
    await prisma.aiUsage.createMany({
      data: [
        linha(dono.id, { ok: false, errorCode: "COTA_EXCEDIDA", costMicros: 0 }),
        linha(dono.id, { ok: false, errorCode: "COTA_EXCEDIDA", costMicros: 0 }),
        linha(dono.id, { ok: false, errorCode: "RECUSA_DO_MODELO" }),
        linha(dono.id, { ok: false, errorCode: "PROVEDOR_DEMOROU", costMicros: 0 }),
      ],
    });

    const r = await relatorioClaude(dono.id, 30);

    expect(r.creditErrors).toBe(2);
    expect(r.refusals).toBe(1);
    expect(r.totals.failedCalls).toBe(4);
  });

  test("não mostra o uso de outra conta", async () => {
    // INV-01: `userId` em toda consulta, inclusive nas do mês e de hoje.
    const dono = await criarUsuario("claude-dono");
    const outro = await criarUsuario("claude-outro");
    await prisma.aiUsage.create({ data: linha(outro.id, {}) });

    const r = await relatorioClaude(dono.id, 7);

    expect(r.totals.calls).toBe(0);
    expect(r.month.costMicros).toBe(0);
    expect(r.today.calls).toBe(0);
    expect(r.totals.cacheHitRate).toBeNull();
  });
});

describe("créditos mensais e a rota", () => {
  test("PATCH grava o crédito, o relatório o devolve, e null apaga", async () => {
    const dono = await criarUsuario("claude-credito");

    const gravado = await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: dono.token,
      body: { anthropicMonthlyCreditMicros: 5_000_000 },
    });
    expect(gravado.status).toBe(200);
    expect((gravado.body as AiSettings).anthropicMonthlyCreditMicros).toBe(5_000_000);

    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/claude/usage?days=30",
      token: dono.token,
    });
    expect(status).toBe(200);
    expect((body as ClaudeUsageReport).monthlyCreditMicros).toBe(5_000_000);

    // Mexer em outro campo não apaga o crédito.
    const teto = await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: dono.token,
      body: { dailyCapMicros: 300_000 },
    });
    expect((teto.body as AiSettings).anthropicMonthlyCreditMicros).toBe(5_000_000);

    const apagado = await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: dono.token,
      body: { anthropicMonthlyCreditMicros: null },
    });
    expect((apagado.body as AiSettings).anthropicMonthlyCreditMicros).toBeNull();
  });

  test("crédito acima do limite é recusado com 422", async () => {
    const dono = await criarUsuario("claude-credito-alto");
    const { status } = await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: dono.token,
      body: { anthropicMonthlyCreditMicros: 3_000_000_000 },
    });
    expect(status).toBe(422);
  });

  test("a rota recusa período fora da lista", async () => {
    const dono = await criarUsuario("claude-periodo");
    const { status } = await chamar(app, {
      method: "GET",
      url: "/ai/claude/usage?days=15",
      token: dono.token,
    });
    expect(status).toBe(422);
  });
});
