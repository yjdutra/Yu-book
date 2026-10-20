import type { Conversation } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/*
 * A conversa descartável do assistente rápido do celular: existe para a 2ª
 * interação ler a 1ª, fica fora da lista e some 24 h depois da última
 * mensagem — sem levar junto o registro de gasto.
 */

let app: FastifyInstance;
let dono: Usuario;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("descartavel");
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

const criar = async (body: Record<string, unknown>) => {
  const r = await chamar(app, { method: "POST", url: "/ai/conversations", token: dono.token, body });
  expect(r.status).toBe(201);
  return r.body as Conversation;
};

const envelhecer = (id: string, horas: number) =>
  prisma.aiConversation.update({
    where: { id },
    data: { updatedAt: new Date(Date.now() - horas * 3_600_000) },
  });

describe("conversa descartável", () => {
  test("fica fora da lista, mas abre pelo id", async () => {
    const normal = await criar({ title: "Normal" });
    const rapida = await criar({ title: "Rápida", ephemeral: true });
    expect(rapida.ephemeral).toBe(true);
    expect(normal.ephemeral).toBe(false);

    const lista = (await chamar(app, { method: "GET", url: "/ai/conversations", token: dono.token }))
      .body as Conversation[];
    expect(lista.map((c) => c.id)).toContain(normal.id);
    expect(lista.map((c) => c.id)).not.toContain(rapida.id);

    const aberta = await chamar(app, {
      method: "GET",
      url: `/ai/conversations/${rapida.id}`,
      token: dono.token,
    });
    expect(aberta.status).toBe(200);
  });

  test("a vencida some ao criar outra; a recente e as normais ficam; o gasto fica", async () => {
    const velha = await criar({ title: "Velha", ephemeral: true });
    const recente = await criar({ title: "Recente", ephemeral: true });
    const normalVelha = await criar({ title: "Normal velha" });
    await envelhecer(velha.id, 25);
    await envelhecer(recente.id, 23);
    await envelhecer(normalVelha.id, 72);

    const uso = await prisma.aiUsage.create({
      data: {
        userId: dono.id,
        task: "chat",
        modelId: "teste/modelo",
        costMicros: 1234,
        costSource: "provedor",
        durationMs: 10,
        ok: true,
        localDay: "2026-10-20",
        conversationId: velha.id,
      },
    });

    await criar({ title: "Nova", ephemeral: true });

    const ids = (await prisma.aiConversation.findMany({ where: { userId: dono.id } })).map(
      (c) => c.id,
    );
    expect(ids).not.toContain(velha.id);
    expect(ids).toContain(recente.id);
    expect(ids).toContain(normalVelha.id);

    // O teto de gasto lê `ai_usage`: a linha fica, só sem a conversa.
    const ficou = await prisma.aiUsage.findUnique({ where: { id: uso.id } });
    expect(ficou).toMatchObject({ costMicros: 1234, conversationId: null });
  });
});
