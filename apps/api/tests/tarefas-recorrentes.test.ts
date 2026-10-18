import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaDaSemana,
  diaLocal,
  somarDias,
} from "@yu-book/shared";
import type { AgendaRange, ApiErrorBody, EventItem, TaskItem, TaskSeriesItem } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import {
  HORIZONTE_DAS_SERIES_DIAS,
  estenderSeriesDeTarefas,
} from "../src/modules/tarefas/tarefas.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Tarefa recorrente.
 *
 * Cada ocorrência é uma tarefa de verdade, gerada pela série de hoje até o
 * horizonte; concluir vale por ocorrência, e editar ou excluir uma só a solta
 * da série sem que a geração a refaça. A lista de abertas mostra só a de hoje
 * de cada série, e ocorrência nunca atrasa. A série se edita e se encerra por
 * `/task-series/:id`, mexendo só no que está aberto de hoje em diante. Uma
 * série de evento inteira vira série de tarefa sem apagar o passado.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

const SP = "America/Sao_Paulo";
const MCP = { via: "mcp", author: "Claude Code" };
const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6];
let hoje: string;

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.43.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

function api(
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) {
  return chamar(app, { method, url, token: usuario.token, body, ip: proximoIp() });
}

const mensagem = (body: unknown) => (body as ApiErrorBody).error?.message;

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

async function novaSerie(corpo: Record<string, unknown>): Promise<TaskItem> {
  const { status, body } = await api(dono, "POST", "/tasks", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as TaskItem;
}

async function ocorrencias(seriesId: string) {
  return prisma.task.findMany({
    where: { seriesId },
    orderBy: { date: "asc" },
    select: { id: true, date: true, title: true, completedAt: true },
  });
}

const dia = (data: Date | null) => data?.toISOString().slice(0, 10) ?? null;

async function agenda(de: string, ate: string): Promise<AgendaRange> {
  const { status, body } = await api(dono, "GET", `/agenda?from=${de}&to=${ate}`);
  expect(status).toBe(200);
  return body as AgendaRange;
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("recorrente-dono");
  intruso = await criarUsuario("recorrente-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);
  hoje = diaLocal(new Date(), SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("criar", () => {
  test("gera uma tarefa por dia da regra, de hoje até o horizonte, com a marca", async () => {
    const primeira = await novaSerie({
      title: "Duolingo",
      date: hoje,
      time: "12:30",
      repeat: { days: TODOS_OS_DIAS },
      origin: MCP,
    });
    expect(primeira).toMatchObject({ title: "Duolingo", date: hoje, time: "12:30", overdue: false });
    expect(primeira.series).toMatchObject({ days: TODOS_OS_DIAS, until: null });
    expect(primeira.ai).toMatchObject({ via: "mcp", author: "Claude Code" });

    const todas = await ocorrencias(primeira.series!.id);
    expect(todas).toHaveLength(HORIZONTE_DAS_SERIES_DIAS + 1);
    expect(dia(todas[0]!.date)).toBe(hoje);
    expect(dia(todas.at(-1)!.date)).toBe(somarDias(hoje, HORIZONTE_DAS_SERIES_DIAS));
  });

  test("só nos dias escolhidos, até o fim, e começo no passado gera de hoje", async () => {
    const amanha = somarDias(hoje, 1);
    const primeira = await novaSerie({
      title: "Candidatura",
      date: somarDias(hoje, -10),
      repeat: { days: [diaDaSemana(amanha)], until: somarDias(hoje, 20) },
    });
    const dias = (await ocorrencias(primeira.series!.id)).map((t) => dia(t.date));
    expect(dias[0]).toBe(amanha);
    expect(dias).toEqual([amanha, somarDias(amanha, 7), somarDias(amanha, 14)]);
  });

  test("sem data é recusada, e regra sem dia até o fim também", async () => {
    const semDia = await api(dono, "POST", "/tasks", { title: "x", repeat: { days: [1] } });
    expect(semDia.status).toBe(422);

    const amanha = somarDias(hoje, 1);
    const semNenhum = await api(dono, "POST", "/tasks", {
      title: "x",
      date: hoje,
      repeat: { days: [diaDaSemana(somarDias(hoje, 3))], until: amanha },
    });
    expect(semNenhum.status).toBe(422);
    expect(mensagem(semNenhum.body)).toContain("nenhum dia");
  });
});

describe("ler", () => {
  test("a lista de abertas mostra só a ocorrência de hoje da série", async () => {
    const primeira = await novaSerie({ title: "Só hoje na lista", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const { body } = await api(dono, "GET", "/tasks");
    const daSerie = (body as TaskItem[]).filter((t) => t.series?.id === primeira.series!.id);
    expect(daSerie.map((t) => t.date)).toEqual([hoje]);
  });

  test("a agenda mostra cada ocorrência no seu dia, e a de ontem não atrasa", async () => {
    const primeira = await novaSerie({ title: "Hábito", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    // Uma ocorrência que ficou para trás, aberta.
    const ontem = somarDias(hoje, -1);
    await prisma.task.update({
      where: { id: primeira.id },
      data: { date: new Date(`${ontem}T00:00:00.000Z`) },
    });

    const periodo = await agenda(ontem, somarDias(hoje, 2));
    const daSerie = periodo.tasks.filter((t) => t.series?.id === primeira.series!.id);
    expect(daSerie.map((t) => t.date)).toEqual([ontem, somarDias(hoje, 1), somarDias(hoje, 2)]);
    expect(daSerie.every((t) => !t.overdue)).toBe(true);
    expect(periodo.overdueTasks.some((t) => t.series)).toBe(false);
  });

  test("concluir uma ocorrência não toca nas outras", async () => {
    const primeira = await novaSerie({ title: "Concluir uma", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    await api(dono, "PATCH", `/tasks/${primeira.id}/complete`, {});
    const todas = await ocorrencias(primeira.series!.id);
    expect(todas.filter((t) => t.completedAt !== null).map((t) => t.id)).toEqual([primeira.id]);
  });
});

describe("uma ocorrência só", () => {
  test("editar a solta da série, e a série editada depois não a refaz", async () => {
    const primeira = await novaSerie({ title: "Inglês", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    const amanha = (await ocorrencias(serieId))[1]!;

    const editada = await api(dono, "PATCH", `/tasks/${amanha.id}`, { title: "Inglês (prova)" });
    expect(editada.status).toBe(200);
    expect(editada.body).toMatchObject({ title: "Inglês (prova)", series: null });

    await api(dono, "PATCH", `/task-series/${serieId}`, { title: "Inglês 2" });
    const doDia = await prisma.task.findMany({
      where: { userId: dono.id, date: amanha.date, title: { startsWith: "Inglês" } },
      select: { title: true, seriesId: true },
    });
    expect(doDia).toEqual([{ title: "Inglês (prova)", seriesId: null }]);
  });

  test("excluir tira só ela, e a geração não a refaz", async () => {
    const primeira = await novaSerie({ title: "Post", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    const alvo = (await ocorrencias(serieId))[2]!;

    expect((await api(dono, "DELETE", `/tasks/${alvo.id}`)).status).toBe(204);
    await api(dono, "PATCH", `/task-series/${serieId}`, { time: "09:00" });
    const dias = (await ocorrencias(serieId)).map((t) => dia(t.date));
    expect(dias).not.toContain(dia(alvo.date));
    expect(dias).toHaveLength(HORIZONTE_DAS_SERIES_DIAS);
  });

  test("converter uma ocorrência em evento a tira da série, que continua", async () => {
    const primeira = await novaSerie({ title: "Mentoria", date: hoje, time: "19:00", repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    const { status, body } = await api(dono, "POST", `/tasks/${primeira.id}/to-event`);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ date: hoje, startTime: "19:00" });

    await api(dono, "PATCH", `/task-series/${serieId}`, { title: "Mentoria!" });
    const dias = (await ocorrencias(serieId)).map((t) => dia(t.date));
    expect(dias).not.toContain(hoje);
    expect(dias[0]).toBe(somarDias(hoje, 1));
  });
});

describe("a série", () => {
  test("PATCH muda as abertas de hoje em diante e preserva a concluída", async () => {
    const primeira = await novaSerie({ title: "Revisão", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    const amanha = (await ocorrencias(serieId))[1]!;
    await api(dono, "PATCH", `/tasks/${amanha.id}/complete`, {});

    const { status, body } = await api(dono, "PATCH", `/task-series/${serieId}`, {
      title: "Revisão da semana",
      repeat: { days: [diaDaSemana(hoje)] },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body as TaskSeriesItem).toMatchObject({
      title: "Revisão da semana",
      days: [diaDaSemana(hoje)],
    });

    const todas = await ocorrencias(serieId);
    const abertas = todas.filter((t) => t.completedAt === null);
    expect(abertas.every((t) => t.title === "Revisão da semana")).toBe(true);
    expect(abertas.every((t) => diaDaSemana(dia(t.date)!) === diaDaSemana(hoje))).toBe(true);
    // A concluída de amanhã ficou, com o título de quando foi feita.
    expect(todas.find((t) => t.id === amanha.id)).toMatchObject({ title: "Revisão" });
  });

  test("DELETE encerra de hoje em diante: as abertas saem, a concluída fica avulsa", async () => {
    const primeira = await novaSerie({ title: "Encerrar", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    await api(dono, "PATCH", `/tasks/${primeira.id}/complete`, {});

    expect((await api(dono, "DELETE", `/task-series/${serieId}`)).status).toBe(204);
    expect(await prisma.taskSeries.count({ where: { id: serieId } })).toBe(0);
    const restantes = await prisma.task.findMany({
      where: { userId: dono.id, title: "Encerrar" },
      select: { id: true, seriesId: true },
    });
    expect(restantes).toEqual([{ id: primeira.id, seriesId: null }]);
  });

  test("série de outra conta é 404 em todas as rotas", async () => {
    const primeira = await novaSerie({ title: "Minha série", date: hoje, repeat: { days: [1] } });
    const id = primeira.series!.id;
    expect((await api(intruso, "GET", `/task-series/${id}`)).status).toBe(404);
    expect((await api(intruso, "PATCH", `/task-series/${id}`, { title: "x" })).status).toBe(404);
    expect((await api(intruso, "DELETE", `/task-series/${id}`)).status).toBe(404);
    expect(await prisma.taskSeries.count({ where: { id } })).toBe(1);
  });
});

describe("o relógio", () => {
  test("estende o horizonte que ficou para trás, e repetir não duplica", async () => {
    const primeira = await novaSerie({ title: "Relógio", date: hoje, repeat: { days: TODOS_OS_DIAS } });
    const serieId = primeira.series!.id;
    // Como se a série tivesse sido gerada só até amanhã.
    const amanha = somarDias(hoje, 1);
    await prisma.task.deleteMany({
      where: { seriesId: serieId, date: { gt: new Date(`${amanha}T00:00:00.000Z`) } },
    });
    await prisma.taskSeries.update({
      where: { id: serieId },
      data: { generatedThrough: new Date(`${amanha}T00:00:00.000Z`) },
    });

    await estenderSeriesDeTarefas(new Date());
    const depois = await ocorrencias(serieId);
    expect(depois.length).toBeGreaterThan(HORIZONTE_DAS_SERIES_DIAS);

    await estenderSeriesDeTarefas(new Date());
    expect(await ocorrencias(serieId)).toHaveLength(depois.length);
  });
});

describe("série de evento → série de tarefa", () => {
  test("sem alcance é recusada; com todas, o evento termina ontem e as tarefas começam hoje", async () => {
    const inicio = somarDias(hoje, -14);
    const criado = await api(dono, "POST", "/events", {
      title: "Candidaturas",
      date: inicio,
      startTime: "14:00",
      endTime: "14:30",
      location: "LinkedIn",
      repeat: { days: TODOS_OS_DIAS },
      origin: MCP,
    });
    const evento = criado.body as EventItem;

    const semAlcance = await api(dono, "POST", `/events/${evento.id}/to-task`);
    expect(semAlcance.status).toBe(422);
    expect(mensagem(semAlcance.body)).toContain("scope=todas");

    const { status, body } = await api(dono, "POST", `/events/${evento.id}/to-task?scope=todas`);
    expect(status, JSON.stringify(body)).toBe(201);
    const tarefa = body as TaskItem;
    expect(tarefa).toMatchObject({ title: "Candidaturas", date: hoje, time: "14:00" });
    expect(tarefa.series).toMatchObject({ days: TODOS_OS_DIAS, until: null });
    expect(tarefa.descriptionMd).toBe("Local: LinkedIn");
    expect(tarefa.ai).toMatchObject({ via: "mcp" });

    // O passado do evento continua; de hoje em diante, só tarefas.
    const lido = await api(dono, "GET", `/events/${evento.id}`);
    expect(lido.status).toBe(200);
    expect((lido.body as EventItem).recurrence?.until).toBe(somarDias(hoje, -1));
    const periodo = await agenda(somarDias(hoje, -1), somarDias(hoje, 1));
    expect(periodo.events.filter((e) => e.id === evento.id).map((e) => e.occurrenceDate)).toEqual([
      somarDias(hoje, -1),
    ]);
  });

  test("série que nem começou é apagada inteira", async () => {
    const criado = await api(dono, "POST", "/events", {
      title: "Futura",
      date: somarDias(hoje, 3),
      allDay: true,
      repeat: { days: TODOS_OS_DIAS },
    });
    const evento = criado.body as EventItem;
    const { status, body } = await api(dono, "POST", `/events/${evento.id}/to-task?scope=todas`);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ date: somarDias(hoje, 3), time: null });
    expect((await api(dono, "GET", `/events/${evento.id}`)).status).toBe(404);
  });
});
