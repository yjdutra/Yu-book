import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  inicioDaSemana,
  maiores,
  melhoresSemanas,
  resumoDaOfensiva,
  semanasComMeta,
  sequenciasDeDias,
  sequenciasDeSemanas,
  somarDias,
} from "@yu-book/shared";
import type { HabitItem, HabitsStreaks, HabitsSummary } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Ofensivas e recordes — frente Ritmo, Ritmo 3 (docs/prd-ritmo.md, §6).
 *
 * As contas puras de `shared` com datas fixas (RNF-12), e a rota que junta
 * tudo numa leitura, com o recorte por usuário.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
const SP = "America/Sao_Paulo";
let hoje: string;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.63.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(usuario: Usuario, method: "GET" | "POST" | "PATCH", url: string, body?: unknown) {
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

/** Grava direto no banco: a janela de 30 dias do avulso (RN-06) não alcança semanas antigas. */
async function registrar(usuario: Usuario, habitId: string, dia: string, pontos: number) {
  await prisma.habitEntry.create({
    data: {
      userId: usuario.id,
      habitId,
      points: pontos,
      day: new Date(`${dia}T00:00:00.000Z`),
      origin: "manual",
    },
  });
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("ritmo3-dono");
  intruso = await criarUsuario("ritmo3-intruso");
  await preferirFuso(dono.id);
  await preferirFuso(intruso.id);
  hoje = diaLocal(new Date(), SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("as sequências de shared", () => {
  const HOJE = "2026-10-18"; // domingo

  test("dias seguidos até hoje; sem hoje, viva até ontem (CA-19)", () => {
    const comHoje = ["2026-10-18", "2026-10-17", "2026-10-16", "2026-10-14"];
    expect(resumoDaOfensiva(comHoje, HOJE)).toEqual({ current: 3, best: 3, todayDone: true });
    const semHoje = ["2026-10-17", "2026-10-16", "2026-10-14"];
    expect(resumoDaOfensiva(semHoje, HOJE)).toEqual({ current: 2, best: 2, todayDone: false });
    // Anteontem como último dia: a ofensiva acabou.
    expect(resumoDaOfensiva(["2026-10-16"], HOJE).current).toBe(0);
  });

  test("semanas seguidas: a corrente só entra quando bateu (CA-20)", () => {
    const passadas = ["2026-09-28", "2026-10-05"];
    const seqs = sequenciasDeSemanas(passadas, HOJE);
    expect(seqs).toEqual([{ start: "2026-09-28", end: "2026-10-11", length: 2, alive: true }]);
    const comCorrente = sequenciasDeSemanas([...passadas, "2026-10-12"], HOJE);
    expect(comCorrente[0]).toMatchObject({ length: 3, alive: true, end: "2026-10-18" });
    // Duas semanas sem bater: morreu.
    expect(sequenciasDeSemanas(["2026-09-21"], HOJE)[0]?.alive).toBe(false);
  });

  test("a meta da semana usa o teto por dia, com a meta atual", () => {
    // Meta 60 em 2 dias: teto 30. 60 num dia só conta 30; dois dias de 30 batem.
    const pontos = new Map([
      ["2026-10-05", 60],
      ["2026-10-12", 30],
      ["2026-10-13", 30],
    ]);
    expect(semanasComMeta({ weeklyGoal: 60, targetDays: 2 }, pontos)).toEqual(["2026-10-12"]);
  });

  test("ranking: maior primeiro, empate pela mais recente; semanas somam acima do teto (CA-21, CA-22)", () => {
    const seqs = sequenciasDeDias(
      ["2026-10-01", "2026-10-02", "2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"],
      HOJE,
    );
    expect(maiores(seqs).map((s) => [s.start, s.alive])).toEqual([
      ["2026-10-17", true],
      ["2026-10-10", false],
      ["2026-10-01", false],
    ]);
    const semanas = melhoresSemanas(
      new Map([
        ["2026-10-12", 400],
        ["2026-10-05", 100],
        ["2026-10-06", 100],
      ]),
    );
    expect(semanas[0]).toEqual({ start: "2026-10-12", end: "2026-10-18", points: 400 });
    expect(semanas[1]?.points).toBe(200);
  });
});

describe("GET /habits/streaks e a ofensiva no resumo (RF-35)", () => {
  test("junta ofensiva geral, a do hábito e os recordes, só do dono", async () => {
    const criado = await api(dono, "POST", "/habits", {
      name: "Inglês",
      weeklyGoal: 60,
      targetDays: 2,
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    const habito = criado.body as HabitItem;
    const semana = inicioDaSemana(hoje);
    // As duas semanas anteriores batidas (dois dias de 30), a corrente não.
    for (const k of [7, 14]) {
      await registrar(dono, habito.id, somarDias(semana, -k), 30);
      await registrar(dono, habito.id, somarDias(semana, -k + 1), 30);
    }
    // Hoje e ontem com registro: ofensiva geral de pelo menos 2.
    await registrar(dono, habito.id, hoje, 10);
    await registrar(dono, habito.id, somarDias(hoje, -1), 10);

    const r = await api(dono, "GET", "/habits/streaks");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const o = r.body as HabitsStreaks;
    expect(o.today).toBe(hoje);
    expect(o.general.todayDone).toBe(true);
    expect(o.general.current).toBeGreaterThanOrEqual(2);
    expect(o.activeDays).toContain(hoje);
    const doHabito = o.habits.find((h) => h.habitId === habito.id);
    expect(doHabito).toMatchObject({ current: 2, best: 2, archived: false });
    expect(o.records.habitWeeks[0]).toMatchObject({ habitName: "Inglês", length: 2, alive: true });
    expect(o.records.days[0]?.alive).toBe(true);
    expect(o.records.weeks.length).toBeGreaterThan(0);

    const resumo = (await api(dono, "GET", "/habits/summary")).body as HabitsSummary;
    expect(resumo.streak).toEqual(o.general);

    const alheio = (await api(intruso, "GET", "/habits/streaks")).body as HabitsStreaks;
    expect(alheio).toMatchObject({ general: { current: 0, best: 0, todayDone: false } });
    expect(alheio.habits).toEqual([]);
    expect(alheio.activeDays).toEqual([]);
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/habits/streaks" });
    expect(resposta.statusCode).toBe(401);
  });
});
