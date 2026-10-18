import {
  MINIMO_POR_LADO,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  formatarHumor,
  humorComESem,
  mediaDoDia,
  somarDias,
} from "@yu-book/shared";
import type { HabitItem, HabitsSummary, MoodDayItem, MoodsInsights } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Humor — frente Ritmo, Ritmo 4 (docs/prd-ritmo.md, §7).
 *
 * O `PUT` que mescla no dia, a janela de 30 dias, o dia só com humor acendendo
 * a ofensiva sem dar XP, os cartões com amostra mínima e o recorte por usuário.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
const SP = "America/Sao_Paulo";
const MCP = { via: "mcp", author: "Claude Code" };
let hoje: string;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.64.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(usuario: Usuario, method: "GET" | "POST" | "PUT", url: string, body?: unknown) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

async function preferirFuso(userId: string): Promise<void> {
  await prisma.aiPreference.upsert({
    where: { userId },
    create: {
      userId,
      dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
      timezone: SP,
      allowTraining: TREINO_PERMITIDO_PADRAO,
    },
    update: { timezone: SP },
  });
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("humor-dono");
  intruso = await criarUsuario("humor-intruso");
  await preferirFuso(dono.id);
  await preferirFuso(intruso.id);
  hoje = diaLocal(new Date(), SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("PUT /moods (RF-40)", () => {
  test("mescla os momentos no mesmo dia, e `null` apaga só aquele (CA-24)", async () => {
    const manha = await api(dono, "PUT", "/moods", { morning: 4 });
    expect(manha.status, JSON.stringify(manha.body)).toBe(200);
    await api(dono, "PUT", "/moods", { evening: 2, note: "  Dia longo  " });
    const dia = (await api(dono, "PUT", "/moods", { midday: 3 })).body as MoodDayItem;
    expect(dia).toMatchObject({ day: hoje, morning: 4, midday: 3, evening: 2, note: "Dia longo" });
    const semManha = (await api(dono, "PUT", "/moods", { morning: null })).body as MoodDayItem;
    expect(semManha).toMatchObject({ morning: null, midday: 3, evening: 2 });
    expect(await prisma.moodDay.count({ where: { userId: dono.id } })).toBe(1);
  });

  test("futuro e 31 dias atrás são 422; valor fora de 1 a 5 também (CA-25)", async () => {
    expect((await api(dono, "PUT", "/moods", { day: somarDias(hoje, 1), morning: 3 })).status).toBe(
      422,
    );
    expect(
      (await api(dono, "PUT", "/moods", { day: somarDias(hoje, -31), morning: 3 })).status,
    ).toBe(422);
    expect((await api(dono, "PUT", "/moods", { morning: 6 })).status).toBe(422);
    expect((await api(dono, "PUT", "/moods", {})).status).toBe(422);
  });

  test("esvaziar o dia apaga a linha (RN-28)", async () => {
    const dia = somarDias(hoje, -5);
    await api(dono, "PUT", "/moods", { day: dia, morning: 2 });
    const vazio = await api(dono, "PUT", "/moods", { day: dia, morning: null });
    expect(vazio.body).toBeNull();
    const linhas = await prisma.moodDay.count({
      where: { userId: dono.id, day: new Date(`${dia}T00:00:00Z`) },
    });
    expect(linhas).toBe(0);
  });

  test("a marca de IA só vem do MCP", async () => {
    const dia = somarDias(hoje, -2);
    const r = await api(dono, "PUT", "/moods", { day: dia, evening: 5, origin: MCP });
    expect((r.body as MoodDayItem).ai).toMatchObject({ via: "mcp", author: "Claude Code" });
  });
});

describe("leitura, ofensiva e cartões", () => {
  test("GET /moods lê o período só do dono, e o formatador dá nome aos números", async () => {
    const r = await api(dono, "GET", `/moods?from=${somarDias(hoje, -3)}&to=${hoje}`);
    const dias = r.body as MoodDayItem[];
    expect(dias.map((d) => d.day)).toEqual([hoje, somarDias(hoje, -2)]);
    expect(formatarHumor(dias)).toContain("noite 2 mal");
    expect(((await api(intruso, "GET", "/moods")).body as MoodDayItem[]).length).toBe(0);
  });

  test("dia só com humor acende a ofensiva e não dá XP (CA-26, RN-26)", async () => {
    const resumo = (await api(dono, "GET", "/habits/summary")).body as HabitsSummary;
    expect(resumo.streak.todayDone).toBe(true);
    expect(resumo.xp).toBe(0);
  });

  test("o cartão só sai com 7 dias de cada lado (CA-27)", async () => {
    const usuario = await criarUsuario("humor-cartao");
    await preferirFuso(usuario.id);
    const { body } = await api(usuario, "POST", "/habits", {
      name: "Corpo",
      weeklyGoal: 30,
      targetDays: 3,
    });
    const habito = body as HabitItem;
    // 7 dias com o hábito (humor 5) e 6 sem (humor 2).
    for (let i = 0; i < 13; i++) {
      const dia = somarDias(hoje, -i);
      await api(usuario, "PUT", "/moods", { day: dia, evening: i < 7 ? 5 : 2 });
      if (i < 7) await api(usuario, "POST", `/habits/${habito.id}/entries`, { points: 10, day: dia });
    }
    const pouco = (await api(usuario, "GET", "/moods/insights")).body as MoodsInsights;
    expect(pouco.habits).toEqual([]);
    await api(usuario, "PUT", "/moods", { day: somarDias(hoje, -13), evening: 2 });
    const r = (await api(usuario, "GET", "/moods/insights")).body as MoodsInsights;
    expect(r.points).toHaveLength(7);
    expect(r.points.at(-1)).toEqual({ day: hoje, points: 10 });
    expect(r.habits).toEqual([
      {
        habitId: habito.id,
        habitName: "Corpo",
        color: "violeta",
        with: { average: 5, n: 7 },
        without: { average: 2, n: 7 },
      },
    ]);
  });

  test("as contas puras: média dos momentos e o mínimo por lado", () => {
    expect(mediaDoDia({ morning: 4, midday: null, evening: 2 })).toBe(3);
    expect(mediaDoDia({ morning: null, midday: null, evening: null })).toBeNull();
    const dias = Array.from({ length: MINIMO_POR_LADO * 2 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      morning: i % 2 ? 4 : 3,
      midday: null,
      evening: null,
    }));
    const com = new Set(dias.filter((_, i) => i % 2).map((d) => d.day));
    expect(humorComESem(dias, com)).toEqual({
      with: { average: 4, n: 7 },
      without: { average: 3, n: 7 },
    });
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/moods" });
    expect(resposta.statusCode).toBe(401);
  });
});
