import { TETO_DIARIO_PADRAO_MICROS, TREINO_PERMITIDO_PADRAO } from "@yu-book/shared";
import type { ApiErrorBody, BoardDetail, EventItem, TaskItem } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Conversão de evento em tarefa e de tarefa em evento.
 *
 * As duas são uma transação: o item novo nasce e o antigo sai, com título,
 * descrição, dia, hora e projeto levados de um para o outro e a marca de IA
 * copiada (INV-58). Numa série, só uma ocorrência vira tarefa; tarefa sem
 * data pede o dia, e tarefa concluída não vira evento.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
let quadroId: string;

const SP = "America/Sao_Paulo";
const DIA = "2030-11-12"; // terça-feira
const MCP = { via: "mcp", author: "Claude Code" };

let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.41.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
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

async function novoEvento(corpo: Record<string, unknown>): Promise<EventItem> {
  const { status, body } = await api(dono, "POST", "/events", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as EventItem;
}

async function novaTarefa(corpo: Record<string, unknown>): Promise<TaskItem> {
  const { status, body } = await api(dono, "POST", "/tasks", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as TaskItem;
}

async function eventosDe(de: string, ate: string): Promise<EventItem[]> {
  const { status, body } = await api(dono, "GET", `/events?from=${de}&to=${ate}`);
  expect(status).toBe(200);
  return body as EventItem[];
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("conversao-dono");
  intruso = await criarUsuario("conversao-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);

  const ws = await api(dono, "POST", "/workspaces", { name: "Conversão" });
  const quadro = await api(dono, "POST", "/boards", {
    workspaceId: (ws.body as { id: string }).id,
    name: "Projeto da conversão",
  });
  quadroId = (quadro.body as BoardDetail).id;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("evento → tarefa", () => {
  test("o evento simples vira tarefa com dia, hora, projeto e o local na descrição", async () => {
    const evento = await novoEvento({
      title: "Consulta",
      description: "Levar exames",
      date: DIA,
      startTime: "14:30",
      endTime: "15:30",
      location: "Clínica Central",
      boardId: quadroId,
      origin: MCP,
    });

    const { status, body } = await api(dono, "POST", `/events/${evento.id}/to-task`);
    expect(status, JSON.stringify(body)).toBe(201);
    const tarefa = body as TaskItem;
    expect(tarefa).toMatchObject({
      title: "Consulta",
      date: DIA,
      time: "14:30",
      completedAt: null,
      board: { id: quadroId },
    });
    expect(tarefa.descriptionMd).toBe("Levar exames\n\nLocal: Clínica Central");
    // A marca vai junto: o conteúdo não deixa de ter sido gerado.
    expect(tarefa.ai).toMatchObject({ via: "mcp", author: "Claude Code" });

    const lido = await api(dono, "GET", `/events/${evento.id}`);
    expect(lido.status).toBe(404);
  });

  test("o evento de dia inteiro vira tarefa sem hora", async () => {
    const evento = await novoEvento({ title: "Feriado", date: DIA, allDay: true });
    const { status, body } = await api(dono, "POST", `/events/${evento.id}/to-task`);
    expect(status).toBe(201);
    expect(body).toMatchObject({ date: DIA, time: null, ai: null });
  });

  test("o corpo passa por cima: sem data, a hora vai junto", async () => {
    const evento = await novoEvento({ title: "Ligar", date: DIA, startTime: "09:00" });
    const { status, body } = await api(dono, "POST", `/events/${evento.id}/to-task`, {
      title: "Ligar para o banco",
      date: null,
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ title: "Ligar para o banco", date: null, time: null });
  });

  test("numa série, só a ocorrência pedida vira tarefa, e as outras ficam", async () => {
    // Terças e quintas a partir de 12/11: 12, 14, 19, 21.
    const serie = await novoEvento({
      title: "Academia",
      date: DIA,
      startTime: "07:00",
      repeat: { days: [2, 4], until: "2030-11-21" },
    });

    const semEscopo = await api(dono, "POST", `/events/${serie.id}/to-task`);
    expect(semEscopo.status).toBe(422);
    expect(mensagem(semEscopo.body)).toContain("scope=esta");

    // `scope=todas` faz da série uma tarefa recorrente: ver tarefas-recorrentes.test.ts.

    const { status, body } = await api(
      dono,
      "POST",
      `/events/${serie.id}/to-task?scope=esta&occurrenceDate=2030-11-14`,
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({ title: "Academia", date: "2030-11-14", time: "07:00" });

    const restantes = (await eventosDe(DIA, "2030-11-21")).filter((e) => e.id === serie.id);
    expect(restantes.map((e) => e.occurrenceDate)).toEqual([
      "2030-11-12",
      "2030-11-19",
      "2030-11-21",
    ]);
  });

  test("a última ocorrência viva convertida apaga a série", async () => {
    const serie = await novoEvento({
      title: "Uma vez só",
      date: DIA,
      startTime: "08:00",
      repeat: { days: [2], until: DIA },
    });
    const { status } = await api(
      dono,
      "POST",
      `/events/${serie.id}/to-task?scope=esta&occurrenceDate=${DIA}`,
    );
    expect(status).toBe(201);
    expect((await api(dono, "GET", `/events/${serie.id}`)).status).toBe(404);
  });

  test("evento de outra conta é 404, e nada muda", async () => {
    const evento = await novoEvento({ title: "Meu", date: DIA, startTime: "10:00" });
    const { status, body } = await api(intruso, "POST", `/events/${evento.id}/to-task`);
    expect(status).toBe(404);
    expect(codigo(body)).toBe("NOT_FOUND");
    expect((await api(dono, "GET", `/events/${evento.id}`)).status).toBe(200);
  });
});

describe("tarefa → evento", () => {
  test("a tarefa com hora vira evento de uma hora, e a tarefa some", async () => {
    const tarefa = await novaTarefa({
      title: "Revisar contrato",
      descriptionMd: "Cláusula 4",
      date: DIA,
      time: "16:00",
      boardId: quadroId,
      origin: MCP,
    });

    const { status, body } = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      title: "Revisar contrato",
      description: "Cláusula 4",
      allDay: false,
      date: DIA,
      startTime: "16:00",
      endTime: "17:00",
      recurrence: null,
      board: { id: quadroId },
      ai: { via: "mcp", author: "Claude Code" },
    });
    expect((await api(dono, "GET", `/tasks/${tarefa.id}`)).status).toBe(404);
  });

  test("a tarefa com data e sem hora vira evento de dia inteiro", async () => {
    const tarefa = await novaTarefa({ title: "Pagar IPVA", date: DIA });
    const { status, body } = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`);
    expect(status).toBe(201);
    expect(body).toMatchObject({ allDay: true, date: DIA, startTime: null });
  });

  test("tarefa sem data pede o dia; com ele, converte com o horário do corpo", async () => {
    const tarefa = await novaTarefa({ title: "Marcar dentista" });

    const semDia = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`);
    expect(semDia.status).toBe(422);
    expect(mensagem(semDia.body)).toContain("dia");
    expect((await api(dono, "GET", `/tasks/${tarefa.id}`)).status).toBe(200);

    const { status, body } = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`, {
      date: DIA,
      startTime: "11:00",
      endTime: "11:30",
      location: "Consultório",
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body).toMatchObject({
      date: DIA,
      startTime: "11:00",
      endTime: "11:30",
      location: "Consultório",
    });
  });

  test("com repetição no corpo, a tarefa vira série", async () => {
    const tarefa = await novaTarefa({ title: "Inglês", date: DIA, time: "19:00" });
    const { status, body } = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`, {
      repeat: { days: [2, 4] },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect((body as EventItem).recurrence).toMatchObject({ days: [2, 4] });
  });

  test("tarefa concluída é recusada e continua lá", async () => {
    const tarefa = await novaTarefa({ title: "Feita", date: DIA });
    await api(dono, "PATCH", `/tasks/${tarefa.id}/complete`, {});

    const { status, body } = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`);
    expect(status).toBe(422);
    expect(mensagem(body)).toContain("reabra");
    expect((await api(dono, "GET", `/tasks/${tarefa.id}`)).status).toBe(200);
  });

  test("tarefa de outra conta é 404", async () => {
    const tarefa = await novaTarefa({ title: "Minha", date: DIA });
    const { status } = await api(intruso, "POST", `/tasks/${tarefa.id}/to-event`);
    expect(status).toBe(404);
    expect((await api(dono, "GET", `/tasks/${tarefa.id}`)).status).toBe(200);
  });

  test("ida e volta preserva título, dia, hora e projeto", async () => {
    const tarefa = await novaTarefa({
      title: "Ida e volta",
      date: DIA,
      time: "08:15",
      boardId: quadroId,
    });
    const ida = await api(dono, "POST", `/tasks/${tarefa.id}/to-event`);
    const evento = ida.body as EventItem;
    const volta = await api(dono, "POST", `/events/${evento.id}/to-task`);
    expect(volta.status).toBe(201);
    expect(volta.body).toMatchObject({
      title: "Ida e volta",
      date: DIA,
      time: "08:15",
      board: { id: quadroId },
    });
  });
});
