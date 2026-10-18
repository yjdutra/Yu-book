import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  formatarEvento,
  inicioDaSemana,
  nivelDoXp,
  quantoConta,
  somarDias,
  xpDoNivel,
} from "@yu-book/shared";
import type { AgendaRange, EventItem, HabitItem, HabitsSummary } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Hábitos no móvel — frente Ritmo, Ritmo 2 (docs/prd-ritmo.md, §5).
 *
 * O que a tela não calcula sozinha: o estado do check-in por ocorrência no
 * `EventItem` (RF-28) e o XP com o nível (RF-31). E as duas contas puras de
 * `shared` que a tela usa para não divergir do servidor (RN-15 e RN-16).
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

const SP = "America/Sao_Paulo";
let hoje: string;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.62.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

async function preferirFuso(userId: string, timezone: string): Promise<void> {
  await prisma.aiPreference.upsert({
    where: { userId },
    create: {
      userId,
      dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
      timezone,
      allowTraining: TREINO_PERMITIDO_PADRAO,
    },
    update: { timezone },
  });
}

async function novoHabito(usuario: Usuario, corpo: Record<string, unknown>): Promise<HabitItem> {
  const { status, body } = await api(usuario, "POST", "/habits", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as HabitItem;
}

function idDaAtividade(habito: HabitItem, nome: string): string {
  const achada = habito.activities.find((a) => a.name === nome);
  if (!achada) throw new Error(`Atividade ${nome} não veio`);
  return achada.id;
}

async function agenda(de: string, ate: string): Promise<AgendaRange> {
  const r = await api(dono, "GET", `/agenda?from=${de}&to=${ate}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as AgendaRange;
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("ritmo2-dono");
  intruso = await criarUsuario("ritmo2-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);
  hoje = diaLocal(new Date(), SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("estado do check-in por ocorrência (RF-28)", () => {
  test("numa série, só a ocorrência com check-in vem marcada (CA-15)", async () => {
    const h = await novoHabito(dono, {
      name: "Inglês",
      weeklyGoal: 120,
      targetDays: 4,
      activities: [{ name: "Aula", points: 30 }],
    });
    const ontem = somarDias(hoje, -1);
    const criado = await api(dono, "POST", "/events", {
      title: "Aula diária",
      date: somarDias(hoje, -3),
      startTime: "19:00",
      endTime: "20:00",
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
      habitActivityId: idDaAtividade(h, "Aula"),
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    const serie = criado.body as EventItem;
    expect(serie.checkedIn).toBe(false);

    const feito = await api(dono, "POST", `/events/${serie.id}/check-in`, { day: ontem });
    expect(feito.status).toBe(201);

    const ocorrencias = (await agenda(somarDias(hoje, -3), hoje)).events.filter(
      (e) => e.id === serie.id,
    );
    expect(ocorrencias).toHaveLength(4);
    expect(ocorrencias.filter((e) => e.checkedIn).map((e) => e.occurrenceDate)).toEqual([ontem]);

    // `GET /events` lê pelo mesmo caminho.
    const lista = await api(dono, "GET", `/events?from=${ontem}&to=${ontem}`);
    expect((lista.body as EventItem[]).find((e) => e.id === serie.id)?.checkedIn).toBe(true);

    await api(dono, "DELETE", `/events/${serie.id}/check-in?day=${ontem}`);
    const depois = (await agenda(ontem, ontem)).events.find((e) => e.id === serie.id);
    expect(depois?.checkedIn).toBe(false);
  });

  test("evento simples: a agenda e `GET /events/:id` dizem o mesmo", async () => {
    const h = await novoHabito(dono, {
      name: "Leitura",
      weeklyGoal: 60,
      targetDays: 3,
      activities: [{ name: "Clube do livro", points: 20 }],
    });
    const { body } = await api(dono, "POST", "/events", {
      title: "Clube",
      date: hoje,
      startTime: "07:00",
      endTime: "08:00",
      habitActivityId: idDaAtividade(h, "Clube do livro"),
    });
    const evento = body as EventItem;
    expect((await api(dono, "POST", `/events/${evento.id}/check-in`, { day: hoje })).status).toBe(
      201,
    );
    expect((await agenda(hoje, hoje)).events.find((e) => e.id === evento.id)?.checkedIn).toBe(
      true,
    );
    const um = await api(dono, "GET", `/events/${evento.id}`);
    expect((um.body as EventItem).checkedIn).toBe(true);
    // O texto de `list_agenda` diz que já houve check-in, para o modelo não repetir.
    expect(formatarEvento(um.body as EventItem)).toContain(`check-in feito em ${hoje}`);
    const { checkedIn: _, ...daApiVelha } = um.body as EventItem;
    expect(formatarEvento(daApiVelha as EventItem)).not.toContain("check-in feito");
  });

  test("evento sem atividade vem com `checkedIn: false`", async () => {
    const corpo = { title: "Solto", date: hoje, allDay: true };
    const { body } = await api(dono, "POST", "/events", corpo);
    const evento = (await agenda(hoje, hoje)).events.find((e) => e.id === (body as EventItem).id);
    expect(evento?.checkedIn).toBe(false);
  });
});

describe("XP e nível (RF-31)", () => {
  test("soma tudo, de arquivado também; a semana parte da segunda (CA-16)", async () => {
    const usuario = await criarUsuario("ritmo2-xp");
    await preferirFuso(usuario.id, SP);
    const vazio = await api(usuario, "GET", "/habits/summary");
    expect(vazio.status).toBe(200);
    expect(vazio.body).toMatchObject({ today: hoje, xp: 0, weekXp: 0, level: { level: 1 } });

    const h = await novoHabito(usuario, { name: "Corpo", weeklyGoal: 30, targetDays: 3 });
    // Teto de 10 por dia: os 40 de hoje contam 10 para a meta, mas os 40 são XP.
    await api(usuario, "POST", `/habits/${h.id}/entries`, { points: 40 });
    // O domingo antes desta semana: XP total, não da semana.
    const antes = somarDias(inicioDaSemana(hoje), -1);
    await api(usuario, "POST", `/habits/${h.id}/entries`, { points: 20, day: antes });

    const outro = await novoHabito(usuario, { name: "Sono", weeklyGoal: 10, targetDays: 1 });
    await api(usuario, "POST", `/habits/${outro.id}/entries`, { points: 5 });
    await api(usuario, "PATCH", `/habits/${outro.id}`, { archived: true });

    const r = await api(usuario, "GET", "/habits/summary");
    const resumo = r.body as HabitsSummary;
    expect(resumo.xp).toBe(65);
    expect(resumo.weekXp).toBe(45);
    expect(resumo.level).toEqual({ level: 2, name: "Iniciante", from: 50, to: 150 });

    // Nada do XP alheio vaza para o intruso.
    const alheio = await api(intruso, "GET", "/habits/summary");
    expect((alheio.body as HabitsSummary).xp).toBe(0);
  });

  test("excluir o hábito leva o XP dele junto (RN-14)", async () => {
    const usuario = await criarUsuario("ritmo2-exclui");
    await preferirFuso(usuario.id, SP);
    const h = await novoHabito(usuario, { name: "Temporário", weeklyGoal: 50, targetDays: 5 });
    await api(usuario, "POST", `/habits/${h.id}/entries`, { points: 12 });
    expect(((await api(usuario, "GET", "/habits/summary")).body as HabitsSummary).xp).toBe(12);
    await api(usuario, "DELETE", `/habits/${h.id}`);
    expect(((await api(usuario, "GET", "/habits/summary")).body as HabitsSummary).xp).toBe(0);
  });

  test("sem token, 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/habits/summary" });
    expect(resposta.statusCode).toBe(401);
  });
});

describe("as contas puras de shared", () => {
  test("a curva de nível: 50, 150, 300, e as bordas exatas (RN-15)", () => {
    expect([1, 2, 3, 4].map(xpDoNivel)).toEqual([0, 50, 150, 300]);
    expect(nivelDoXp(0).level).toBe(1);
    expect(nivelDoXp(49).level).toBe(1);
    expect(nivelDoXp(50).level).toBe(2);
    expect(nivelDoXp(149).level).toBe(2);
    expect(nivelDoXp(150).level).toBe(3);
    // Nível 7 começa em 25·6·7 = 1050, o 8 em 1400: a faixa "Constante".
    expect(nivelDoXp(1265)).toEqual({ level: 7, name: "Constante", from: 1050, to: 1400 });
    for (let xp = 0; xp < 20_000; xp += 37) {
      const n = nivelDoXp(xp);
      expect(xp >= n.from && xp < n.to, `xp ${xp}`).toBe(true);
    }
  });

  test("quanto conta e quanto vira XP (RN-16, CA-13)", () => {
    expect(quantoConta(20, 30, 20)).toEqual({ conta: 10, extra: 10 });
    expect(quantoConta(20, 30, 0)).toEqual({ conta: 20, extra: 0 });
    // Já passou do teto: tudo vira XP, nada negativo.
    expect(quantoConta(15, 30, 40)).toEqual({ conta: 0, extra: 15 });
  });
});
