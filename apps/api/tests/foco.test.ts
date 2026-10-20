import { randomUUID } from "node:crypto";
import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  formatarHabitos,
  pontosDoFoco,
} from "@yu-book/shared";
import type { FocusSessionItem, FocusSessionResult, HabitItem } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Foco — frente Ritmo, Ritmo 6 (docs/prd-ritmo.md, §9).
 *
 * O pomodoro concluído vira sessão e, na atividade que pontua por ele, um
 * registro `focus` na mesma transação; o `clientId` não deixa duplicar; a
 * duração é conferida; e nada de outra conta é alcançável.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
const SP = "America/Sao_Paulo";
let habito: HabitItem;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.66.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const atividade = (nome: string) => {
  const a = habito.activities.find((x) => x.name === nome);
  if (!a) throw new Error(`Atividade ${nome} não veio`);
  return a.id;
};

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("foco-dono");
  intruso = await criarUsuario("foco-intruso");
  for (const u of [dono, intruso]) {
    await prisma.aiPreference.create({
      data: {
        userId: u.id,
        dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
        timezone: SP,
        allowTraining: TREINO_PERMITIDO_PADRAO,
      },
    });
  }
  const r = await api(dono, "POST", "/habits", {
    name: "Inglês",
    weeklyGoal: 120,
    targetDays: 4,
    activities: [
      { name: "Arquitetura", points: 20, pointsPerPomodoro: 10 },
      { name: "App", points: 10 },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  habito = r.body as HabitItem;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("POST /focus-sessions (RF-56)", () => {
  test("grava a sessão e o registro `focus`; repetir não duplica (CA-36)", async () => {
    const corpo = {
      clientId: randomUUID(),
      activityId: atividade("Arquitetura"),
      minutes: 25,
      startedAt: minutosAtras(25),
    };
    const r = await api(dono, "POST", "/focus-sessions", corpo);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { session, entry } = r.body as FocusSessionResult;
    expect(session).toMatchObject({ minutes: 25, points: 10, day: diaLocal(new Date(), SP) });
    expect(entry).toMatchObject({ origin: "focus", points: 10, focusSessionId: session.id });

    const de_novo = await api(dono, "POST", "/focus-sessions", corpo);
    expect(de_novo.status).toBe(200);
    expect((de_novo.body as FocusSessionResult).session.id).toBe(session.id);
    expect(await prisma.focusSession.count({ where: { userId: dono.id } })).toBe(1);
    expect(await prisma.habitEntry.count({ where: { userId: dono.id, origin: "focus" } })).toBe(1);

    // Entra na semana ponderada como qualquer registro (RN-39).
    const lido = (await api(dono, "GET", `/habits/${habito.id}`)).body as HabitItem;
    expect(lido.week.progress).toBe(10);

    // O registro do foco se exclui pela rota de registros; a sessão fica (RN-38).
    expect((await api(dono, "DELETE", `/habit-entries/${entry?.id}`)).status).toBe(204);
    expect(await prisma.focusSession.count({ where: { userId: dono.id } })).toBe(1);
  });

  test("antes do tempo, ou de horas atrás, é 422 (CA-37, RN-36)", async () => {
    const base = { activityId: atividade("Arquitetura"), minutes: 25 };
    const cedo = await api(dono, "POST", "/focus-sessions", {
      ...base,
      clientId: randomUUID(),
      startedAt: minutosAtras(5),
    });
    expect(cedo.status).toBe(422);
    const velho = await api(dono, "POST", "/focus-sessions", {
      ...base,
      clientId: randomUUID(),
      startedAt: minutosAtras(7 * 60),
    });
    expect(velho.status).toBe(422);
    // A folga de 10% para o relógio do aparelho.
    const folga = await api(dono, "POST", "/focus-sessions", {
      ...base,
      clientId: randomUUID(),
      startedAt: minutosAtras(23),
    });
    expect(folga.status).toBe(201);
  });

  test("atividade sem pontos por pomodoro, ou sem atividade: só a sessão (CA-38)", async () => {
    for (const activityId of [atividade("App"), null]) {
      const r = await api(dono, "POST", "/focus-sessions", {
        clientId: randomUUID(),
        activityId,
        minutes: 5,
        startedAt: minutosAtras(5),
      });
      expect(r.status).toBe(201);
      expect((r.body as FocusSessionResult).entry).toBeNull();
    }
  });

  test("o tempo ajustado pontua proporcional, arredondado para baixo", async () => {
    // Arquitetura vale 10 por pomodoro de 25 min.
    const casos = [
      { minutes: 50, pontos: 20 },
      { minutes: 15, pontos: 6 },
      { minutes: 2, pontos: null },
    ];
    for (const { minutes, pontos } of casos) {
      const r = await api(dono, "POST", "/focus-sessions", {
        clientId: randomUUID(),
        activityId: atividade("Arquitetura"),
        minutes,
        startedAt: minutosAtras(minutes),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const { session, entry } = r.body as FocusSessionResult;
      expect(entry?.points ?? null).toBe(pontos);
      expect(session.points).toBe(pontos ?? 0);
    }
    expect(pontosDoFoco(10, 25)).toBe(10);
    expect(pontosDoFoco(10, 10)).toBe(4);
  });

  test("atividade arquivada grava sem pontuar (RN-37)", async () => {
    await api(dono, "PATCH", `/habit-activities/${atividade("Arquitetura")}`, { archived: true });
    const r = await api(dono, "POST", "/focus-sessions", {
      clientId: randomUUID(),
      activityId: atividade("Arquitetura"),
      minutes: 25,
      startedAt: minutosAtras(26),
    });
    expect(r.status).toBe(201);
    expect((r.body as FocusSessionResult).entry).toBeNull();
    await api(dono, "PATCH", `/habit-activities/${atividade("Arquitetura")}`, { archived: false });
  });

  test("atividade de outra conta é 404; a lista é só do dono", async () => {
    const r = await api(intruso, "POST", "/focus-sessions", {
      clientId: randomUUID(),
      activityId: atividade("Arquitetura"),
      minutes: 25,
      startedAt: minutosAtras(25),
    });
    expect(r.status).toBe(404);
    const minhas = (await api(dono, "GET", "/focus-sessions")).body as FocusSessionItem[];
    expect(minhas.length).toBeGreaterThanOrEqual(4);
    expect(((await api(intruso, "GET", "/focus-sessions")).body as FocusSessionItem[]).length).toBe(
      0,
    );
  });

  test("a atividade mostra os pontos por pomodoro, e o formatador também", async () => {
    const lido = (await api(dono, "GET", `/habits/${habito.id}`)).body as HabitItem;
    expect(lido.activities.find((a) => a.name === "Arquitetura")?.pointsPerPomodoro).toBe(10);
    expect(formatarHabitos([lido])).toContain("Arquitetura · 20 pts · 10 por pomodoro");
    const zerado = await api(dono, "PATCH", `/habit-activities/${atividade("Arquitetura")}`, {
      pointsPerPomodoro: null,
    });
    expect(zerado.body).toMatchObject({ pointsPerPomodoro: null });
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/focus-sessions" });
    expect(resposta.statusCode).toBe(401);
  });
});
