import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  diasDoEvento,
  somarDias,
} from "@yu-book/shared";
import type {
  AgendaRange,
  ApiErrorBody,
  BoardDetail,
  CardDetail,
  EventItem,
  TaskItem,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Eventos e o agregado da agenda — frente de agenda, Fase 1 (domínio).
 *
 * O que esta suíte protege, em uma frase: **o cliente não converte fuso.**
 * Entra dia e hora locais, sai dia e hora locais, e o instante gravado é o do
 * fuso do usuário (`ai_preference.timezone`) — nunca o do processo nem o do
 * navegador. Os dias fixos são de 2030, longe de "hoje", para que nenhum caso
 * dependa do relógio; o que depende dele (atrasadas, `today`) é calculado
 * no próprio caso. São Paulo não tem horário de verão desde 2019, nem Tóquio:
 * UTC−3 e UTC+9 o ano inteiro.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

const SP = "America/Sao_Paulo";
const TOQUIO = "Asia/Tokyo";
const DIA = "2030-11-12";
const INEXISTENTE = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("eventos-dono");
  intruso = await criarUsuario("eventos-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ apoio */

/// 300 requisições por minuto por IP, e esta suíte passa disso: um IP por
/// chamada, como sessões diferentes (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.31.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
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
const caminhos = (body: unknown) =>
  ((body as ApiErrorBody).error?.issues ?? []).map((issue) => issue.path);

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

/** Conta nova, já num fuso: o caso que mexe no fuso não contamina os outros. */
async function contaNoFuso(apelido: string, fuso: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await preferirFuso(usuario.id, fuso);
  return usuario;
}

async function novoEvento(usuario: Usuario, corpo: Record<string, unknown>): Promise<EventItem> {
  const { status, body } = await api(usuario, "POST", "/events", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as EventItem;
}

async function lerEvento(usuario: Usuario, id: string): Promise<EventItem> {
  const { status, body } = await api(usuario, "GET", `/events/${id}`);
  expect(status).toBe(200);
  return body as EventItem;
}

async function novoQuadro(usuario: Usuario, nome: string): Promise<BoardDetail> {
  const workspace = await prisma.workspace.create({
    data: { userId: usuario.id, name: `Espaço ${nome} ${crypto.randomUUID().slice(0, 8)}` },
  });
  const { status, body } = await api(usuario, "POST", "/boards", {
    name: `${nome} ${crypto.randomUUID().slice(0, 8)}`,
    workspaceId: workspace.id,
  });
  expect(status).toBe(201);
  return body as BoardDetail;
}

const duracaoMs = (evento: EventItem) =>
  new Date(evento.endsAt).getTime() - new Date(evento.startsAt).getTime();

const titulos = (itens: { title: string }[]) => itens.map((item) => item.title);

/* ------------------------------------------------------------------- CRUD */

describe("CRUD de evento", () => {
  test("evento com hora e sem fim nasce com uma hora de duração, e some depois de excluído", async () => {
    const criado = await novoEvento(dono, { title: "Dentista", date: DIA, startTime: "09:00" });
    expect(criado).toMatchObject({
      title: "Dentista",
      description: "",
      allDay: false,
      date: DIA,
      endDate: DIA,
      startTime: "09:00",
      endTime: "10:00",
      location: null,
      url: null,
      board: null,
      ai: null,
    });

    expect(await lerEvento(dono, criado.id)).toEqual(criado);

    const editado = await api(dono, "PATCH", `/events/${criado.id}`, {
      title: "Dentista (retorno)",
      location: "Rua das Flores, 10",
      url: "https://exemplo.test/consulta",
    });
    expect(editado.status).toBe(200);
    expect(editado.body).toMatchObject({
      title: "Dentista (retorno)",
      location: "Rua das Flores, 10",
      url: "https://exemplo.test/consulta",
    });

    const excluido = await api(dono, "DELETE", `/events/${criado.id}`);
    expect(excluido.status).toBe(204);
    expect((await api(dono, "GET", `/events/${criado.id}`)).status).toBe(404);
    expect((await api(dono, "DELETE", `/events/${criado.id}`)).status).toBe(404);
  });

  test("id que não existe é 404 em toda rota, e id malformado é 422", async () => {
    for (const [method, corpo] of [
      ["GET", undefined],
      ["PATCH", { title: "Nada" }],
      ["DELETE", undefined],
    ] as const) {
      const { status, body } = await api(dono, method, `/events/${INEXISTENTE}`, corpo);
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");
    }
    expect((await api(dono, "GET", "/events/nao-e-uuid")).status).toBe(422);
  });

  test("local e endereço vazios viram nulo, e endereço que não é http(s) é recusado", async () => {
    const evento = await novoEvento(dono, {
      title: "Sem lugar",
      date: DIA,
      allDay: true,
      location: "   ",
      url: "",
    });
    expect(evento.location).toBeNull();
    expect(evento.url).toBeNull();

    const recusa = await api(dono, "POST", "/events", {
      title: "Endereço perigoso",
      date: DIA,
      allDay: true,
      url: "javascript:alert(1)",
    });
    expect(recusa.status).toBe(422);
    expect(caminhos(recusa.body)).toContain("url");
  });
});

/* -------------------------------------------------------------- validação */

describe("validação do horário", () => {
  test("evento que não é de dia inteiro exige a hora de início", async () => {
    const { status, body } = await api(dono, "POST", "/events", { title: "Sem hora", date: DIA });
    expect(status).toBe(422);
    expect(codigo(body)).toBe("VALIDATION_ERROR");
    expect(caminhos(body)).toContain("startTime");

    // O mesmo pedido de dia inteiro não precisa de hora.
    await novoEvento(dono, { title: "Sem hora, dia inteiro", date: DIA, allDay: true });
  });

  test("fim antes do início, ou igual a ele, é recusado", async () => {
    const antes = await api(dono, "POST", "/events", {
      title: "Fim antes",
      date: DIA,
      endDate: DIA,
      startTime: "10:00",
      endTime: "09:00",
    });
    expect(antes.status).toBe(422);
    expect(caminhos(antes.body)).toContain("endTime");

    const igual = await api(dono, "POST", "/events", {
      title: "Fim igual",
      date: DIA,
      startTime: "10:00",
      endTime: "10:00",
    });
    expect(igual.status).toBe(422);
    expect(caminhos(igual.body)).toContain("endTime");

    const ultimoDiaAntes = await api(dono, "POST", "/events", {
      title: "Último dia antes do primeiro",
      date: DIA,
      endDate: somarDias(DIA, -1),
      allDay: true,
    });
    expect(ultimoDiaAntes.status).toBe(422);
    expect(caminhos(ultimoDiaAntes.body)).toContain("endDate");
  });

  test("hora de término menor sem último dia é das 22h à 1h: atravessa a meia-noite, não é recusada", async () => {
    const evento = await novoEvento(dono, {
      title: "Plantão",
      date: DIA,
      startTime: "22:00",
      endTime: "01:00",
    });
    expect(evento).toMatchObject({ endDate: somarDias(DIA, 1), endTime: "01:00" });
    expect(duracaoMs(evento)).toBe(3 * 60 * 60_000);
  });

  test("dia que casa com o formato mas não existe no calendário é recusado", async () => {
    const fevereiro = await api(dono, "POST", "/events", {
      title: "Trinta de fevereiro",
      date: "2026-02-30",
      allDay: true,
    });
    expect(fevereiro.status).toBe(422);
    expect(caminhos(fevereiro.body)).toContain("date");

    // 2026 não é bissexto.
    const bissexto = await api(dono, "POST", "/events", {
      title: "Vinte e nove de fevereiro",
      date: "2026-02-27",
      endDate: "2026-02-29",
      allDay: true,
    });
    expect(bissexto.status).toBe(422);
    expect(caminhos(bissexto.body)).toContain("endDate");

    const hora = await api(dono, "POST", "/events", {
      title: "Vinte e cinco horas",
      date: DIA,
      startTime: "25:00",
    });
    expect(hora.status).toBe(422);
    expect(caminhos(hora.body)).toContain("startTime");
  });

  test("evento dura no máximo 14 dias, contando o último inclusive", async () => {
    await novoEvento(dono, {
      title: "Quatorze dias",
      date: "2030-11-01",
      endDate: "2030-11-14",
      allDay: true,
    });
    const quinze = await api(dono, "POST", "/events", {
      title: "Quinze dias",
      date: "2030-11-01",
      endDate: "2030-11-15",
      allDay: true,
    });
    expect(quinze.status).toBe(422);
    expect(caminhos(quinze.body)).toContain("endDate");

    // Com hora, o limite é de 14 × 24 h exatas.
    await novoEvento(dono, {
      title: "Quatorze dias com hora",
      date: "2030-11-01",
      endDate: "2030-11-15",
      startTime: "10:00",
      endTime: "10:00",
    });
    const umMinutoAMais = await api(dono, "POST", "/events", {
      title: "Um minuto a mais",
      date: "2030-11-01",
      endDate: "2030-11-15",
      startTime: "10:00",
      endTime: "10:01",
    });
    expect(umMinutoAMais.status).toBe(422);
    expect(caminhos(umMinutoAMais.body)).toContain("endDate");
  });

  test("o PATCH confere a regra cruzada sobre o horário mesclado, e a recusa não grava nada", async () => {
    const evento = await novoEvento(dono, {
      title: "Reunião",
      date: DIA,
      startTime: "10:00",
      endTime: "11:00",
    });
    const antes = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });

    // O fim antes do início, no mesmo dia dito por extenso. Sem o `endDate`,
    // `endTime` menor atravessaria a meia-noite, como na criação.
    const fimAntes = await api(dono, "PATCH", `/events/${evento.id}`, {
      endDate: DIA,
      endTime: "09:00",
    });
    expect(fimAntes.status).toBe(422);
    expect(codigo(fimAntes.body)).toBe("VALIDATION_ERROR");

    // Sair do dia inteiro sem dizer a hora.
    const diaInteiro = await novoEvento(dono, { title: "Feriado", date: DIA, allDay: true });
    const semHora = await api(dono, "PATCH", `/events/${diaInteiro.id}`, { allDay: false });
    expect(semHora.status).toBe(422);

    expect(await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).toEqual(antes);
    expect((await lerEvento(dono, diaInteiro.id)).allDay).toBe(true);
  });

  test("a janela da consulta tem no máximo 62 dias e não anda para trás, em /events e em /agenda", async () => {
    for (const rota of ["/events", "/agenda"]) {
      // Novembro, dezembro e 1º de janeiro: 62 dias, os dois inclusive.
      expect((await api(dono, "GET", `${rota}?from=2030-11-01&to=2031-01-01`)).status).toBe(200);

      const longa = await api(dono, "GET", `${rota}?from=2030-11-01&to=2031-01-02`);
      expect(longa.status).toBe(422);
      expect(caminhos(longa.body)).toContain("to");

      const aoContrario = await api(dono, "GET", `${rota}?from=2030-11-12&to=2030-11-11`);
      expect(aoContrario.status).toBe(422);
      expect(caminhos(aoContrario.body)).toContain("to");

      expect((await api(dono, "GET", `${rota}?from=2030-02-30&to=2030-03-01`)).status).toBe(422);
      expect((await api(dono, "GET", `${rota}?to=2030-03-01`)).status).toBe(422);
    }
  });
});

/* ------------------------------------------------------------------- fuso */

describe("fuso do usuário", () => {
  test("o mesmo dia e hora viram instantes diferentes em São Paulo e em Tóquio, e cada um volta como foi escrito", async () => {
    const usuario = await contaNoFuso("eventos-fuso", SP);
    const pedido = { date: DIA, startTime: "09:00", endTime: "10:00" };

    const emSaoPaulo = await novoEvento(usuario, { title: "Em São Paulo", ...pedido });
    expect(emSaoPaulo.startsAt).toBe("2030-11-12T12:00:00.000Z");
    expect(emSaoPaulo).toMatchObject({ date: DIA, startTime: "09:00", endTime: "10:00" });

    await preferirFuso(usuario.id, TOQUIO);
    const emToquio = await novoEvento(usuario, { title: "Em Tóquio", ...pedido });
    expect(emToquio.startsAt).toBe("2030-11-12T00:00:00.000Z");
    expect(emToquio).toMatchObject({ date: DIA, startTime: "09:00", endTime: "10:00" });

    expect(new Date(emSaoPaulo.startsAt).getTime() - new Date(emToquio.startsAt).getTime()).toBe(
      12 * 60 * 60_000,
    );
  });

  test("trocar o fuso move o evento com hora no relógio, sem mexer no instante gravado", async () => {
    const usuario = await contaNoFuso("eventos-fuso-troca", SP);
    const evento = await novoEvento(usuario, {
      title: "Chamada",
      date: DIA,
      startTime: "09:00",
      endTime: "10:00",
    });

    await preferirFuso(usuario.id, TOQUIO);
    const visto = await lerEvento(usuario, evento.id);
    // 12:00Z é 21:00 em Tóquio, no mesmo dia.
    expect(visto).toMatchObject({
      date: DIA,
      startTime: "21:00",
      endTime: "22:00",
      startsAt: evento.startsAt,
      endsAt: evento.endsAt,
    });
  });

  test("evento das 23:30 sem fim termina às 00:30 do dia seguinte", async () => {
    const evento = await novoEvento(dono, { title: "Virada", date: DIA, startTime: "23:30" });
    expect(evento).toMatchObject({
      date: DIA,
      startTime: "23:30",
      endDate: somarDias(DIA, 1),
      endTime: "00:30",
      startsAt: "2030-11-13T02:30:00.000Z",
      endsAt: "2030-11-13T03:30:00.000Z",
    });
  });

  test("dia inteiro de vários dias vai da meia-noite local do primeiro à do dia seguinte ao último", async () => {
    const usuario = await contaNoFuso("eventos-dia-inteiro", SP);
    const emSaoPaulo = await novoEvento(usuario, {
      title: "Congresso",
      date: DIA,
      endDate: somarDias(DIA, 2),
      allDay: true,
    });
    expect(emSaoPaulo).toMatchObject({
      allDay: true,
      date: DIA,
      endDate: somarDias(DIA, 2),
      startTime: null,
      endTime: null,
      startsAt: "2030-11-12T03:00:00.000Z",
      endsAt: "2030-11-15T03:00:00.000Z",
    });

    await preferirFuso(usuario.id, TOQUIO);
    const emToquio = await novoEvento(usuario, {
      title: "Congresso em Tóquio",
      date: DIA,
      endDate: somarDias(DIA, 2),
      allDay: true,
    });
    expect(emToquio).toMatchObject({
      date: DIA,
      endDate: somarDias(DIA, 2),
      startsAt: "2030-11-11T15:00:00.000Z",
      endsAt: "2030-11-14T15:00:00.000Z",
    });
  });

  test("a janela da consulta é o dia local do usuário, não o dia UTC", async () => {
    const usuario = await contaNoFuso("eventos-janela-local", SP);
    // 22:00 em São Paulo já é o dia seguinte em UTC.
    const tarde = await novoEvento(usuario, {
      title: "Tarde da noite",
      date: DIA,
      startTime: "22:00",
      endTime: "23:00",
    });
    expect(tarde.startsAt).toBe("2030-11-13T01:00:00.000Z");

    const doDia = await api(usuario, "GET", `/events?from=${DIA}&to=${DIA}`);
    expect(titulos(doDia.body as EventItem[])).toEqual(["Tarde da noite"]);

    const doSeguinte = await api(
      usuario,
      "GET",
      `/events?from=${somarDias(DIA, 1)}&to=${somarDias(DIA, 1)}`,
    );
    expect(doSeguinte.body).toEqual([]);
  });
});

/* ---------------------------------------------------------------- PATCH */

describe("PATCH de evento", () => {
  test("mudar só o início preserva a duração, inclusive ao trocar de dia", async () => {
    const evento = await novoEvento(dono, {
      title: "Hora e meia",
      date: DIA,
      startTime: "10:00",
      endTime: "11:30",
    });

    const tarde = await api(dono, "PATCH", `/events/${evento.id}`, { startTime: "14:00" });
    expect(tarde.status).toBe(200);
    expect(tarde.body).toMatchObject({ date: DIA, startTime: "14:00", endTime: "15:30" });
    expect(duracaoMs(tarde.body as EventItem)).toBe(90 * 60_000);

    const amanha = await api(dono, "PATCH", `/events/${evento.id}`, { date: somarDias(DIA, 1) });
    expect(amanha.body).toMatchObject({
      date: somarDias(DIA, 1),
      endDate: somarDias(DIA, 1),
      startTime: "14:00",
      endTime: "15:30",
    });

    // Empurrar para perto da meia-noite leva o fim para o dia seguinte.
    const noite = await api(dono, "PATCH", `/events/${evento.id}`, { startTime: "23:00" });
    expect(noite.body).toMatchObject({ endDate: somarDias(DIA, 2), endTime: "00:30" });
    expect(duracaoMs(noite.body as EventItem)).toBe(90 * 60_000);
  });

  test("mudar só o primeiro dia de um evento de vários dias leva o último junto", async () => {
    const evento = await novoEvento(dono, {
      title: "Viagem",
      date: DIA,
      endDate: somarDias(DIA, 2),
      allDay: true,
    });
    const { body } = await api(dono, "PATCH", `/events/${evento.id}`, { date: somarDias(DIA, 5) });
    expect(body).toMatchObject({ date: somarDias(DIA, 5), endDate: somarDias(DIA, 7) });
  });

  test("trocar só o título não recalcula os instantes, nem com o fuso mudado no meio", async () => {
    const usuario = await contaNoFuso("eventos-so-titulo", SP);
    // Dia inteiro gravado em São Paulo e recalculado em Tóquio começaria doze
    // horas antes (meia-noite de Tóquio): só não recalcular o deixa no lugar.
    const diaInteiro = await novoEvento(usuario, {
      title: "Feriado",
      date: DIA,
      endDate: somarDias(DIA, 1),
      allDay: true,
    });
    const comHora = await novoEvento(usuario, { title: "Consulta", date: DIA, startTime: "09:00" });

    await preferirFuso(usuario.id, TOQUIO);
    for (const evento of [diaInteiro, comHora]) {
      const { status } = await api(usuario, "PATCH", `/events/${evento.id}`, {
        title: `${evento.title} (renomeado)`,
      });
      expect(status).toBe(200);
      const gravado = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
      expect(gravado.title).toBe(`${evento.title} (renomeado)`);
      expect(gravado.startsAt.toISOString()).toBe(evento.startsAt);
      expect(gravado.endsAt.toISOString()).toBe(evento.endsAt);
    }
  });
});

describe("PATCH de evento: o fim anda com o início (regressões da revisão)", () => {
  const patch = async (id: string, corpo: Record<string, unknown>) => {
    const { status, body } = await api(dono, "PATCH", `/events/${id}`, corpo);
    expect(status, JSON.stringify(body)).toBe(200);
    return body as EventItem;
  };
  const reuniao = (date: string) =>
    novoEvento(dono, { title: "Reunião", date, startTime: "10:00", endTime: "11:00" });
  const plantao = () =>
    novoEvento(dono, { title: "Plantão", date: DIA, startTime: "22:00", endTime: "01:00" });

  test("mudar o dia para trás com início e fim não estica o evento até o dia gravado", async () => {
    const evento = await reuniao(somarDias(DIA, 3));
    const movido = await patch(evento.id, {
      date: somarDias(DIA, -2),
      startTime: "10:00",
      endTime: "11:00",
    });
    expect(movido).toMatchObject({ date: somarDias(DIA, -2), endDate: somarDias(DIA, -2) });
    expect(duracaoMs(movido)).toBe(60 * 60_000);
  });

  test("mudar o dia para frente com início e fim não é recusado por fim antes do início", async () => {
    const evento = await reuniao(somarDias(DIA, 3));
    const movido = await patch(evento.id, {
      date: somarDias(DIA, 8),
      startTime: "10:00",
      endTime: "11:00",
    });
    expect(movido).toMatchObject({ date: somarDias(DIA, 8), endDate: somarDias(DIA, 8) });
    expect(duracaoMs(movido)).toBe(60 * 60_000);
  });

  test("dia inteiro movido para trás, com as horas nulas, continua de um dia só", async () => {
    const evento = await novoEvento(dono, {
      title: "Feriado",
      date: somarDias(DIA, 3),
      allDay: true,
    });
    const movido = await patch(evento.id, {
      date: somarDias(DIA, -2),
      startTime: null,
      endTime: null,
    });
    expect(movido).toMatchObject({
      allDay: true,
      date: somarDias(DIA, -2),
      endDate: somarDias(DIA, -2),
    });
  });

  test("só o fim, antes do início, atravessa a meia-noite como no POST", async () => {
    const evento = await reuniao(DIA);
    const madrugada = await patch(evento.id, { endTime: "01:00" });
    expect(madrugada).toMatchObject({ date: DIA, endDate: somarDias(DIA, 1), endTime: "01:00" });
    expect(duracaoMs(madrugada)).toBe(15 * 60 * 60_000);
  });

  test("só o fim, depois do início, traz de volta ao mesmo dia o evento que atravessava", async () => {
    const evento = await plantao();
    const curto = await patch(evento.id, { endTime: "23:30" });
    expect(curto).toMatchObject({ date: DIA, endDate: DIA, endTime: "23:30" });
    expect(duracaoMs(curto)).toBe(90 * 60_000);
  });

  test("fim nulo volta ao padrão de uma hora, e não é recusado", async () => {
    const evento = await plantao();
    const padrao = await patch(evento.id, { endTime: null });
    expect(padrao).toMatchObject({ date: DIA, endDate: DIA, startTime: "22:00", endTime: "23:00" });
    expect(duracaoMs(padrao)).toBe(60 * 60_000);
  });

  test("num evento com hora de vários dias, mudar só o fim mantém o vão em dias", async () => {
    const evento = await novoEvento(dono, {
      title: "Congresso",
      date: DIA,
      endDate: somarDias(DIA, 2),
      startTime: "10:00",
      endTime: "18:00",
    });
    const cedo = await patch(evento.id, { endTime: "09:00" });
    expect(cedo).toMatchObject({ date: DIA, endDate: somarDias(DIA, 2), endTime: "09:00" });

    // Mudar só o dia leva o último junto, com a duração inteira.
    const adiado = await patch(evento.id, { date: somarDias(DIA, 1) });
    expect(adiado).toMatchObject({ endDate: somarDias(DIA, 3), endTime: "09:00" });
  });
});

describe("dias em que o evento aparece", () => {
  test("diasDoEvento e GET /agenda concordam dia a dia, inclusive no evento que acaba às 00:00", async () => {
    const usuario = await contaNoFuso("eventos-dias", SP);
    const eventos = [
      await novoEvento(usuario, {
        title: "Acaba à meia-noite",
        date: DIA,
        startTime: "23:00",
        endTime: "00:00",
      }),
      await novoEvento(usuario, {
        title: "Atravessa a meia-noite",
        date: DIA,
        startTime: "23:00",
        endTime: "01:00",
      }),
      await novoEvento(usuario, {
        title: "Dois dias inteiros",
        date: DIA,
        endDate: somarDias(DIA, 1),
        allDay: true,
      }),
      await novoEvento(usuario, { title: "Manhã", date: DIA, startTime: "09:00" }),
    ];

    const meiaNoite = eventos[0] as EventItem;
    // O `endDate` é o dia do término, mas o evento não ocupa nada dele.
    expect(meiaNoite.endDate).toBe(somarDias(DIA, 1));
    expect(diasDoEvento(meiaNoite)).toEqual([DIA]);
    expect(diasDoEvento(eventos[1] as EventItem)).toEqual([DIA, somarDias(DIA, 1)]);
    expect(diasDoEvento(eventos[2] as EventItem)).toEqual([DIA, somarDias(DIA, 1)]);

    for (const dia of [somarDias(DIA, -1), DIA, somarDias(DIA, 1), somarDias(DIA, 2)]) {
      const { body } = await api(usuario, "GET", `/agenda?from=${dia}&to=${dia}`);
      const vindos = (body as AgendaRange).events.map((e) => e.id).sort();
      const esperados = eventos
        .filter((e) => diasDoEvento(e).includes(dia))
        .map((e) => e.id)
        .sort();
      expect(vindos, dia).toEqual(esperados);
    }
  });
});

/* ------------------------------------------------------------ marca de IA */

describe("marca de IA no evento", () => {
  const MCP = { via: "mcp", author: "Claude Desktop" };

  test("criar com origin do MCP grava a marca no evento, e só o servidor a escreve", async () => {
    const evento = await novoEvento(dono, {
      title: "Marcado pelo MCP",
      date: DIA,
      allDay: true,
      origin: MCP,
    });
    expect(evento.ai).toMatchObject({
      via: "mcp",
      author: "Claude Desktop",
      conversationId: null,
      agentName: null,
      runId: null,
      routineName: null,
      revisedAt: null,
    });
    expect(evento.ai?.generatedAt).toEqual(expect.any(String));
  });

  test("a HTTP não aceita origin de outra via: o cliente não forja marca de chat", async () => {
    const titulo = `Forjado ${crypto.randomUUID()}`;
    const { status } = await api(dono, "POST", "/events", {
      title: titulo,
      date: DIA,
      allDay: true,
      origin: { via: "chat", author: "x", conversationId: INEXISTENTE },
    });
    expect(status).toBe(422);
    expect(await prisma.event.count({ where: { title: titulo } })).toBe(0);
  });

  test("origin no PATCH é descartado: editar não fabrica marca de IA", async () => {
    const evento = await novoEvento(dono, { title: "Humano", date: DIA, allDay: true });
    const { status, body } = await api(dono, "PATCH", `/events/${evento.id}`, {
      title: "Ainda humano",
      origin: MCP,
    });
    // O schema descarta a chave e o PATCH segue 200: a prova é o que ficou gravado.
    expect(status).toBe(200);
    expect((body as EventItem).ai).toBeNull();
    const gravado = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(gravado.title).toBe("Ainda humano");
    expect(gravado.aiGeneratedAt).toBeNull();
    expect(gravado.aiVia).toBeNull();
  });

  test("editar o texto de evento gerado registra revisão sem apagar a marca; mudar o local, não", async () => {
    const evento = await novoEvento(dono, {
      title: "Gerado",
      date: DIA,
      allDay: true,
      origin: MCP,
    });

    const local = await api(dono, "PATCH", `/events/${evento.id}`, { location: "Sala 2" });
    expect((local.body as EventItem).ai).toMatchObject({ via: "mcp", revisedAt: null });

    const texto = await api(dono, "PATCH", `/events/${evento.id}`, { title: "Gerado e revisado" });
    expect((texto.body as EventItem).ai).toMatchObject({
      via: "mcp",
      author: "Claude Desktop",
      generatedAt: evento.ai?.generatedAt,
      revisedAt: expect.any(String),
    });
  });
});

/* ------------------------------------------------------------------ posse */

describe("posse do evento", () => {
  test("intruso recebe 404 em toda rota de evento, e o evento fica intacto", async () => {
    const evento = await novoEvento(dono, {
      title: "Só do dono",
      date: DIA,
      startTime: "08:00",
    });
    const antes = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });

    for (const [method, corpo] of [
      ["GET", undefined],
      ["PATCH", { title: "Invadido", startTime: "03:00" }],
      ["DELETE", undefined],
    ] as const) {
      const { status, body } = await api(intruso, method, `/events/${evento.id}`, corpo);
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");
    }

    expect(await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).toEqual(antes);

    const lista = await api(intruso, "GET", `/events?from=${DIA}&to=${DIA}`);
    expect((lista.body as EventItem[]).map((e) => e.id)).not.toContain(evento.id);
    const agenda = await api(intruso, "GET", `/agenda?from=${DIA}&to=${DIA}`);
    expect((agenda.body as AgendaRange).events.map((e) => e.id)).not.toContain(evento.id);
  });

  test("quadro de outra conta é 404 na criação e no PATCH, como se não existisse", async () => {
    const alheio = await novoQuadro(intruso, "Quadro do intruso");
    const titulo = `Com quadro alheio ${crypto.randomUUID()}`;

    for (const boardId of [alheio.id, INEXISTENTE]) {
      const { status, body } = await api(dono, "POST", "/events", {
        title: titulo,
        date: DIA,
        allDay: true,
        boardId,
      });
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");
    }
    expect(await prisma.event.count({ where: { title: titulo } })).toBe(0);

    const proprio = await novoQuadro(dono, "Quadro do dono");
    const evento = await novoEvento(dono, {
      title: "Com quadro",
      date: DIA,
      allDay: true,
      boardId: proprio.id,
    });
    expect(evento.board).toEqual({ id: proprio.id, name: proprio.name });

    const patch = await api(dono, "PATCH", `/events/${evento.id}`, { boardId: alheio.id });
    expect(patch.status).toBe(404);
    const gravado = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(gravado.boardId).toBe(proprio.id);
  });
});

/* -------------------------------------------------------------- intervalo */

describe("consulta por intervalo", () => {
  test("pega o evento que atravessa a borda e deixa de fora o que só encosta nela", async () => {
    const usuario = await contaNoFuso("eventos-borda", SP);
    const ontem = somarDias(DIA, -1);
    const amanha = somarDias(DIA, 1);

    await novoEvento(usuario, {
      title: "Atravessa a entrada",
      date: ontem,
      startTime: "23:00",
      endTime: "01:00",
    });
    await novoEvento(usuario, {
      title: "Termina na meia-noite de entrada",
      date: ontem,
      startTime: "23:00",
      endTime: "00:00",
    });
    await novoEvento(usuario, {
      title: "Começa na meia-noite de saída",
      date: amanha,
      startTime: "00:00",
    });
    await novoEvento(usuario, {
      title: "Cobre a janela inteira",
      date: somarDias(DIA, -2),
      endDate: somarDias(DIA, 2),
      allDay: true,
    });
    await novoEvento(usuario, { title: "Fora", date: somarDias(DIA, 3), startTime: "10:00" });

    const { status, body } = await api(usuario, "GET", `/events?from=${DIA}&to=${DIA}`);
    expect(status).toBe(200);
    // Ordem de início.
    expect(titulos(body as EventItem[])).toEqual(["Cobre a janela inteira", "Atravessa a entrada"]);
  });

  test("o evento mais longo possível, começado bem antes da janela, ainda aparece nela", async () => {
    // A consulta tem piso em `startsAt` (início da janela menos o máximo de um
    // evento e um dia de folga) para o índice cortar; o piso não pode perder
    // o evento de 14 dias que termina dentro da janela.
    const usuario = await contaNoFuso("eventos-piso", SP);
    await novoEvento(usuario, {
      title: "Quatorze dias inteiros",
      date: somarDias(DIA, -13),
      endDate: DIA,
      allDay: true,
    });
    await novoEvento(usuario, {
      title: "Quatorze dias com hora",
      date: somarDias(DIA, -14),
      endDate: DIA,
      startTime: "08:00",
      endTime: "08:00",
    });
    await novoEvento(usuario, {
      title: "Acabou antes",
      date: somarDias(DIA, -14),
      endDate: somarDias(DIA, -1),
      allDay: true,
    });

    const { body } = await api(usuario, "GET", `/events?from=${DIA}&to=${DIA}`);
    expect(titulos(body as EventItem[])).toEqual([
      "Quatorze dias com hora",
      "Quatorze dias inteiros",
    ]);
  });
});

/* ----------------------------------------------------------------- agenda */

describe("agenda agregada", () => {
  async function prazo(
    usuario: Usuario,
    colunaId: string,
    title: string,
    dueDate: string,
  ): Promise<CardDetail> {
    const { status, body } = await api(usuario, "POST", "/cards", {
      columnId: colunaId,
      title,
      dueDate,
    });
    expect(status).toBe(201);
    return body as CardDetail;
  }

  test("traz eventos, tarefas com data no período e cards abertos com prazo no dia, sem os concluídos nem os arquivados", async () => {
    const usuario = await contaNoFuso("agenda-agregada", SP);
    const quadro = await novoQuadro(usuario, "Agenda");
    const coluna = quadro.columns[0]?.id ?? "";

    await novoEvento(usuario, { title: "Evento do dia", date: DIA, startTime: "15:00" });
    await novoEvento(usuario, { title: "Evento fora", date: somarDias(DIA, 1), startTime: "15:00" });

    const tarefa = async (corpo: Record<string, unknown>) => {
      const { status, body } = await api(usuario, "POST", "/tasks", corpo);
      expect(status).toBe(201);
      return body as TaskItem;
    };
    await tarefa({ title: "Tarefa com hora", date: DIA, time: "08:00" });
    await tarefa({ title: "Tarefa do dia", date: DIA });
    const feita = await tarefa({ title: "Tarefa concluída do dia", date: DIA, time: "09:00" });
    await api(usuario, "PATCH", `/tasks/${feita.id}/complete`, {});
    await tarefa({ title: "Tarefa fora", date: somarDias(DIA, 1) });
    await tarefa({ title: "Tarefa sem data" });

    // 23:59:59 em São Paulo, o prazo que o front grava.
    const doDia = await prazo(usuario, coluna, "Card do dia", "2030-11-13T02:59:59.000Z");
    await prazo(usuario, coluna, "Card de amanhã", "2030-11-13T15:00:00.000Z");
    const concluido = await prazo(usuario, coluna, "Card concluído", "2030-11-12T15:00:00.000Z");
    await api(usuario, "PATCH", `/cards/${concluido.id}/complete`, { completed: true });
    const arquivado = await prazo(usuario, coluna, "Card arquivado", "2030-11-12T15:00:00.000Z");
    await api(usuario, "PATCH", `/cards/${arquivado.id}`, { archived: true });

    const { status, body } = await api(usuario, "GET", `/agenda?from=${DIA}&to=${DIA}`);
    expect(status).toBe(200);
    const agenda = body as AgendaRange;

    expect(agenda).toMatchObject({
      timezone: SP,
      today: diaLocal(new Date(), SP),
      from: DIA,
      to: DIA,
    });
    expect(titulos(agenda.events)).toEqual(["Evento do dia"]);
    // Abertas e concluídas; no mesmo dia, a sem hora antes das marcadas.
    expect(titulos(agenda.tasks)).toEqual([
      "Tarefa do dia",
      "Tarefa com hora",
      "Tarefa concluída do dia",
    ]);
    expect(agenda.cards).toEqual([
      expect.objectContaining({
        id: doDia.id,
        title: "Card do dia",
        date: DIA,
        dueDate: "2030-11-13T02:59:59.000Z",
        boardId: quadro.id,
        columnName: quadro.columns[0]?.name,
      }),
    ]);
  });

  test("o prazo às 23:59:59 de São Paulo fica no seu dia local e não pula para o seguinte", async () => {
    const usuario = await contaNoFuso("agenda-prazo-local", SP);
    const quadro = await novoQuadro(usuario, "Prazo local");
    // Em UTC, este prazo já é dia 13.
    await prazo(usuario, quadro.columns[0]?.id ?? "", "Fim do dia 12", "2030-11-13T02:59:59.000Z");

    const dia12 = await api(usuario, "GET", `/agenda?from=${DIA}&to=${DIA}`);
    expect((dia12.body as AgendaRange).cards.map((c) => [c.title, c.date])).toEqual([
      ["Fim do dia 12", DIA],
    ]);

    const dia13 = somarDias(DIA, 1);
    const seguinte = await api(usuario, "GET", `/agenda?from=${dia13}&to=${dia13}`);
    expect((seguinte.body as AgendaRange).cards).toEqual([]);
  });

  test("com o período no futuro, as atrasadas vêm à parte, abertas e da mais antiga", async () => {
    const usuario = await contaNoFuso("agenda-atrasadas", SP);
    const hoje = diaLocal(new Date(), SP);

    const criar = async (title: string, date: string) => {
      const { body } = await api(usuario, "POST", "/tasks", { title, date });
      return body as TaskItem;
    };
    await criar("Atrasada há 3 dias", somarDias(hoje, -3));
    await criar("Atrasada há 5 dias", somarDias(hoje, -5));
    const feita = await criar("Atrasada, mas concluída", somarDias(hoje, -4));
    await api(usuario, "PATCH", `/tasks/${feita.id}/complete`, {});
    await criar("De hoje", hoje);

    // Um período depois de hoje: toda atrasada é anterior a ele, e vem à parte.
    const { body } = await api(usuario, "GET", `/agenda?from=${DIA}&to=${DIA}`);
    const agenda = body as AgendaRange;
    expect(titulos(agenda.overdueTasks)).toEqual(["Atrasada há 5 dias", "Atrasada há 3 dias"]);
    expect(agenda.overdueTasks.every((t) => t.overdue)).toBe(true);
    expect(agenda.tasks).toEqual([]);
  });

  test("atrasada dentro do período vem só em tasks; em overdueTasks, só as de antes dele", async () => {
    const usuario = await contaNoFuso("agenda-atrasadas-no-periodo", SP);
    const hoje = diaLocal(new Date(), SP);
    const criar = async (title: string, date: string) => {
      const { status } = await api(usuario, "POST", "/tasks", { title, date });
      expect(status).toBe(201);
    };
    await criar("Antes do período", somarDias(hoje, -5));
    await criar("No período, atrasada", somarDias(hoje, -2));
    await criar("No período, de hoje", hoje);

    const { body } = await api(
      usuario,
      "GET",
      `/agenda?from=${somarDias(hoje, -3)}&to=${somarDias(hoje, 1)}`,
    );
    const agenda = body as AgendaRange;
    expect(titulos(agenda.overdueTasks)).toEqual(["Antes do período"]);
    expect(agenda.tasks.map((t) => [t.title, t.overdue])).toEqual([
      ["No período, atrasada", true],
      ["No período, de hoje", false],
    ]);
    // Nenhuma tarefa sai nas duas listas.
    const ids = [...agenda.tasks, ...agenda.overdueTasks].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a agenda de uma conta não mostra card, tarefa nem evento de outra", async () => {
    const quadro = await novoQuadro(dono, "Agenda do dono");
    await prazo(dono, quadro.columns[0]?.id ?? "", "Prazo do dono", "2030-11-12T15:00:00.000Z");
    await api(dono, "POST", "/tasks", { title: "Tarefa do dono", date: DIA });
    await novoEvento(dono, { title: "Evento do dono", date: DIA, startTime: "07:00" });

    const vista = await contaNoFuso("agenda-vizinha", SP);
    const { body } = await api(vista, "GET", `/agenda?from=${DIA}&to=${DIA}`);
    const agenda = body as AgendaRange;
    expect(agenda.events).toEqual([]);
    expect(agenda.tasks).toEqual([]);
    expect(agenda.cards).toEqual([]);
    expect(agenda.overdueTasks).toEqual([]);
  });
});

/* --------------------------------------------------------------- cascata */

describe("cascata", () => {
  test("excluir o quadro solta o evento, sem apagá-lo", async () => {
    const quadro = await novoQuadro(dono, "Projeto que acaba");
    const evento = await novoEvento(dono, {
      title: "Do projeto",
      date: DIA,
      allDay: true,
      boardId: quadro.id,
    });
    expect(evento.board?.id).toBe(quadro.id);

    expect((await api(dono, "DELETE", `/boards/${quadro.id}`)).status).toBe(204);

    const depois = await lerEvento(dono, evento.id);
    expect(depois.board).toBeNull();
    expect(depois.title).toBe("Do projeto");
  });

  // Por último: `limpar()` leva também as contas desta suíte.
  test("limpar() leva os eventos das contas de teste pela cascata, sem deixar linha órfã", async () => {
    const usuario = await contaNoFuso("eventos-limpeza", SP);
    const quadro = await novoQuadro(usuario, "Limpeza");
    const evento = await novoEvento(usuario, {
      title: "Some com a conta",
      date: DIA,
      allDay: true,
      boardId: quadro.id,
      origin: { via: "mcp", author: "Claude Desktop" },
    });
    const contas = [usuario.id, dono.id, intruso.id];
    expect(await prisma.event.count({ where: { userId: { in: contas } } })).toBeGreaterThan(0);

    await limpar();

    expect(await prisma.event.count({ where: { id: evento.id } })).toBe(0);
    expect(await prisma.event.count({ where: { userId: { in: contas } } })).toBe(0);
    expect(await prisma.aiPreference.count({ where: { userId: { in: contas } } })).toBe(0);
    expect(await prisma.board.count({ where: { id: quadro.id } })).toBe(0);
  });
});
