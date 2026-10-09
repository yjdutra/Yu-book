import {
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
  diaLocal,
  somarDias,
} from "@yu-book/shared";
import type { AgendaRange, ApiErrorBody, BoardDetail, TaskItem } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { AppError } from "../src/lib/errors.js";
import {
  atualizarTarefa,
  criarTarefa,
  quadroQueSumiu,
} from "../src/modules/tarefas/tarefas.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Tarefas — frente de agenda, Fase 1 (domínio).
 *
 * A tarefa é o to-do solto: data **civil** (não passa por fuso), hora só com
 * data, quadro opcional como projeto. O fuso só entra para dizer o que é hoje,
 * e daí o que está atrasado. A conclusão segue INV-63, como a do card: a marca
 * de quem concluiu acompanha o estado, e a decisão de trocá-la mora no `where`.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;

const SP = "America/Sao_Paulo";
const TOQUIO = "Asia/Tokyo";
const DIA = "2030-11-12";
const INEXISTENTE = "00000000-0000-4000-8000-000000000000";
const MCP = { via: "mcp", author: "Claude Desktop" };

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("tarefas-dono");
  intruso = await criarUsuario("tarefas-intruso");
  await preferirFuso(dono.id, SP);
  await preferirFuso(intruso.id, SP);
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ apoio */

/// 300 requisições por minuto por IP: um IP por chamada, como sessões
/// diferentes (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.32.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
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
const titulos = (itens: { title: string }[]) => itens.map((item) => item.title);

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

async function contaNoFuso(apelido: string, fuso: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await preferirFuso(usuario.id, fuso);
  return usuario;
}

async function novaTarefa(usuario: Usuario, corpo: Record<string, unknown>): Promise<TaskItem> {
  const { status, body } = await api(usuario, "POST", "/tasks", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as TaskItem;
}

async function lerTarefa(usuario: Usuario, id: string): Promise<TaskItem> {
  const { status, body } = await api(usuario, "GET", `/tasks/${id}`);
  expect(status).toBe(200);
  return body as TaskItem;
}

async function concluir(usuario: Usuario, id: string, corpo: Record<string, unknown> = {}) {
  return api(usuario, "PATCH", `/tasks/${id}/complete`, corpo);
}

async function listar(usuario: Usuario, query = ""): Promise<TaskItem[]> {
  const { status, body } = await api(usuario, "GET", `/tasks${query}`);
  expect(status).toBe(200);
  return body as TaskItem[];
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

/* ------------------------------------------------------------------- CRUD */

describe("CRUD de tarefa", () => {
  test("tarefa nasce aberta, sem data nem quadro, e some depois de excluída", async () => {
    const criada = await novaTarefa(dono, { title: "Comprar pão" });
    expect(criada).toMatchObject({
      title: "Comprar pão",
      descriptionMd: "",
      date: null,
      time: null,
      overdue: false,
      completedAt: null,
      completion: null,
      board: null,
      ai: null,
    });
    expect(await lerTarefa(dono, criada.id)).toEqual(criada);

    const editada = await api(dono, "PATCH", `/tasks/${criada.id}`, {
      title: "Comprar pão integral",
      descriptionMd: "Na padaria da esquina",
      date: DIA,
      time: "07:30",
    });
    expect(editada.status).toBe(200);
    expect(editada.body).toMatchObject({
      title: "Comprar pão integral",
      descriptionMd: "Na padaria da esquina",
      date: DIA,
      time: "07:30",
    });

    expect((await api(dono, "DELETE", `/tasks/${criada.id}`)).status).toBe(204);
    expect((await api(dono, "GET", `/tasks/${criada.id}`)).status).toBe(404);
    expect((await api(dono, "DELETE", `/tasks/${criada.id}`)).status).toBe(404);
  });

  test("id que não existe é 404 em toda rota, e id malformado é 422", async () => {
    for (const [method, url, corpo] of [
      ["GET", `/tasks/${INEXISTENTE}`, undefined],
      ["PATCH", `/tasks/${INEXISTENTE}`, { title: "Nada" }],
      ["PATCH", `/tasks/${INEXISTENTE}/complete`, {}],
      ["DELETE", `/tasks/${INEXISTENTE}`, undefined],
    ] as const) {
      const { status, body } = await api(dono, method, url, corpo);
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");
    }
    expect((await api(dono, "GET", "/tasks/nao-e-uuid")).status).toBe(422);
  });

  test("a data da tarefa é civil: trocar o fuso não a move", async () => {
    const usuario = await contaNoFuso("tarefas-civil", SP);
    const tarefa = await novaTarefa(usuario, { title: "Pagar boleto", date: DIA, time: "10:00" });

    await preferirFuso(usuario.id, TOQUIO);
    expect(await lerTarefa(usuario, tarefa.id)).toMatchObject({ date: DIA, time: "10:00" });
    const gravada = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });
    expect(gravada.date?.toISOString()).toBe(`${DIA}T00:00:00.000Z`);
  });
});

/* -------------------------------------------------------------- validação */

describe("validação da tarefa", () => {
  test("hora sem data é recusada na criação", async () => {
    const { status, body } = await api(dono, "POST", "/tasks", { title: "Só hora", time: "10:00" });
    expect(status).toBe(422);
    expect(codigo(body)).toBe("VALIDATION_ERROR");
    expect(caminhos(body)).toContain("time");
  });

  test("dia que não existe no calendário e hora fora do relógio são recusados", async () => {
    const dia = await api(dono, "POST", "/tasks", { title: "30/02", date: "2026-02-30" });
    expect(dia.status).toBe(422);
    expect(caminhos(dia.body)).toContain("date");

    const hora = await api(dono, "POST", "/tasks", { title: "25h", date: DIA, time: "25:00" });
    expect(hora.status).toBe(422);
    expect(caminhos(hora.body)).toContain("time");

    expect((await api(dono, "POST", "/tasks", { title: "   " })).status).toBe(422);
  });

  test("no PATCH, hora numa tarefa sem data é recusada, e tirar a data leva a hora junto", async () => {
    const semData = await novaTarefa(dono, { title: "Sem quando" });
    const recusa = await api(dono, "PATCH", `/tasks/${semData.id}`, { time: "10:00" });
    expect(recusa.status).toBe(422);
    expect(codigo(recusa.body)).toBe("VALIDATION_ERROR");
    expect((await lerTarefa(dono, semData.id)).time).toBeNull();

    const comHora = await novaTarefa(dono, { title: "Com quando", date: DIA, time: "10:00" });
    const semDia = await api(dono, "PATCH", `/tasks/${comHora.id}`, { date: null });
    expect(semDia.status).toBe(200);
    expect(semDia.body).toMatchObject({ date: null, time: null });
  });

  test("PATCH sem campo nenhum e status desconhecido na listagem são recusados", async () => {
    const tarefa = await novaTarefa(dono, { title: "Intocada" });
    expect((await api(dono, "PATCH", `/tasks/${tarefa.id}`, {})).status).toBe(422);
    expect((await api(dono, "GET", "/tasks?status=pendentes")).status).toBe(422);
    expect((await api(dono, "GET", "/tasks?boardId=nao-e-uuid")).status).toBe(422);
  });
});

describe("validação no service, sem passar pelo schema", () => {
  // O chat (Fase 2 da frente de agenda) chama o service com argumentos que o modelo escreveu: o
  // schema da rota não está no caminho, e `new Date` rolaria 30/02 para 02/03.
  test("dia que não existe é recusado pelo service na criação e no PATCH, sem gravar nada", async () => {
    const titulo = `Trinta de fevereiro ${crypto.randomUUID()}`;
    const criar = criarTarefa(dono.id, { title: titulo, date: "2026-02-30" });
    await expect(criar).rejects.toBeInstanceOf(AppError);
    await expect(criar).rejects.toMatchObject({ statusCode: 422, code: "VALIDATION_ERROR" });
    expect(await prisma.task.count({ where: { title: titulo } })).toBe(0);

    const tarefa = await novaTarefa(dono, { title: "Dia válido", date: DIA });
    await expect(
      atualizarTarefa(dono.id, tarefa.id, { date: "2026-02-30" }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect((await lerTarefa(dono, tarefa.id)).date).toBe(DIA);
  });

  test("hora fora do relógio e hora sem data são recusadas pelo service", async () => {
    await expect(
      criarTarefa(dono.id, { title: "25h", date: DIA, time: "25:00" }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      criarTarefa(dono.id, { title: "Só hora", time: "10:00" }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("quadro excluído entre a conferência e a escrita", () => {
  // A corrida em si não se reproduz em sequência; o que se prova é a tradução
  // do `P2003` real que a FK levanta, pelo nome da constraint.
  test("o P2003 da FK do quadro vira 404 de quadro, em tarefa e em evento", async () => {
    const tarefa = prisma.task
      .create({ data: { userId: dono.id, title: "Quadro sumiu", boardId: INEXISTENTE } })
      .catch(quadroQueSumiu);
    await expect(tarefa).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Quadro não encontrado",
    });

    const agora = new Date();
    const evento = prisma.event
      .create({
        data: {
          userId: dono.id,
          title: "Quadro sumiu",
          startsAt: agora,
          endsAt: new Date(agora.getTime() + 60_000),
          boardId: INEXISTENTE,
        },
      })
      .catch(quadroQueSumiu);
    await expect(evento).rejects.toMatchObject({ statusCode: 404 });
  });

  test("outra FK violada sobe como é, e não vira 404 de quadro", async () => {
    const outra = prisma.task
      .create({ data: { userId: INEXISTENTE, title: "Dono que não existe" } })
      .catch(quadroQueSumiu);
    await expect(outra).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

/* -------------------------------------------------------------- listagem */

describe("listagem de tarefas", () => {
  test("abertas vêm por dia, no mesmo dia as sem hora antes das marcadas, e as sem data no fim", async () => {
    const usuario = await contaNoFuso("tarefas-ordem", SP);
    const amanha = somarDias(DIA, 1);
    // Criadas fora de ordem, para que a ordem de criação não explique o resultado.
    await novaTarefa(usuario, { title: "Sem data 1" });
    await novaTarefa(usuario, { title: "Amanhã às 10h", date: amanha, time: "10:00" });
    await novaTarefa(usuario, { title: "Hoje às 08h", date: DIA, time: "08:00" });
    await novaTarefa(usuario, { title: "Hoje, sem hora", date: DIA });
    await novaTarefa(usuario, { title: "Hoje às 07h", date: DIA, time: "07:00" });
    await novaTarefa(usuario, { title: "Sem data 2" });

    expect(titulos(await listar(usuario))).toEqual([
      "Hoje, sem hora",
      "Hoje às 07h",
      "Hoje às 08h",
      "Amanhã às 10h",
      "Sem data 1",
      "Sem data 2",
    ]);
  });

  test("status escolhe abertas, concluídas (a mais recente primeiro) ou todas", async () => {
    const usuario = await contaNoFuso("tarefas-status", SP);
    const aberta = await novaTarefa(usuario, { title: "Aberta" });
    const antiga = await novaTarefa(usuario, { title: "Concluída antes" });
    const recente = await novaTarefa(usuario, { title: "Concluída depois" });
    await concluir(usuario, antiga.id);
    await concluir(usuario, recente.id);
    // Datas fixas: duas conclusões seguidas podem cair no mesmo milissegundo.
    await prisma.task.update({
      where: { id: antiga.id },
      data: { completedAt: new Date("2030-01-01T12:00:00Z") },
    });
    await prisma.task.update({
      where: { id: recente.id },
      data: { completedAt: new Date("2030-02-01T12:00:00Z") },
    });

    expect(titulos(await listar(usuario))).toEqual(["Aberta"]);
    expect(titulos(await listar(usuario, "?status=abertas"))).toEqual(["Aberta"]);
    expect(titulos(await listar(usuario, "?status=concluidas"))).toEqual([
      "Concluída depois",
      "Concluída antes",
    ]);
    expect(titulos(await listar(usuario, "?status=todas"))).toEqual([
      "Aberta",
      "Concluída depois",
      "Concluída antes",
    ]);
    expect((await listar(usuario, "?status=todas"))[0]?.id).toBe(aberta.id);
  });

  test("o filtro por quadro só traz as tarefas daquele quadro", async () => {
    const usuario = await contaNoFuso("tarefas-quadro", SP);
    const quadro = await novoQuadro(usuario, "Projeto");
    const outro = await novoQuadro(usuario, "Outro projeto");
    await novaTarefa(usuario, { title: "Do projeto", boardId: quadro.id });
    await novaTarefa(usuario, { title: "Do outro", boardId: outro.id });
    await novaTarefa(usuario, { title: "Solta" });

    const doQuadro = await listar(usuario, `?boardId=${quadro.id}`);
    expect(titulos(doQuadro)).toEqual(["Do projeto"]);
    expect(doQuadro[0]?.board).toEqual({ id: quadro.id, name: quadro.name });
  });

  test("atrasada é a aberta com data antes de hoje no fuso do usuário, não no do servidor", async () => {
    // Pago Pago (UTC−11) e Kiritimati (UTC+14) estão sempre em dias
    // diferentes: o hoje de um é ontem (ou anteontem) no outro.
    const usuario = await contaNoFuso("tarefas-atrasada", "Pacific/Pago_Pago");
    const hojeEmPagoPago = diaLocal(new Date(), "Pacific/Pago_Pago");
    const tarefa = await novaTarefa(usuario, { title: "Para hoje", date: hojeEmPagoPago });
    expect(tarefa.overdue).toBe(false);

    await preferirFuso(usuario.id, "Pacific/Kiritimati");
    expect((await lerTarefa(usuario, tarefa.id)).overdue).toBe(true);
    expect((await listar(usuario))[0]?.overdue).toBe(true);

    const hojeEmKiritimati = diaLocal(new Date(), "Pacific/Kiritimati");
    const { body } = await api(
      usuario,
      "GET",
      `/agenda?from=${hojeEmKiritimati}&to=${hojeEmKiritimati}`,
    );
    const agenda = body as AgendaRange;
    expect(agenda.today).toBe(hojeEmKiritimati);
    expect(agenda.overdueTasks.map((t) => t.id)).toEqual([tarefa.id]);

    // Concluída nunca está atrasada.
    const feita = await concluir(usuario, tarefa.id);
    expect((feita.body as TaskItem).overdue).toBe(false);
  });
});

/* ------------------------------------------------------ concluir e reabrir */

describe("concluir e reabrir", () => {
  test("concluir à mão grava a data sem marca de IA, e reabrir a limpa", async () => {
    const tarefa = await novaTarefa(dono, { title: "Conclusão humana" });

    const feita = await concluir(dono, tarefa.id);
    expect(feita.status).toBe(200);
    expect(feita.body).toMatchObject({ completedAt: expect.any(String), completion: null });
    expect((await listar(dono)).map((t) => t.id)).not.toContain(tarefa.id);

    const reaberta = await concluir(dono, tarefa.id, { completed: false });
    expect(reaberta.status).toBe(200);
    expect(reaberta.body).toMatchObject({ completedAt: null, completion: null });
    expect((await listar(dono)).map((t) => t.id)).toContain(tarefa.id);
  });

  test("concluir pelo MCP grava quem concluiu, e reabrir apaga a marca", async () => {
    const tarefa = await novaTarefa(dono, { title: "Conclusão pelo MCP" });

    const feita = await concluir(dono, tarefa.id, { origin: MCP });
    expect(feita.body).toMatchObject({
      completedAt: expect.any(String),
      completion: { via: "mcp", author: "Claude Desktop", agentName: null },
      // Concluir não é gerar: a marca de criação segue vazia.
      ai: null,
    });

    await concluir(dono, tarefa.id, { completed: false });
    const gravada = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });
    expect(gravada).toMatchObject({
      completedAt: null,
      aiCompletedVia: null,
      aiCompletedAuthor: null,
      aiCompletedAgentName: null,
    });
  });

  test("concluir o que já está concluído não troca a data nem quem concluiu (INV-63)", async () => {
    const tarefa = await novaTarefa(dono, { title: "Concluída duas vezes" });
    await concluir(dono, tarefa.id, { origin: MCP });
    // A data antiga fixada no passado: duas conclusões na mesma rodada caberiam
    // no mesmo milissegundo e passariam mesmo regravando.
    const passado = new Date("2030-01-01T12:00:00.000Z");
    await prisma.task.update({ where: { id: tarefa.id }, data: { completedAt: passado } });

    const deNovo = await concluir(dono, tarefa.id);
    expect(deNovo.status).toBe(200);
    expect(deNovo.body).toMatchObject({
      completedAt: passado.toISOString(),
      completion: { via: "mcp", author: "Claude Desktop" },
    });
  });

  test("conclusão com origin de outra via é recusada, e a tarefa segue aberta", async () => {
    const tarefa = await novaTarefa(dono, { title: "Marca forjada" });
    const { status } = await concluir(dono, tarefa.id, { origin: { via: "chat", author: "x" } });
    expect(status).toBe(422);
    const gravada = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });
    expect(gravada.completedAt).toBeNull();
    expect(gravada.aiCompletedVia).toBeNull();
  });

  test("o PATCH comum descarta origin e completed: não conclui nem fabrica marca", async () => {
    const tarefa = await novaTarefa(dono, { title: "PATCH comum" });
    const { status } = await api(dono, "PATCH", `/tasks/${tarefa.id}`, {
      title: "PATCH comum, editado",
      completed: true,
      origin: MCP,
    });
    // As chaves somem no schema e o PATCH segue 200: a prova é o gravado.
    expect(status).toBe(200);
    const gravada = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });
    expect(gravada.title).toBe("PATCH comum, editado");
    expect(gravada.completedAt).toBeNull();
    expect(gravada.aiCompletedVia).toBeNull();
    expect(gravada.aiGeneratedAt).toBeNull();
    expect(gravada.aiVia).toBeNull();
  });
});

/* ------------------------------------------------------------ marca de IA */

describe("marca de IA na tarefa", () => {
  test("criar com origin do MCP grava a marca na tarefa", async () => {
    const tarefa = await novaTarefa(dono, { title: "Gerada pelo MCP", origin: MCP });
    expect(tarefa.ai).toMatchObject({
      via: "mcp",
      author: "Claude Desktop",
      generatedAt: expect.any(String),
      conversationId: null,
      agentName: null,
      runId: null,
      routineName: null,
      revisedAt: null,
    });
    // Criar não é concluir.
    expect(tarefa.completion).toBeNull();
  });

  test("a HTTP não aceita origin de outra via na criação", async () => {
    const titulo = `Forjada ${crypto.randomUUID()}`;
    const { status } = await api(dono, "POST", "/tasks", {
      title: titulo,
      origin: { via: "rotina", author: "x" },
    });
    expect(status).toBe(422);
    expect(await prisma.task.count({ where: { title: titulo } })).toBe(0);
  });

  test("editar o texto de tarefa gerada registra revisão sem apagar a marca; mudar a data, não", async () => {
    const tarefa = await novaTarefa(dono, { title: "Gerada", origin: MCP });

    const data = await api(dono, "PATCH", `/tasks/${tarefa.id}`, { date: DIA });
    expect((data.body as TaskItem).ai).toMatchObject({ via: "mcp", revisedAt: null });

    const concluida = await concluir(dono, tarefa.id);
    expect((concluida.body as TaskItem).ai).toMatchObject({ via: "mcp", revisedAt: null });

    const texto = await api(dono, "PATCH", `/tasks/${tarefa.id}`, { descriptionMd: "Detalhe" });
    expect((texto.body as TaskItem).ai).toMatchObject({
      via: "mcp",
      generatedAt: tarefa.ai?.generatedAt,
      revisedAt: expect.any(String),
    });
  });
});

/* ------------------------------------------------------------------ posse */

describe("posse da tarefa", () => {
  test("intruso recebe 404 em toda rota de tarefa, e a tarefa fica intacta", async () => {
    const tarefa = await novaTarefa(dono, { title: "Só do dono", date: DIA });
    const antes = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });

    for (const [method, url, corpo] of [
      ["GET", `/tasks/${tarefa.id}`, undefined],
      ["PATCH", `/tasks/${tarefa.id}`, { title: "Invadida", date: null }],
      ["PATCH", `/tasks/${tarefa.id}/complete`, { origin: MCP }],
      ["PATCH", `/tasks/${tarefa.id}/complete`, { completed: false }],
      ["DELETE", `/tasks/${tarefa.id}`, undefined],
    ] as const) {
      const { status, body } = await api(intruso, method, url, corpo);
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");
    }

    expect(await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } })).toEqual(antes);
    expect((await listar(intruso, "?status=todas")).map((t) => t.id)).not.toContain(tarefa.id);
  });

  test("o intruso não reabre a tarefa concluída do dono", async () => {
    const tarefa = await novaTarefa(dono, { title: "Concluída pelo dono" });
    await concluir(dono, tarefa.id, { origin: MCP });
    const antes = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });

    expect((await concluir(intruso, tarefa.id, { completed: false })).status).toBe(404);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } })).toEqual(antes);
  });

  test("quadro de outra conta é 404 na criação, no PATCH e no filtro, como se não existisse", async () => {
    const alheio = await novoQuadro(intruso, "Quadro do intruso");
    const titulo = `Com quadro alheio ${crypto.randomUUID()}`;

    for (const boardId of [alheio.id, INEXISTENTE]) {
      const { status, body } = await api(dono, "POST", "/tasks", { title: titulo, boardId });
      expect(status).toBe(404);
      expect(codigo(body)).toBe("NOT_FOUND");

      const filtro = await api(dono, "GET", `/tasks?boardId=${boardId}`);
      expect(filtro.status).toBe(404);
      expect(codigo(filtro.body)).toBe("NOT_FOUND");
    }
    expect(await prisma.task.count({ where: { title: titulo } })).toBe(0);

    const proprio = await novoQuadro(dono, "Quadro do dono");
    const tarefa = await novaTarefa(dono, { title: "Com quadro", boardId: proprio.id });
    const patch = await api(dono, "PATCH", `/tasks/${tarefa.id}`, { boardId: alheio.id });
    expect(patch.status).toBe(404);
    const gravada = await prisma.task.findUniqueOrThrow({ where: { id: tarefa.id } });
    expect(gravada.boardId).toBe(proprio.id);
  });
});

/* --------------------------------------------------------------- cascata */

describe("cascata", () => {
  test("excluir o quadro solta a tarefa, sem apagá-la", async () => {
    const quadro = await novoQuadro(dono, "Projeto que acaba");
    const tarefa = await novaTarefa(dono, { title: "Do projeto", boardId: quadro.id });
    expect(tarefa.board?.id).toBe(quadro.id);

    expect((await api(dono, "DELETE", `/boards/${quadro.id}`)).status).toBe(204);

    const depois = await lerTarefa(dono, tarefa.id);
    expect(depois.board).toBeNull();
    expect(depois.title).toBe("Do projeto");
  });

  // Por último: `limpar()` leva também as contas desta suíte.
  test("limpar() leva as tarefas das contas de teste pela cascata, sem deixar linha órfã", async () => {
    const usuario = await contaNoFuso("tarefas-limpeza", SP);
    const quadro = await novoQuadro(usuario, "Limpeza");
    const tarefa = await novaTarefa(usuario, {
      title: "Some com a conta",
      date: DIA,
      boardId: quadro.id,
      origin: MCP,
    });
    await concluir(usuario, tarefa.id, { origin: MCP });
    const contas = [usuario.id, dono.id, intruso.id];
    expect(await prisma.task.count({ where: { userId: { in: contas } } })).toBeGreaterThan(0);

    await limpar();

    expect(await prisma.task.count({ where: { id: tarefa.id } })).toBe(0);
    expect(await prisma.task.count({ where: { userId: { in: contas } } })).toBe(0);
    expect(await prisma.board.count({ where: { id: quadro.id } })).toBe(0);
  });
});
