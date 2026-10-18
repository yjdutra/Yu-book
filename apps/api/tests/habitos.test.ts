import {
  FERRAMENTAS_SEM_AGENTE,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  somarDias,
} from "@yu-book/shared";
import type {
  ApiErrorBody,
  EventItem,
  HabitActivityItem,
  HabitEntryItem,
  HabitItem,
  NomeDoAssistente,
  TaskItem,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { instrucoesPara } from "../src/modules/assistente/agentes.service.js";
import { executar } from "../src/modules/assistente/ferramentas.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Hábitos — frente Ritmo, Ritmo 1 (docs/prd-ritmo.md).
 *
 * Hábito com atividades pontuadas; a conclusão de tarefa ligada grava o
 * registro na mesma transação e reabrir o desfaz; o check-in vale só numa
 * ocorrência real do evento; o registro avulso respeita a janela de 30 dias; a
 * semana ponderada sai da leitura; e nada de outra conta é alcançável.
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
  return `10.61.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

const codigo = (body: unknown) => (body as ApiErrorBody).error?.code;

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

async function novoHabito(corpo: Record<string, unknown>): Promise<HabitItem> {
  const { status, body } = await api(dono, "POST", "/habits", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as HabitItem;
}

function atividade(habito: HabitItem, nome: string): HabitActivityItem {
  const achada = habito.activities.find((a) => a.name === nome);
  if (!achada) throw new Error(`Atividade ${nome} não veio`);
  return achada;
}

async function registros(habitId: string) {
  return prisma.habitEntry.findMany({ where: { habitId }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("ritmo-dono");
  intruso = await criarUsuario("ritmo-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);
  hoje = diaLocal(new Date(), SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("hábitos e atividades", () => {
  test("cria o hábito com as atividades e a semana com teto (CA-01)", async () => {
    const h = await novoHabito({
      name: "Inglês",
      color: "azul",
      emblem: "idioma",
      weeklyGoal: 120,
      targetDays: 4,
      activities: [
        { name: "Aula", points: 30 },
        { name: "App", points: 10 },
        { name: "Arquitetura", points: 20 },
      ],
    });
    expect(h).toMatchObject({ name: "Inglês", color: "azul", emblem: "idioma", archived: false });
    expect(h.activities.map((a) => a.name)).toEqual(["Aula", "App", "Arquitetura"]);
    expect(h.week).toMatchObject({ cap: 30, progress: 0, extra: 0, goalMet: false });
    expect(h.week.days).toHaveLength(7);
  });

  test("nome repetido é 409, no hábito e na atividade (RN-02)", async () => {
    await novoHabito({ name: "Leitura", weeklyGoal: 60, targetDays: 5 });
    const dup = await api(dono, "POST", "/habits", { name: " Leitura ", weeklyGoal: 1, targetDays: 1 });
    expect(dup.status).toBe(409);
    expect(codigo(dup.body)).toBe("NOME_DUPLICADO");

    const h = await novoHabito({
      name: "Casa",
      weeklyGoal: 90,
      targetDays: 6,
      activities: [{ name: "Rotina mínima", points: 15 }],
    });
    const dupAtiv = await api(dono, "POST", `/habits/${h.id}/activities`, {
      name: "Rotina mínima",
      points: 5,
    });
    expect(dupAtiv.status).toBe(409);
  });

  test("arquivar some da lista padrão e volta com includeArchived", async () => {
    const h = await novoHabito({ name: "Para arquivar", weeklyGoal: 10, targetDays: 1 });
    const { body: arquivado } = await api(dono, "PATCH", `/habits/${h.id}`, { archived: true });
    expect((arquivado as HabitItem).archived).toBe(true);

    const { body: padrao } = await api(dono, "GET", "/habits");
    expect((padrao as HabitItem[]).some((x) => x.id === h.id)).toBe(false);
    const { body: todos } = await api(dono, "GET", "/habits?includeArchived=true");
    expect((todos as HabitItem[]).some((x) => x.id === h.id)).toBe(true);
  });

  test("editar a atividade muda os pontos, mas não o registro antigo (CA-07)", async () => {
    const h = await novoHabito({
      name: "Corpo",
      weeklyGoal: 30,
      targetDays: 3,
      activities: [{ name: "Caminhada", points: 10 }],
    });
    const caminhada = atividade(h, "Caminhada");
    const { status } = await api(dono, "POST", `/habits/${h.id}/entries`, { activityId: caminhada.id });
    expect(status).toBe(201);
    const editada = await api(dono, "PATCH", `/habit-activities/${caminhada.id}`, { points: 25 });
    expect((editada.body as HabitActivityItem).points).toBe(25);
    const [registro] = await registros(h.id);
    expect(registro?.points).toBe(10);
  });

  test("excluir a atividade solta a tarefa e deixa o registro sem atividade (RN-08)", async () => {
    const h = await novoHabito({
      name: "Música",
      weeklyGoal: 20,
      targetDays: 2,
      activities: [{ name: "Violão", points: 10 }],
    });
    const violao = atividade(h, "Violão");
    const { body: tarefa } = await api(dono, "POST", "/tasks", {
      title: "Praticar violão",
      habitActivityId: violao.id,
    });
    await api(dono, "PATCH", `/tasks/${(tarefa as TaskItem).id}/complete`, {});
    expect(await api(dono, "DELETE", `/habit-activities/${violao.id}`, undefined)).toMatchObject({
      status: 204,
    });
    const { body: solta } = await api(dono, "GET", `/tasks/${(tarefa as TaskItem).id}`);
    expect((solta as TaskItem).habitActivity).toBeNull();
    const [registro] = await registros(h.id);
    expect(registro).toMatchObject({ activityId: null, points: 10 });
  });
});

describe("tarefa ligada ao hábito (RF-06, RF-07)", () => {
  test("concluir pontua uma vez, concluir de novo não duplica e reabrir desfaz (CA-02)", async () => {
    const h = await novoHabito({
      name: "Estudo",
      weeklyGoal: 50,
      targetDays: 5,
      activities: [{ name: "App", points: 10 }],
    });
    const app10 = atividade(h, "App");
    const criada = await api(dono, "POST", "/tasks", { title: "App 15 min", habitActivityId: app10.id });
    expect(criada.status).toBe(201);
    const tarefa = criada.body as TaskItem;
    expect(tarefa.habitActivity).toMatchObject({
      id: app10.id,
      name: "App",
      points: 10,
      habitId: h.id,
      habitName: "Estudo",
    });

    await api(dono, "PATCH", `/tasks/${tarefa.id}/complete`, { origin: MCP });
    await api(dono, "PATCH", `/tasks/${tarefa.id}/complete`, {});
    let lista = await registros(h.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ origin: "task", points: 10, taskId: tarefa.id, aiVia: "mcp" });
    expect(lista[0]!.day.toISOString().slice(0, 10)).toBe(hoje);

    const { body: comSemana } = await api(dono, "GET", `/habits/${h.id}`);
    expect((comSemana as HabitItem).week.progress).toBe(10);

    await api(dono, "PATCH", `/tasks/${tarefa.id}/complete`, { completed: false });
    lista = await registros(h.id);
    expect(lista).toHaveLength(0);
  });

  test("tarefa sem atividade, ou com atividade arquivada, não pontua (RN-07)", async () => {
    const h = await novoHabito({
      name: "Água",
      weeklyGoal: 7,
      targetDays: 7,
      activities: [{ name: "Garrafa", points: 1 }],
    });
    const garrafa = atividade(h, "Garrafa");
    await api(dono, "PATCH", `/habit-activities/${garrafa.id}`, { archived: true });
    const { body } = await api(dono, "POST", "/tasks", { title: "Beber", habitActivityId: garrafa.id });
    await api(dono, "PATCH", `/tasks/${(body as TaskItem).id}/complete`, {});
    expect(await registros(h.id)).toHaveLength(0);
  });

  test("excluir a tarefa concluída mantém o ponto (RN-09)", async () => {
    const h = await novoHabito({
      name: "Sono",
      weeklyGoal: 5,
      targetDays: 5,
      activities: [{ name: "Deitar cedo", points: 1 }],
    });
    const { body } = await api(dono, "POST", "/tasks", {
      title: "Deitar às 23h",
      habitActivityId: atividade(h, "Deitar cedo").id,
    });
    const id = (body as TaskItem).id;
    await api(dono, "PATCH", `/tasks/${id}/complete`, {});
    await api(dono, "DELETE", `/tasks/${id}`);
    const [registro] = await registros(h.id);
    expect(registro).toMatchObject({ taskId: null, points: 1 });
  });

  test("a série copia o vínculo e a ocorrência pontua (CA-03)", async () => {
    const h = await novoHabito({
      name: "Duolingo",
      weeklyGoal: 70,
      targetDays: 7,
      activities: [{ name: "Lição", points: 10 }],
    });
    const licao = atividade(h, "Lição");
    const { status, body } = await api(dono, "POST", "/tasks", {
      title: "Lição do dia",
      date: hoje,
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
      habitActivityId: licao.id,
    });
    expect(status).toBe(201);
    const primeira = body as TaskItem;
    expect(primeira.habitActivity?.id).toBe(licao.id);
    const ligadas = await prisma.task.count({
      where: { seriesId: primeira.series!.id, habitActivityId: licao.id },
    });
    expect(ligadas).toBeGreaterThan(1);

    await api(dono, "PATCH", `/tasks/${primeira.id}/complete`, {});
    expect(await registros(h.id)).toHaveLength(1);
  });

  test("atividade de outra conta é 404 ao vincular (RN-11)", async () => {
    const { body } = await api(intruso, "POST", "/habits", {
      name: "Alheio",
      weeklyGoal: 10,
      targetDays: 1,
      activities: [{ name: "Secreta", points: 5 }],
    });
    const alheia = (body as HabitItem).activities[0]!;
    const tentativa = await api(dono, "POST", "/tasks", { title: "X", habitActivityId: alheia.id });
    expect(tentativa.status).toBe(404);
  });
});

describe("registro avulso (RF-09)", () => {
  test("com pontos livres, no dia de hoje, e a semana pondera o teto (CA-04)", async () => {
    const h = await novoHabito({ name: "Ponderado", weeklyGoal: 120, targetDays: 4 });
    await api(dono, "POST", `/habits/${h.id}/entries`, { points: 30 });
    const { status, body } = await api(dono, "POST", `/habits/${h.id}/entries`, {
      points: 10,
      note: "Série sem legenda",
      origin: MCP,
    });
    expect(status).toBe(201);
    expect(body as HabitEntryItem).toMatchObject({
      origin: "manual",
      day: hoje,
      note: "Série sem legenda",
      ai: { via: "mcp", author: "Claude Code" },
    });
    const { body: lido } = await api(dono, "GET", `/habits/${h.id}`);
    const semana = (lido as HabitItem).week;
    expect(semana.progress).toBe(30);
    expect(semana.extra).toBe(10);
    expect(semana.days.find((d) => d.day === hoje)).toMatchObject({ points: 40, counted: 30 });
  });

  test("futuro e mais de 30 dias atrás são 422; hábito arquivado é 409 (CA-06)", async () => {
    const h = await novoHabito({ name: "Janela", weeklyGoal: 10, targetDays: 1 });
    const futuro = await api(dono, "POST", `/habits/${h.id}/entries`, {
      points: 5,
      day: somarDias(hoje, 1),
    });
    expect(futuro.status).toBe(422);
    const velho = await api(dono, "POST", `/habits/${h.id}/entries`, {
      points: 5,
      day: somarDias(hoje, -31),
    });
    expect(velho.status).toBe(422);
    const limite = await api(dono, "POST", `/habits/${h.id}/entries`, {
      points: 5,
      day: somarDias(hoje, -30),
    });
    expect(limite.status).toBe(201);

    await api(dono, "PATCH", `/habits/${h.id}`, { archived: true });
    const arquivado = await api(dono, "POST", `/habits/${h.id}/entries`, { points: 5 });
    expect(arquivado.status).toBe(409);
  });

  test("histórico por período e exclusão só do avulso (RF-11, RN-10)", async () => {
    const h = await novoHabito({
      name: "Histórico",
      weeklyGoal: 10,
      targetDays: 1,
      activities: [{ name: "Ler", points: 3 }],
    });
    const { body: avulso } = await api(dono, "POST", `/habits/${h.id}/entries`, {
      points: 2,
      day: somarDias(hoje, -2),
    });
    const { body: tarefa } = await api(dono, "POST", "/tasks", {
      title: "Ler",
      habitActivityId: h.activities[0]!.id,
    });
    await api(dono, "PATCH", `/tasks/${(tarefa as TaskItem).id}/complete`, {});

    const { body: lista } = await api(
      dono,
      "GET",
      `/habits/${h.id}/entries?from=${somarDias(hoje, -7)}&to=${hoje}`,
    );
    const itens = lista as HabitEntryItem[];
    expect(itens.map((r) => r.origin)).toEqual(["task", "manual"]);

    const daTarefa = itens[0]!;
    expect((await api(dono, "DELETE", `/habit-entries/${daTarefa.id}`)).status).toBe(422);
    expect((await api(dono, "DELETE", `/habit-entries/${(avulso as HabitEntryItem).id}`)).status).toBe(204);
  });
});

describe("check-in de evento (RF-08)", () => {
  test("só em ocorrência real, sem duplicar, e desfaz (CA-05)", async () => {
    const h = await novoHabito({
      name: "Aulas",
      weeklyGoal: 60,
      targetDays: 2,
      activities: [{ name: "Aula de inglês", points: 30 }],
    });
    const aula = atividade(h, "Aula de inglês");
    const ontem = somarDias(hoje, -1);
    const criado = await api(dono, "POST", "/events", {
      title: "Aula",
      date: ontem,
      startTime: "19:00",
      endTime: "20:00",
      habitActivityId: aula.id,
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    const evento = criado.body as EventItem;
    expect(evento.habitActivity?.id).toBe(aula.id);

    const errado = await api(dono, "POST", `/events/${evento.id}/check-in`, { day: hoje });
    expect(errado.status).toBe(422);

    const primeiro = await api(dono, "POST", `/events/${evento.id}/check-in`, { day: ontem });
    expect(primeiro.status).toBe(201);
    expect(primeiro.body as HabitEntryItem).toMatchObject({ origin: "event", points: 30, day: ontem });
    await api(dono, "POST", `/events/${evento.id}/check-in`, { day: ontem });
    expect(await registros(h.id)).toHaveLength(1);

    const desfeito = await api(dono, "DELETE", `/events/${evento.id}/check-in?day=${ontem}`);
    expect(desfeito.status).toBe(204);
    expect(await registros(h.id)).toHaveLength(0);
  });

  test("numa série, vale o dia da regra; no futuro, não", async () => {
    const h = await novoHabito({
      name: "Série de aulas",
      weeklyGoal: 60,
      targetDays: 2,
      activities: [{ name: "Aula", points: 30 }],
    });
    const { body } = await api(dono, "POST", "/events", {
      title: "Aula semanal",
      date: somarDias(hoje, -14),
      startTime: "19:00",
      endTime: "20:00",
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
      habitActivityId: atividade(h, "Aula").id,
    });
    const serie = body as EventItem;
    expect((await api(dono, "POST", `/events/${serie.id}/check-in`, { day: hoje })).status).toBe(201);
    const futuro = await api(dono, "POST", `/events/${serie.id}/check-in`, { day: somarDias(hoje, 1) });
    expect(futuro.status).toBe(422);
  });

  test("evento sem atividade recusa o check-in", async () => {
    const { body } = await api(dono, "POST", "/events", { title: "Solto", date: hoje, allDay: true });
    const r = await api(dono, "POST", `/events/${(body as EventItem).id}/check-in`, { day: hoje });
    expect(r.status).toBe(422);
  });
});

describe("check-in quando a série se parte (RN-04)", () => {
  test("`esta` leva o check-in para o avulso: nada duplica e o desfazer o alcança", async () => {
    const h = await novoHabito({
      name: "Partida esta",
      weeklyGoal: 60,
      targetDays: 2,
      activities: [{ name: "Aula", points: 30 }],
    });
    const { body } = await api(dono, "POST", "/events", {
      title: "Aula diária",
      date: somarDias(hoje, -3),
      startTime: "19:00",
      endTime: "20:00",
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
      habitActivityId: atividade(h, "Aula").id,
    });
    const serie = body as EventItem;
    const ontem = somarDias(hoje, -1);
    await api(dono, "POST", `/events/${serie.id}/check-in`, { day: ontem });

    const editado = await api(
      dono,
      "PATCH",
      `/events/${serie.id}?scope=esta&occurrenceDate=${ontem}`,
      { title: "Aula remarcada" },
    );
    expect(editado.status, JSON.stringify(editado.body)).toBe(200);
    const avulso = editado.body as EventItem;
    expect(avulso.id).not.toBe(serie.id);
    expect(avulso.habitActivity?.id).toBe(atividade(h, "Aula").id);

    await api(dono, "POST", `/events/${avulso.id}/check-in`, { day: ontem });
    const lista = await registros(h.id);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.eventId).toBe(avulso.id);

    await api(dono, "DELETE", `/events/${avulso.id}/check-in?day=${ontem}`);
    expect(await registros(h.id)).toHaveLength(0);
  });

  test("`seguintes` leva os check-ins do corte em diante para a série nova", async () => {
    const h = await novoHabito({
      name: "Partida seguintes",
      weeklyGoal: 60,
      targetDays: 2,
      activities: [{ name: "Aula", points: 30 }],
    });
    const { body } = await api(dono, "POST", "/events", {
      title: "Aula",
      date: somarDias(hoje, -5),
      startTime: "07:00",
      endTime: "08:00",
      repeat: { days: [0, 1, 2, 3, 4, 5, 6] },
      habitActivityId: atividade(h, "Aula").id,
    });
    const serie = body as EventItem;
    const antes = somarDias(hoje, -4);
    const corte = somarDias(hoje, -2);
    await api(dono, "POST", `/events/${serie.id}/check-in`, { day: antes });
    await api(dono, "POST", `/events/${serie.id}/check-in`, { day: hoje });

    const { body: nova } = await api(
      dono,
      "PATCH",
      `/events/${serie.id}?scope=seguintes&occurrenceDate=${corte}`,
      { startTime: "08:00", endTime: "09:00" },
    );
    const porDia = Object.fromEntries(
      (await registros(h.id)).map((r) => [r.day.toISOString().slice(0, 10), r.eventId]),
    );
    expect(porDia[antes]).toBe(serie.id);
    expect(porDia[hoje]).toBe((nova as EventItem).id);
  });

  test("registro cuja origem sumiu passa a se excluir pela rota de registros", async () => {
    const h = await novoHabito({
      name: "Órfão",
      weeklyGoal: 10,
      targetDays: 1,
      activities: [{ name: "Coisa", points: 5 }],
    });
    const { body } = await api(dono, "POST", "/events", {
      title: "Some",
      date: hoje,
      allDay: true,
      habitActivityId: atividade(h, "Coisa").id,
    });
    const evento = body as EventItem;
    const { body: registro } = await api(dono, "POST", `/events/${evento.id}/check-in`, { day: hoje });
    await api(dono, "DELETE", `/events/${evento.id}`);
    const r = await api(dono, "DELETE", `/habit-entries/${(registro as HabitEntryItem).id}`);
    expect(r.status).toBe(204);
  });

  test("histórico só com `from` também respeita o teto da janela", async () => {
    const h = await novoHabito({ name: "Janela longa", weeklyGoal: 10, targetDays: 1 });
    const r = await api(dono, "GET", `/habits/${h.id}/entries?from=2000-01-01`);
    expect(r.status).toBe(422);
  });
});

describe("posse (CA-08)", () => {
  test("hábito, atividade, registro e check-in de outra conta são 404", async () => {
    const h = await novoHabito({
      name: "Privado",
      weeklyGoal: 10,
      targetDays: 1,
      activities: [{ name: "Coisa", points: 5 }],
    });
    const { body: registro } = await api(dono, "POST", `/habits/${h.id}/entries`, { points: 5 });
    const { body: evento } = await api(dono, "POST", "/events", {
      title: "Meu",
      date: hoje,
      allDay: true,
      habitActivityId: h.activities[0]!.id,
    });

    const tentativas = await Promise.all([
      api(intruso, "GET", `/habits/${h.id}`),
      api(intruso, "PATCH", `/habits/${h.id}`, { name: "Roubado" }),
      api(intruso, "DELETE", `/habits/${h.id}`),
      api(intruso, "POST", `/habits/${h.id}/activities`, { name: "X", points: 1 }),
      api(intruso, "PATCH", `/habit-activities/${h.activities[0]!.id}`, { points: 99 }),
      api(intruso, "DELETE", `/habit-activities/${h.activities[0]!.id}`),
      api(intruso, "GET", `/habits/${h.id}/entries`),
      api(intruso, "POST", `/habits/${h.id}/entries`, { points: 1 }),
      api(intruso, "DELETE", `/habit-entries/${(registro as HabitEntryItem).id}`),
      api(intruso, "POST", `/events/${(evento as EventItem).id}/check-in`, { day: hoje }),
      api(intruso, "DELETE", `/events/${(evento as EventItem).id}/check-in?day=${hoje}`),
    ]);
    for (const t of tentativas) expect(t.status).toBe(404);
    const { body: lista } = await api(intruso, "GET", "/habits");
    expect((lista as HabitItem[]).some((x) => x.id === h.id)).toBe(false);
  });
});

describe("chat (RF-15)", () => {
  const contexto = (permitidas: readonly NomeDoAssistente[]) => ({
    userId: dono.id,
    fuso: SP,
    origem: {
      via: "chat" as const,
      author: "modelo-de-teste",
      conversationId: crypto.randomUUID(),
      agentName: "Coach",
    },
    permitidas,
  });

  test("list_habits e log_habit executam no Assistente; criar hábito não", async () => {
    const h = await novoHabito({
      name: "Chat",
      weeklyGoal: 20,
      targetDays: 2,
      activities: [{ name: "Conversa", points: 7 }],
    });
    const lista = await executar("list_habits", {}, contexto(FERRAMENTAS_SEM_AGENTE));
    expect(lista.texto).toContain("## Chat");
    expect(lista.texto).toContain(`id: ${h.activities[0]!.id}`);

    const registro = await executar(
      "log_habit",
      { habitId: h.id, activityId: h.activities[0]!.id },
      contexto(FERRAMENTAS_SEM_AGENTE),
    );
    expect(registro.texto).toContain("+7 pts em **Chat**");
    const [gravado] = await registros(h.id);
    expect(gravado).toMatchObject({
      origin: "manual",
      aiVia: "chat",
      aiAuthor: "modelo-de-teste",
      aiAgentName: "Coach",
    });

    await expect(
      executar(
        "create_habit",
        { name: "X", weeklyGoal: 1, targetDays: 1 },
        contexto(FERRAMENTAS_SEM_AGENTE),
      ),
    ).rejects.toThrow("Ferramenta desconhecida");
  });

  test("o system do agente com log_habit manda não registrar o que a tarefa já pontua", () => {
    const texto = instrucoesPara(FERRAMENTAS_SEM_AGENTE, false);
    expect(texto).toContain("Hábitos (`log_habit`)");
    expect(texto).not.toMatch(/Criação \([^)]*log_habit/);
  });
});
