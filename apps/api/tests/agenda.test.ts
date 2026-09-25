import {
  diaParaPrazo,
  horariosDevidos,
  instanteLocal,
  proximaTentativa,
  proximosHorarios,
  TETO_DIARIO_PADRAO_MICROS,
  TREINO_PERMITIDO_PADRAO,
} from "@yu-book/shared";
import type {
  AgentDetail,
  BoardDetail,
  CardDetail,
  Dashboard,
  RoutineDetail,
  RoutineInput,
  RoutineRunDetail,
  RoutineRunPage,
  RoutineRunStarted,
  RoutineSummary,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { voltaDaAgenda } from "../src/modules/assistente/agendador.service.js";
import type { RegistroDaVolta } from "../src/modules/assistente/agendador.service.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";
import { chamadasAoChat, subirProvedor } from "./provedor.js";
import type { Dublê } from "./provedor.js";

/**
 * Agenda de rotina — Etapa F da frente de IA, §5.8 de
 * `docs/prd-ia-no-yu-book.md`: RF-65 a RF-69, RN-20 a RN-23, CA-38 a CA-42.
 *
 * O que esta suíte protege, em uma frase: **cada horário da agenda vira no
 * máximo uma execução, a recusa tenta de novo e a execução que começou nunca
 * se repete.**
 *
 * **A suíte roda no banco de desenvolvimento, que guarda a conta real.** Toda
 * volta do agendador aqui passa o `userId` do teste em `somenteDe` — uma volta
 * global com um `agora` inventado dispararia as rotinas agendadas do operador
 * — e o `agora` é injetado em janeiro de 2026, longe do relógio da máquina. O
 * relógio de verdade (`vigiarAgenda`) nunca é ligado.
 */

let app: FastifyInstance;
let dublê: Dublê;

beforeAll(async () => {
  await limpar();
  dublê = await subirProvedor();
  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  dublê.server.closeAllConnections();
  await new Promise<void>((ok) => dublê.server.close(() => ok()));
  await limpar();
});

beforeEach(() => {
  dublê.recebidas = [];
  dublê.corpos = [];
  dublê.roteiro = [];
  esquecerCatalogo();
});

/* ------------------------------------------------------------------ apoio */

const codigo = (body: unknown) => (body as { error?: { code?: string } }).error?.code;

/// Um IP por chamada: o limite global é de 300/min por IP, e `esperar` relê
/// em laço (ver `apoio.ts` e a nota de `rotinas.test.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.8.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

const api = (
  usuario: Usuario,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
) =>
  chamar(app, {
    method,
    url,
    token: usuario.token,
    ip: proximoIp(),
    ...(body !== undefined && { body }),
  });

/// O registro que a volta recebe. Erro nele é um horário que caiu no `catch`
/// do agendador, e aviso é uma rotina que nem deu para ler — só o teste da
/// rotina com defeito espera um deles, e cada teste confere.
function registroDoTeste(): RegistroDaVolta & { erros: unknown[]; avisos: unknown[] } {
  const erros: unknown[] = [];
  const avisos: unknown[] = [];
  return {
    erros,
    avisos,
    error: (dados) => erros.push(dados),
    warn: (dados) => avisos.push(dados),
  };
}

const MIN = 60_000;
/// Segunda-feira, 5 de janeiro de 2026, 08:00 em São Paulo (UTC−3, sem
/// horário de verão desde 2019). Longe do relógio real.
const SEG_0800_SP = new Date("2026-01-05T11:00:00.000Z");
const depois = (base: Date, minutos: number) => new Date(base.getTime() + minutos * MIN);

/// Horário sem linha só dispara se não for anterior à última gravação da
/// rotina (`pendentesDaRotina`). As rotinas daqui nascem pela API, com o
/// relógio real — meses depois do `agora` injetado —, e são postas na linha do
/// tempo do teste por esta escrita direta: gravada em dezembro de 2025, antes
/// de todo horário que as voltas atendem.
const ANTES_DOS_HORARIOS = new Date("2025-12-01T00:00:00.000Z");
const gravadaEm = (routineId: string, instante: Date) =>
  prisma.aiRoutine.update({ where: { id: routineId }, data: { updatedAt: instante } });
const gravadaQuando = async (routineId: string) =>
  (await prisma.aiRoutine.findUniqueOrThrow({ where: { id: routineId } })).updatedAt;

/** Um usuário pronto para rodar rotina: o modelo do chat escolhido. */
async function comChat(apelido: string, fuso?: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId: "estudio/conversa",
      name: "Estúdio: Conversa",
      contextLength: 128_000,
      promptMicros: 0,
      completionMicros: 0,
      supportsTools: true,
    },
  });
  await prisma.aiTaskModel.create({
    data: { userId: usuario.id, task: "chat", modelId: "estudio/conversa" },
  });
  if (fuso) {
    await prisma.aiPreference.create({
      data: {
        userId: usuario.id,
        dailyCapMicros: TETO_DIARIO_PADRAO_MICROS,
        timezone: fuso,
        allowTraining: TREINO_PERMITIDO_PADRAO,
      },
    });
  }
  return usuario;
}

async function agentePronto(usuario: Usuario, name: string): Promise<AgentDetail> {
  const { status, body } = await api(usuario, "POST", "/ai/agents", { name });
  expect(status).toBe(201);
  return body as AgentDetail;
}

async function criarQuadro(usuario: Usuario, nome: string): Promise<BoardDetail> {
  const workspace = await prisma.workspace.create({
    data: { userId: usuario.id, name: `Espaço ${nome}` },
  });
  const { status, body } = await api(usuario, "POST", "/boards", {
    name: nome,
    workspaceId: workspace.id,
  });
  expect(status).toBe(201);
  return body as BoardDetail;
}

async function criarCard(usuario: Usuario, columnId: string, title: string): Promise<string> {
  const { status, body } = await api(usuario, "POST", "/cards", { columnId, title });
  expect(status).toBe(201);
  return (body as CardDetail).id;
}

/// Segunda às 08:00 — o horário de `SEG_0800_SP` no fuso padrão.
const AGENDA_SEG_0800 = { days: [1], times: ["08:00"], active: true };

/** Rotina por pedido com saída em nota: roda sem ideia a escolher. */
async function rotinaPorPedido(
  usuario: Usuario,
  extra: Partial<RoutineInput> = {},
): Promise<RoutineDetail> {
  const escritor = await agentePronto(usuario, `Escritor ${crypto.randomUUID().slice(0, 6)}`);
  const corpo: RoutineInput = {
    name: `Resumo ${crypto.randomUUID().slice(0, 6)}`,
    inputKind: "pedido",
    inputPrompt: "# Resumo agendado\n\nListe o que andou.",
    outputKind: "nota",
    outputTitle: "primeira_linha",
    steps: [{ agentId: escritor.id, mode: "reescreve" }],
    schedule: AGENDA_SEG_0800,
    ...extra,
  };
  const { status, body } = await api(usuario, "POST", "/ai/routines", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  const rotina = body as RoutineDetail;
  await gravadaEm(rotina.id, ANTES_DOS_HORARIOS);
  return rotina;
}

interface PorColuna {
  rotina: RoutineDetail;
  entrada: string;
  saidaBoardId: string;
}

/** Rotina por coluna com saída em card noutro quadro. Coluna vazia é `SEM_IDEIA`. */
async function rotinaPorColuna(
  usuario: Usuario,
  schedule: RoutineInput["schedule"],
): Promise<PorColuna> {
  const conteudo = await criarQuadro(usuario, "Conteúdo");
  const publicacao = await criarQuadro(usuario, "Publicação");
  const escritor = await agentePronto(usuario, "Escritor");
  const entrada = conteudo.columns[0]?.id ?? "";
  const corpo: RoutineInput = {
    name: "Post agendado",
    inputBoardId: conteudo.id,
    inputColumnId: entrada,
    outputColumnId: publicacao.columns[0]?.id ?? "",
    consumeAction: "mover",
    consumeColumnId: conteudo.columns[2]?.id ?? "",
    steps: [{ agentId: escritor.id, mode: "reescreve" }],
    schedule,
  };
  const { status, body } = await api(usuario, "POST", "/ai/routines", corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  const rotina = body as RoutineDetail;
  await gravadaEm(rotina.id, ANTES_DOS_HORARIOS);
  return { rotina, entrada, saidaBoardId: publicacao.id };
}

const linhasDoHorario = (routineId: string) =>
  prisma.aiRoutineRun.findMany({
    where: { routineId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      trigger: true,
      scheduledFor: true,
      attempts: true,
      errorCode: true,
      errorMessage: true,
      endedAt: true,
    },
  });

const lerRun = async (usuario: Usuario, runId: string) => {
  const { status, body } = await api(usuario, "GET", `/ai/runs/${runId}`);
  expect(status).toBe(200);
  return body as RoutineRunDetail;
};

/** Relê até a condição valer, ou falha com o último estado. Sem relógio fixo. */
async function esperar<T>(ler: () => Promise<T>, ok: (v: T) => boolean, rotulo: string): Promise<T> {
  const limite = Date.now() + 10_000;
  let ultimo = await ler();
  while (!ok(ultimo)) {
    if (Date.now() > limite) throw new Error(`${rotulo}: ${JSON.stringify(ultimo)}`);
    await new Promise((r) => setTimeout(r, 20));
    ultimo = await ler();
  }
  return ultimo;
}

const esperarFim = (usuario: Usuario, runId: string) =>
  esperar(
    () => lerRun(usuario, runId),
    (r) => r.status !== "em_andamento",
    "a execução não terminou",
  );

function trava(): { solta: Promise<void>; soltar: () => void } {
  let soltar: () => void = () => undefined;
  const solta = new Promise<void>((ok) => {
    soltar = ok;
  });
  return { solta, soltar };
}

const volta = (usuario: Usuario, agora: Date, registro = registroDoTeste()) =>
  voltaDaAgenda(agora, registro, usuario.id);

/* ------------------------------------------------------------------- fuso */

describe("CA-41 / RF-65 / RF-68: o horário da agenda é do fuso do dono", () => {
  test("08:00 em America/Sao_Paulo dispara às 11:00 UTC, com gatilho, horário e tentativa gravados", async () => {
    const usuario = await comChat("agenda-ca41");
    const rotina = await rotinaPorPedido(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "# Resumo pronto\n\ncorpo" }];
    const registro = registroDoTeste();

    // Um minuto antes: nada.
    expect(await volta(usuario, depois(SEG_0800_SP, -1), registro)).toEqual({
      iniciadas: 0,
      recusadas: 0,
    });
    expect(await linhasDoHorario(rotina.id)).toHaveLength(0);

    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 1, recusadas: 0 });
    const [linha] = await linhasDoHorario(rotina.id);
    expect(linha).toBeDefined();
    const run = await esperarFim(usuario, linha?.id ?? "");

    expect(run).toMatchObject({
      status: "concluida",
      trigger: "agenda",
      scheduledFor: "2026-01-05T11:00:00.000Z",
      attempts: 1,
      errorCode: null,
    });
    expect(run.outputNoteId).not.toBeNull();
    expect(chamadasAoChat(dublê)).toHaveLength(1);
    expect(registro.erros).toEqual([]);

    // RN-20: as voltas seguintes, ainda na janela, não repetem o horário.
    for (const minutos of [1, 5, 10, 15]) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 0,
      });
    }
    expect(await linhasDoHorario(rotina.id)).toHaveLength(1);
    expect(chamadasAoChat(dublê)).toHaveLength(1);
  });

  test("RF-68: a execução à mão continua 'manual', sem horário nem tentativa", async () => {
    const usuario = await comChat("agenda-manual");
    const rotina = await rotinaPorPedido(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "# À mão\n\ncorpo" }];

    const { status, body } = await api(usuario, "POST", `/ai/routines/${rotina.id}/runs`);
    expect(status).toBe(202);
    const run = await esperarFim(usuario, (body as RoutineRunStarted).runId);

    expect(run).toMatchObject({
      status: "concluida",
      trigger: "manual",
      scheduledFor: null,
      attempts: null,
    });
  });
});

/* ------------------------------------------------------ duas instâncias */

describe("CA-38 / RN-20 / INV-60: um horário, no máximo uma execução", () => {
  test("duas voltas simultâneas no mesmo horário, como duas instâncias, geram uma execução só", async () => {
    const usuario = await comChat("agenda-ca38");
    const rotina = await rotinaPorPedido(usuario);
    dublê.roteiro = [{ tipo: "texto", texto: "# Uma vez\n\ncorpo" }];
    const registro = registroDoTeste();

    const resumos = await Promise.all([
      volta(usuario, SEG_0800_SP, registro),
      volta(usuario, SEG_0800_SP, registro),
    ]);

    // A perdedora não conta nem início nem recusa: o horário foi atendido.
    expect(resumos.reduce((s, r) => s + r.iniciadas, 0)).toBe(1);
    expect(resumos.reduce((s, r) => s + r.recusadas, 0)).toBe(0);
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    const run = await esperarFim(usuario, linhas[0]?.id ?? "");
    expect(run).toMatchObject({ status: "concluida", trigger: "agenda", attempts: 1 });
    expect(chamadasAoChat(dublê)).toHaveLength(1);
    expect(registro.erros).toEqual([]);
  });

  test("duas voltas simultâneas na segunda tentativa convertem a 'pulada' uma vez só", async () => {
    const usuario = await comChat("agenda-ca38-conversao");
    const { rotina, entrada } = await rotinaPorColuna(usuario, AGENDA_SEG_0800);
    const registro = registroDoTeste();

    // Primeira tentativa recusada: coluna de entrada vazia.
    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 0, recusadas: 1 });
    await criarCard(usuario, entrada, "Ideia que chegou a tempo");
    dublê.roteiro = [{ tipo: "texto", texto: "Post pronto." }];

    const resumos = await Promise.all([
      volta(usuario, depois(SEG_0800_SP, 5), registro),
      volta(usuario, depois(SEG_0800_SP, 5), registro),
    ]);

    expect(resumos.reduce((s, r) => s + r.iniciadas, 0)).toBe(1);
    expect(resumos.reduce((s, r) => s + r.recusadas, 0)).toBe(0);
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    const run = await esperarFim(usuario, linhas[0]?.id ?? "");
    expect(run).toMatchObject({ status: "concluida", attempts: 2, errorCode: null });
    expect(chamadasAoChat(dublê)).toHaveLength(1);
    expect(registro.erros).toEqual([]);
  });
});

/* ------------------------------------------------------------- recusas */

describe("CA-39 / RN-21: a recusa tenta de novo a cada 5 minutos, até três vezes", () => {
  test("recusada por outra em andamento, antes de 5 min não retenta; com a outra terminada, converte e roda", async () => {
    const usuario = await comChat("agenda-ca39");
    const manual = await rotinaPorPedido(usuario, {
      schedule: { days: [], times: [], active: false },
    });
    const agendada = await rotinaPorPedido(usuario);
    const registro = registroDoTeste();

    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "# Manual", depois: "\n\ncorpo", solta }];
    const inicio = await api(usuario, "POST", `/ai/routines/${manual.id}/runs`);
    expect(inicio.status).toBe(202);
    const runManual = (inicio.body as RoutineRunStarted).runId;
    await esperar(
      async () => chamadasAoChat(dublê).length,
      (n) => n === 1,
      "a manual não chegou ao provedor",
    );

    // Primeira tentativa: RN-19 recusa, e a linha do horário nasce `pulada`.
    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 0, recusadas: 1 });
    const [pulada] = await linhasDoHorario(agendada.id);
    expect(pulada).toMatchObject({
      status: "pulada",
      trigger: "agenda",
      scheduledFor: SEG_0800_SP,
      attempts: 1,
      errorCode: "ROTINA_EM_ANDAMENTO",
    });

    // Antes dos 5 minutos, nada — nem com a outra ainda rodando, nem depois.
    expect(await volta(usuario, depois(SEG_0800_SP, 4), registro)).toEqual({
      iniciadas: 0,
      recusadas: 0,
    });
    soltar();
    expect(await esperarFim(usuario, runManual)).toMatchObject({ status: "concluida" });
    expect(await volta(usuario, depois(SEG_0800_SP, 4), registro)).toEqual({
      iniciadas: 0,
      recusadas: 0,
    });
    expect((await linhasDoHorario(agendada.id))[0]?.attempts).toBe(1);

    // Aos 5 minutos, já livre: a mesma linha vira a execução, na segunda tentativa.
    dublê.roteiro = [{ tipo: "texto", texto: "# Agendada\n\ncorpo" }];
    expect(await volta(usuario, depois(SEG_0800_SP, 5), registro)).toEqual({
      iniciadas: 1,
      recusadas: 0,
    });
    const linhas = await linhasDoHorario(agendada.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.id).toBe(pulada?.id);
    const run = await esperarFim(usuario, pulada?.id ?? "");
    expect(run).toMatchObject({
      status: "concluida",
      trigger: "agenda",
      scheduledFor: SEG_0800_SP.toISOString(),
      attempts: 2,
      // A conversão limpa o motivo da recusa anterior.
      errorCode: null,
      errorMessage: null,
    });
    expect(run.outputNoteId).not.toBeNull();

    expect(await volta(usuario, depois(SEG_0800_SP, 10), registro)).toEqual({
      iniciadas: 0,
      recusadas: 0,
    });
    expect(await linhasDoHorario(agendada.id)).toHaveLength(1);
    expect(registro.erros).toEqual([]);
  });

  test("RN-23: três recusas deixam uma 'pulada' com o motivo, visível no histórico, e não há quarta", async () => {
    const usuario = await comChat("agenda-tres-recusas");
    const { rotina } = await rotinaPorColuna(usuario, AGENDA_SEG_0800);
    const registro = registroDoTeste();

    for (const [minutos, tentativa] of [
      [0, 1],
      [5, 2],
      [10, 3],
    ] as const) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 1,
      });
      const [linha] = await linhasDoHorario(rotina.id);
      expect(linha).toMatchObject({ status: "pulada", attempts: tentativa, errorCode: "SEM_IDEIA" });
      expect(linha?.endedAt).toEqual(depois(SEG_0800_SP, minutos));
    }

    // Sem quarta: nem aos 15 minutos, a ponta da janela.
    for (const minutos of [11, 14, 15]) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 0,
      });
    }
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: "pulada", attempts: 3, errorCode: "SEM_IDEIA" });
    expect(linhas[0]?.errorMessage).toBeTruthy();

    // Recusa de início não chama o provedor.
    expect(chamadasAoChat(dublê)).toHaveLength(0);

    // Aparece no histórico da rotina e no detalhe da execução.
    const historico = await api(usuario, "GET", `/ai/routines/${rotina.id}/runs`);
    expect(historico.status).toBe(200);
    expect((historico.body as RoutineRunPage).items).toMatchObject([
      { status: "pulada", trigger: "agenda", attempts: 3, errorCode: "SEM_IDEIA" },
    ]);
    const detalhe = await lerRun(usuario, linhas[0]?.id ?? "");
    expect(detalhe).toMatchObject({ status: "pulada", attempts: 3 });
    expect(proximaTentativa(detalhe)).toBeNull();
    // A `pulada` escreve em `ai_routine_run`: a rotina não conta como regravada.
    expect(await gravadaQuando(rotina.id)).toEqual(ANTES_DOS_HORARIOS);
    expect(registro.erros).toEqual([]);
  });

  test("RN-19 na conversão: um 'Rodar agora' entre a conferência e a conversão vira recusa somada, sem provedor", async () => {
    const usuario = await comChat("agenda-conversao-rn19");
    const manual = await rotinaPorPedido(usuario, {
      schedule: { days: [], times: [], active: false },
    });
    const { rotina, entrada } = await rotinaPorColuna(usuario, AGENDA_SEG_0800);
    const registro = registroDoTeste();

    // Primeira tentativa recusada (coluna vazia); a ideia chega para a segunda.
    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 0, recusadas: 1 });
    await criarCard(usuario, entrada, "Ideia da segunda tentativa");

    // O "Rodar agora" entra depois de a segunda tentativa conferir que não há
    // execução em andamento e antes da transação que converte a `pulada` — só
    // a escrita pode recusar, pelo índice de RN-19 sobre um UPDATE.
    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "# Manual", depois: "\n\ncorpo", solta }];
    const conferir = prisma.aiRoutineRun.findFirst.bind(prisma.aiRoutineRun);
    let conferiu = false;
    const espiaConferencia = vi
      .spyOn(prisma.aiRoutineRun, "findFirst")
      .mockImplementation(((args: Parameters<typeof conferir>[0]) => {
        if (args?.where?.status === "em_andamento") conferiu = true;
        return conferir(args);
      }) as unknown as typeof prisma.aiRoutineRun.findFirst);
    const transacionar = prisma.$transaction.bind(prisma) as (...a: unknown[]) => unknown;
    let runManual = "";
    const espiaTransacao = vi.spyOn(prisma, "$transaction").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (conferiu && !runManual) {
        runManual = "disparando";
        const r = await api(usuario, "POST", `/ai/routines/${manual.id}/runs`);
        expect(r.status, JSON.stringify(r.body)).toBe(202);
        runManual = (r.body as RoutineRunStarted).runId;
      }
      return transacionar(...args);
    }) as unknown as typeof prisma.$transaction);

    let resumo;
    try {
      resumo = await volta(usuario, depois(SEG_0800_SP, 5), registro);
    } finally {
      espiaConferencia.mockRestore();
      espiaTransacao.mockRestore();
    }

    expect(runManual).not.toBe("");
    expect(runManual).not.toBe("disparando");
    // Recusa, não 500: a tentativa conta, com o motivo de RN-19.
    expect(resumo).toEqual({ iniciadas: 0, recusadas: 1 });
    expect(registro.erros).toEqual([]);
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      status: "pulada",
      attempts: 2,
      errorCode: "ROTINA_EM_ANDAMENTO",
    });
    const passos = await prisma.aiRoutineRunStep.count({ where: { runId: linhas[0]?.id ?? "" } });
    expect(passos).toBe(0);

    // Só a manual chegou ao provedor.
    await esperar(
      async () => chamadasAoChat(dublê).length,
      (n) => n === 1,
      "a manual não chegou ao provedor",
    );
    soltar();
    expect(await esperarFim(usuario, runManual)).toMatchObject({ status: "concluida" });
    expect(chamadasAoChat(dublê)).toHaveLength(1);
  });
});

describe("CA-40 / RN-21: execução agendada que começou e falhou não se repete", () => {
  test("o provedor falha no meio: 'falhou', e as voltas seguintes não tentam de novo", async () => {
    const usuario = await comChat("agenda-ca40");
    const rotina = await rotinaPorPedido(usuario);
    dublê.roteiro = [{ tipo: "falha" }];
    const registro = registroDoTeste();

    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 1, recusadas: 0 });
    const [linha] = await linhasDoHorario(rotina.id);
    const run = await esperarFim(usuario, linha?.id ?? "");
    expect(run).toMatchObject({ status: "falhou", trigger: "agenda", attempts: 1 });
    const chamadas = chamadasAoChat(dublê).length;
    expect(chamadas).toBeGreaterThan(0);

    dublê.roteiro = [{ tipo: "texto", texto: "# Não devia rodar\n\ncorpo" }];
    for (const minutos of [1, 5, 6, 10, 15]) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 0,
      });
    }
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: "falhou", attempts: 1 });
    expect(chamadasAoChat(dublê)).toHaveLength(chamadas);
    expect(registro.erros).toEqual([]);
  });
});

/* -------------------------------------------------------------- janela */

describe("RN-22: a janela de recuperação é de 15 minutos", () => {
  test("o horário atendido aos 15 minutos entra; aos 16, é perdido e nada é gravado", async () => {
    const dentro = await comChat("agenda-janela-dentro");
    const fora = await comChat("agenda-janela-fora");
    const rotinaDentro = await rotinaPorPedido(dentro);
    const rotinaFora = await rotinaPorPedido(fora);
    dublê.roteiro = [{ tipo: "texto", texto: "# Atrasada\n\ncorpo" }];

    expect(await volta(fora, depois(SEG_0800_SP, 16))).toEqual({ iniciadas: 0, recusadas: 0 });
    expect(await linhasDoHorario(rotinaFora.id)).toHaveLength(0);

    expect(await volta(dentro, depois(SEG_0800_SP, 15))).toEqual({ iniciadas: 1, recusadas: 0 });
    const [linha] = await linhasDoHorario(rotinaDentro.id);
    expect(await esperarFim(dentro, linha?.id ?? "")).toMatchObject({
      status: "concluida",
      scheduledFor: SEG_0800_SP.toISOString(),
    });
  });

  test("primeira tentativa atrasada: a terceira cairia fora da janela, e o horário para na segunda", async () => {
    const usuario = await comChat("agenda-janela-atrasada");
    const { rotina } = await rotinaPorColuna(usuario, AGENDA_SEG_0800);
    const registro = registroDoTeste();

    expect(await volta(usuario, depois(SEG_0800_SP, 6), registro)).toEqual({
      iniciadas: 0,
      recusadas: 1,
    });
    expect(await volta(usuario, depois(SEG_0800_SP, 11), registro)).toEqual({
      iniciadas: 0,
      recusadas: 1,
    });
    // A terceira seria aos 16 minutos: fora da janela.
    for (const minutos of [12, 15, 16, 20]) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 0,
      });
    }
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: "pulada", attempts: 2, errorCode: "SEM_IDEIA" });
    expect(registro.erros).toEqual([]);
  });
});

/* ------------------------------------------------- pausar, validar, posse */

describe("RF-65 / RF-66: agenda ligada, pausada e validada", () => {
  test("rotina pausada não dispara no horário", async () => {
    const usuario = await comChat("agenda-pausada");
    const rotina = await rotinaPorPedido(usuario, {
      schedule: { days: [1], times: ["08:00"], active: false },
    });

    expect(await volta(usuario, SEG_0800_SP)).toEqual({ iniciadas: 0, recusadas: 0 });
    expect(await linhasDoHorario(rotina.id)).toHaveLength(0);
  });

  test("agenda ligada sem dia ou sem horário é 422, na criação e no PATCH que a mescla", async () => {
    const usuario = await comChat("agenda-422");
    const escritor = await agentePronto(usuario, "Escritor");
    const base: RoutineInput = {
      name: "Sem dia",
      inputKind: "pedido",
      inputPrompt: "Faça.",
      outputKind: "nota",
      outputTitle: "primeira_linha",
      steps: [{ agentId: escritor.id, mode: "reescreve" }],
    };

    for (const schedule of [
      { days: [], times: ["08:00"], active: true },
      { days: [1], times: [], active: true },
    ]) {
      const r = await api(usuario, "POST", "/ai/routines", { ...base, schedule });
      expect(r.status, JSON.stringify(schedule)).toBe(422);
    }

    // Sem agenda nenhuma: a forma de antes da Etapa F, desligada e vazia.
    const criada = await api(usuario, "POST", "/ai/routines", base);
    expect(criada.status).toBe(201);
    const rotina = criada.body as RoutineDetail;
    expect(rotina.schedule).toEqual({ days: [], times: [], active: false });
    expect(rotina.nextRuns).toEqual([]);

    // Retomar uma agenda vazia: a mesclada não tem dia, e é recusada.
    const retomar = await api(usuario, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { active: true },
    });
    expect(retomar.status).toBe(422);
    expect(codigo(retomar.body)).toBe("VALIDATION_ERROR");
    const relida = await api(usuario, "GET", `/ai/routines/${rotina.id}`);
    expect((relida.body as RoutineDetail).schedule).toEqual({ days: [], times: [], active: false });
  });

  test("RF-66: PATCH com só 'active: false' pausa sem perder dias e horários, e retomar volta a disparar", async () => {
    const usuario = await comChat("agenda-pausar");
    const rotina = await rotinaPorPedido(usuario, {
      schedule: { days: [5, 1], times: ["18:00", "08:00"], active: true },
    });
    // Gravada em ordem, o que a tela e a comparação de rascunho usam.
    expect(rotina.schedule).toEqual({ days: [1, 5], times: ["08:00", "18:00"], active: true });
    expect(rotina.nextRuns).toHaveLength(3);

    // Pausar e retomar gravam `updatedAt` — é o que o agendador compara com o
    // horário. O PATCH o grava com o relógio real.
    const antesDaPausa = Date.now();
    const pausa = await api(usuario, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { active: false },
    });
    expect(pausa.status, JSON.stringify(pausa.body)).toBe(200);
    expect(pausa.body).toMatchObject({
      schedule: { days: [1, 5], times: ["08:00", "18:00"], active: false },
      nextRuns: [],
    });
    expect((await gravadaQuando(rotina.id)).getTime()).toBeGreaterThanOrEqual(antesDaPausa);
    await gravadaEm(rotina.id, ANTES_DOS_HORARIOS);
    expect(await volta(usuario, SEG_0800_SP)).toEqual({ iniciadas: 0, recusadas: 0 });
    expect(await linhasDoHorario(rotina.id)).toHaveLength(0);

    const antesDaRetomada = Date.now();
    const retoma = await api(usuario, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { active: true },
    });
    expect(retoma.status).toBe(200);
    expect(retoma.body).toMatchObject({
      schedule: { days: [1, 5], times: ["08:00", "18:00"], active: true },
    });
    expect((retoma.body as RoutineDetail).nextRuns).toHaveLength(3);
    expect((await gravadaQuando(rotina.id)).getTime()).toBeGreaterThanOrEqual(antesDaRetomada);

    // Retomada às 07:30 na linha do tempo do teste: o horário das 08:00 dispara.
    await gravadaEm(rotina.id, depois(SEG_0800_SP, -30));
    dublê.roteiro = [{ tipo: "texto", texto: "# Retomada\n\ncorpo" }];
    expect(await volta(usuario, SEG_0800_SP)).toEqual({ iniciadas: 1, recusadas: 0 });
    const [linha] = await linhasDoHorario(rotina.id);
    expect(await esperarFim(usuario, linha?.id ?? "")).toMatchObject({ status: "concluida" });
  });

  test("RF-66: ligada ou retomada às 08:10, o horário das 08:00 não dispara; o do dia seguinte, sim", async () => {
    // A janela de 15 minutos recupera horário perdido com a API fora (RN-22),
    // não horário anterior à agenda existir: nada de disparo que ninguém pediu.
    const usuario = await comChat("agenda-ligada-depois");
    const rotina = await rotinaPorPedido(usuario, {
      schedule: { days: [1, 2], times: ["08:00"], active: true },
    });
    const registro = registroDoTeste();
    const ligadaAs = depois(SEG_0800_SP, 10);
    await gravadaEm(rotina.id, ligadaAs);

    for (const minutos of [10, 11, 15]) {
      expect(await volta(usuario, depois(SEG_0800_SP, minutos), registro)).toEqual({
        iniciadas: 0,
        recusadas: 0,
      });
    }
    expect(await linhasDoHorario(rotina.id)).toHaveLength(0);
    expect(chamadasAoChat(dublê)).toHaveLength(0);

    // Terça, 08:00: horário posterior à gravação, dispara.
    const TER_0800_SP = depois(SEG_0800_SP, 24 * 60);
    dublê.roteiro = [{ tipo: "texto", texto: "# Terça\n\ncorpo" }];
    expect(await volta(usuario, TER_0800_SP, registro)).toEqual({ iniciadas: 1, recusadas: 0 });
    const linhas = await linhasDoHorario(rotina.id);
    expect(linhas).toHaveLength(1);
    expect(await esperarFim(usuario, linhas[0]?.id ?? "")).toMatchObject({
      status: "concluida",
      scheduledFor: TER_0800_SP.toISOString(),
      attempts: 1,
    });

    // A execução escreve em `ai_routine_run`, não na rotina: `updatedAt` não se
    // move, e não vira "gravação" que pularia o horário seguinte.
    expect(await gravadaQuando(rotina.id)).toEqual(ligadaAs);
    expect(registro.erros).toEqual([]);
    expect(registro.avisos).toEqual([]);
  });

  test("uma rotina com horário gravado fora do schema não derruba a volta das outras", async () => {
    const usuario = await comChat("agenda-defeito");
    // Nome que ordena antes: a com defeito é lida primeiro.
    const defeito = await rotinaPorPedido(usuario, { name: "A com defeito" });
    const valida = await rotinaPorPedido(usuario, { name: "B válida" });
    // Escrita direta, como SQL à mão: o schema nunca aceitaria "99:99".
    await prisma.aiRoutine.update({
      where: { id: defeito.id },
      data: { scheduleTimes: ["99:99"], updatedAt: ANTES_DOS_HORARIOS },
    });
    const registro = registroDoTeste();

    dublê.roteiro = [{ tipo: "texto", texto: "# Válida\n\ncorpo" }];
    expect(await volta(usuario, SEG_0800_SP, registro)).toEqual({ iniciadas: 1, recusadas: 0 });
    const [linha] = await linhasDoHorario(valida.id);
    expect(await esperarFim(usuario, linha?.id ?? "")).toMatchObject({ status: "concluida" });
    expect(await linhasDoHorario(defeito.id)).toHaveLength(0);

    expect(registro.avisos).toHaveLength(1);
    expect(registro.avisos[0]).toMatchObject({ routineId: defeito.id });
    expect((registro.avisos[0] as { err: unknown }).err).toBeInstanceOf(RangeError);
    expect(registro.erros).toEqual([]);
  });
});

describe("RF-67: próximas execuções, no fuso do dono", () => {
  test("os três próximos saem no fuso da preferência, estritamente no futuro e em ordem", async () => {
    // Asia/Tokyo é UTC+9 o ano todo: 09:00 de lá é 00:00 UTC, todo dia.
    const usuario = await comChat("agenda-proximas", "Asia/Tokyo");
    const antes = Date.now();
    const rotina = await rotinaPorPedido(usuario, {
      schedule: { days: [0, 1, 2, 3, 4, 5, 6], times: ["09:00"], active: true },
    });
    const depoisDaCriacao = Date.now();

    const proximas = rotina.nextRuns.map((t) => new Date(t).getTime());
    expect(proximas).toHaveLength(3);
    for (const t of proximas) expect(new Date(t).toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(proximas[0]).toBeGreaterThan(antes);
    expect(proximas[0]).toBeLessThanOrEqual(depoisDaCriacao + 24 * 60 * MIN);
    expect((proximas[1] ?? 0) - (proximas[0] ?? 0)).toBe(24 * 60 * MIN);
    expect((proximas[2] ?? 0) - (proximas[1] ?? 0)).toBe(24 * 60 * MIN);

    // A galeria diz o mesmo que o detalhe.
    const lista = await api(usuario, "GET", "/ai/routines");
    const naLista = (lista.body as RoutineSummary[]).find((r) => r.id === rotina.id);
    expect(naLista?.nextRuns).toEqual(rotina.nextRuns);
  });

  test("pausada ou inválida não mostra próximas; a agenda gravada continua lá", async () => {
    const usuario = await comChat("agenda-proximas-vazias");
    const pausada = await rotinaPorPedido(usuario, {
      schedule: { days: [1], times: ["08:00"], active: false },
    });
    expect(pausada.nextRuns).toEqual([]);

    const invalida = await rotinaPorPedido(usuario);
    expect(invalida.nextRuns).toHaveLength(3);
    const agente = invalida.steps[0]?.agentId ?? "";
    expect((await api(usuario, "DELETE", `/ai/agents/${agente}`)).status).toBe(204);
    const relida = await api(usuario, "GET", `/ai/routines/${invalida.id}`);
    expect(relida.body).toMatchObject({
      valid: false,
      schedule: AGENDA_SEG_0800,
      nextRuns: [],
    });
  });

  test("INV-02: a agenda da rotina de outra conta é 404, e a volta de outra conta não a dispara", async () => {
    const dona = await comChat("agenda-dona");
    const intruso = await comChat("agenda-intruso");
    const rotina = await rotinaPorPedido(dona);

    const ler = await api(intruso, "GET", `/ai/routines/${rotina.id}`);
    expect(ler.status).toBe(404);
    const pausar = await api(intruso, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { active: false },
    });
    expect(pausar.status).toBe(404);
    const lista = await api(intruso, "GET", "/ai/routines");
    expect((lista.body as RoutineSummary[]).map((r) => r.id)).not.toContain(rotina.id);

    // O PATCH alheio não pausou nada.
    const daDona = await api(dona, "GET", `/ai/routines/${rotina.id}`);
    expect((daDona.body as RoutineDetail).schedule.active).toBe(true);

    // `somenteDe` restringe a volta a uma conta: a do intruso não toca a da dona.
    expect(await volta(intruso, SEG_0800_SP)).toEqual({ iniciadas: 0, recusadas: 0 });
    expect(await linhasDoHorario(rotina.id)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ Início */

/** O `HH:MM` e o dia da semana de um instante em UTC. */
function horarioUtc(instante: Date): { dia: number; hora: string } {
  const hh = String(instante.getUTCHours()).padStart(2, "0");
  const mm = String(instante.getUTCMinutes()).padStart(2, "0");
  return { dia: instante.getUTCDay(), hora: `${hh}:${mm}` };
}

describe("CA-42 / RF-69 / RN-23: o Início mostra o que as rotinas fizeram desde a última visita", () => {
  test("novas trazem a concluída e a pulada; depois de vistas somem, o marco não retrocede, e a seguinte aparece", async () => {
    // Fuso UTC, para montar um horário de agenda a partir do relógio real: o
    // Início corta por `endedAt <= agora`, e a `pulada` grava o `agora` da volta.
    const usuario = await comChat("agenda-ca42", "UTC");
    const { rotina, entrada, saidaBoardId } = await rotinaPorColuna(usuario, {
      days: [],
      times: [],
      active: false,
    });
    const lerInicio = async () => {
      const { status, body } = await api(usuario, "GET", "/dashboard");
      expect(status).toBe(200);
      return (body as Dashboard).rotinas;
    };

    // Uma concluída à mão, com card de saída.
    await criarCard(usuario, entrada, "Ideia do Início");
    dublê.roteiro = [{ tipo: "texto", texto: "Post do Início." }];
    const inicio = await api(usuario, "POST", `/ai/routines/${rotina.id}/runs`);
    expect(inicio.status).toBe(202);
    const concluida = (inicio.body as RoutineRunStarted).runId;
    expect(await esperarFim(usuario, concluida)).toMatchObject({ status: "concluida" });

    // Uma pulada pela agenda: a coluna esvaziou com a ideia consumida.
    const agora = new Date();
    const { dia, hora } = horarioUtc(new Date(agora.getTime() - 2 * MIN));
    const agendar = await api(usuario, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { days: [dia], times: [hora], active: true },
    });
    expect(agendar.status).toBe(200);
    // A agenda ligada agora não atende o horário de dois minutos atrás
    // (`pendentesDaRotina`); na linha do tempo do teste, ela já existia.
    await gravadaEm(rotina.id, new Date(agora.getTime() - 10 * MIN));
    expect(await volta(usuario, agora)).toEqual({ iniciadas: 0, recusadas: 1 });
    const pulada = (await linhasDoHorario(rotina.id)).find((l) => l.status === "pulada");
    expect(pulada).toBeDefined();

    // Sem marco: as das últimas 24 h, da mais recente.
    const primeira = await lerInicio();
    expect(primeira.vistoEm).toBeNull();
    expect(primeira.novas.map((r) => r.id)).toEqual([pulada?.id, concluida]);
    expect(primeira.novas[0]).toMatchObject({
      status: "pulada",
      trigger: "agenda",
      errorCode: "SEM_IDEIA",
      outputBoardId: null,
    });
    expect(primeira.novas[1]).toMatchObject({
      status: "concluida",
      trigger: "manual",
      outputBoardId: saidaBoardId,
      outputTitle: expect.any(String),
    });
    // As próximas saem das rotinas agendadas.
    expect(primeira.proximas.length).toBeGreaterThan(0);
    expect(primeira.proximas.every((p) => p.routineId === rotina.id)).toBe(true);

    // Marca como visto até o corte que o próprio Início devolveu.
    const visto = await api(usuario, "POST", "/ai/runs/seen", { seenAt: primeira.ate });
    expect(visto.status).toBe(204);
    const segunda = await lerInicio();
    expect(segunda.vistoEm).toBe(primeira.ate);
    expect(segunda.novas).toEqual([]);

    // Um marco mais velho não faz voltar o que já foi visto.
    const atras = new Date(new Date(primeira.ate).getTime() - 60 * MIN).toISOString();
    expect((await api(usuario, "POST", "/ai/runs/seen", { seenAt: atras })).status).toBe(204);
    const terceira = await lerInicio();
    expect(terceira.vistoEm).toBe(primeira.ate);
    expect(terceira.novas).toEqual([]);

    // Uma nova execução, terminada depois do marco, aparece sozinha.
    await criarCard(usuario, entrada, "Ideia seguinte");
    const pausar = await api(usuario, "PATCH", `/ai/routines/${rotina.id}`, {
      schedule: { active: false },
    });
    expect(pausar.status).toBe(200);
    const outra = await api(usuario, "POST", `/ai/routines/${rotina.id}/runs`);
    expect(outra.status).toBe(202);
    const seguinte = (outra.body as RoutineRunStarted).runId;
    expect(await esperarFim(usuario, seguinte)).toMatchObject({ status: "concluida" });
    const quarta = await lerInicio();
    expect(quarta.novas.map((r) => r.id)).toEqual([seguinte]);
  });

  test("marco no futuro é limitado a agora, e sem corpo o marco é agora", async () => {
    const usuario = await comChat("agenda-marco-futuro");
    const lerVisto = async () => {
      const { body } = await api(usuario, "GET", "/dashboard");
      return (body as Dashboard).rotinas.vistoEm;
    };

    // Sem linha de preferência: a rota a cria com o marco.
    const antes = Date.now();
    expect((await api(usuario, "POST", "/ai/runs/seen", {})).status).toBe(204);
    const semCorpo = new Date((await lerVisto()) ?? 0).getTime();
    expect(semCorpo).toBeGreaterThanOrEqual(antes);
    expect(semCorpo).toBeLessThanOrEqual(Date.now());

    const futuro = new Date(Date.now() + 24 * 60 * MIN).toISOString();
    const antesDoFuturo = Date.now();
    expect((await api(usuario, "POST", "/ai/runs/seen", { seenAt: futuro })).status).toBe(204);
    const limitado = new Date((await lerVisto()) ?? 0).getTime();
    expect(limitado).toBeGreaterThanOrEqual(antesDoFuturo);
    expect(limitado).toBeLessThanOrEqual(Date.now());
  });
});

/* ---------------------------------------------------- unidade: agenda.ts */

describe("instanteLocal: o relógio de parede do fuso vira instante", () => {
  test("CA-41: 08:00 em America/Sao_Paulo é 11:00 UTC", () => {
    expect(instanteLocal("2026-01-05", "08:00", "America/Sao_Paulo").toISOString()).toBe(
      "2026-01-05T11:00:00.000Z",
    );
  });

  test("virada de dia: o instante UTC cai no dia vizinho, para os dois lados", () => {
    expect(instanteLocal("2026-01-05", "23:30", "America/Sao_Paulo").toISOString()).toBe(
      "2026-01-06T02:30:00.000Z",
    );
    expect(instanteLocal("2026-01-05", "05:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-01-04T20:00:00.000Z",
    );
    expect(instanteLocal("2026-12-31", "23:59:59", "UTC").toISOString()).toBe(
      "2026-12-31T23:59:59.000Z",
    );
  });

  test("America/New_York acompanha o horário de verão dos dois lados da virada", () => {
    expect(instanteLocal("2026-03-07", "08:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T13:00:00.000Z",
    );
    expect(instanteLocal("2026-03-09", "08:00", "America/New_York").toISOString()).toBe(
      "2026-03-09T12:00:00.000Z",
    );
  });

  test("hora que não existe (o relógio pula de 02:00 para 03:00) avança para a primeira que existe", () => {
    // 8 de março de 2026, Nova York: 02:30 não acontece; 03:00 EDT é 07:00 UTC.
    expect(instanteLocal("2026-03-08", "02:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    expect(instanteLocal("2026-03-08", "02:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
  });

  test("hora repetida (o relógio volta de 02:00 para 01:00) resolve para a primeira vez", () => {
    // 1º de novembro de 2026, Nova York: 01:30 EDT (05:30 UTC) e 01:30 EST (06:30 UTC).
    expect(instanteLocal("2026-11-01", "01:30", "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  test("data ou hora impossível lança RangeError", () => {
    expect(() => instanteLocal("2026-02-30", "08:00", "UTC")).toThrow(RangeError);
    expect(() => instanteLocal("2026-01-05", "24:00", "UTC")).toThrow(RangeError);
    expect(() => instanteLocal("2026-01-05", "8:00", "UTC")).toThrow(RangeError);
  });
});

describe("proximosHorarios: a prévia 'Próximas'", () => {
  const SEGUNDA = { days: [1], times: ["08:00"] };

  test("virada de semana: de um sábado, a próxima é a segunda seguinte", () => {
    const sabado = new Date("2026-01-10T12:00:00.000Z");
    expect(
      proximosHorarios(SEGUNDA, "America/Sao_Paulo", sabado, 3).map((d) => d.toISOString()),
    ).toEqual(["2026-01-12T11:00:00.000Z", "2026-01-19T11:00:00.000Z", "2026-01-26T11:00:00.000Z"]);
  });

  test("estritamente depois: o próprio horário não é o próximo dele", () => {
    const noHorario = new Date("2026-01-12T11:00:00.000Z");
    expect(proximosHorarios(SEGUNDA, "America/Sao_Paulo", noHorario, 1)[0]?.toISOString()).toBe(
      "2026-01-19T11:00:00.000Z",
    );
    const umMsAntes = new Date(noHorario.getTime() - 1);
    expect(proximosHorarios(SEGUNDA, "America/Sao_Paulo", umMsAntes, 1)[0]?.toISOString()).toBe(
      "2026-01-12T11:00:00.000Z",
    );
  });

  test("vários dias e horários saem em ordem, fora de ordem na entrada", () => {
    const agenda = { days: [5, 1], times: ["18:00", "08:00"] };
    const domingo = new Date("2026-01-04T12:00:00.000Z");
    expect(
      proximosHorarios(agenda, "America/Sao_Paulo", domingo, 4).map((d) => d.toISOString()),
    ).toEqual([
      "2026-01-05T11:00:00.000Z",
      "2026-01-05T21:00:00.000Z",
      "2026-01-09T11:00:00.000Z",
      "2026-01-09T21:00:00.000Z",
    ]);
  });

  test("atravessa a virada do horário de verão de Nova York sem pular nem repetir dia", () => {
    const todo = { days: [0, 1, 2, 3, 4, 5, 6], times: ["02:30"] };
    expect(
      proximosHorarios(todo, "America/New_York", new Date("2026-03-07T00:00:00.000Z"), 3).map((d) =>
        d.toISOString(),
      ),
    ).toEqual(["2026-03-07T07:30:00.000Z", "2026-03-08T07:00:00.000Z", "2026-03-09T06:30:00.000Z"]);
  });

  test("sem dia ou sem horário, vazio", () => {
    const agora = new Date("2026-01-05T00:00:00.000Z");
    expect(proximosHorarios({ days: [], times: ["08:00"] }, "UTC", agora, 3)).toEqual([]);
    expect(proximosHorarios({ days: [1], times: [] }, "UTC", agora, 3)).toEqual([]);
  });
});

describe("horariosDevidos: o que uma volta atende", () => {
  const TODO_DIA = { days: [0, 1, 2, 3, 4, 5, 6], times: ["08:00"] };

  test("as duas pontas do intervalo entram", () => {
    const t = SEG_0800_SP;
    expect(horariosDevidos(TODO_DIA, "America/Sao_Paulo", t, t).map((d) => d.toISOString())).toEqual(
      [t.toISOString()],
    );
    expect(
      horariosDevidos(TODO_DIA, "America/Sao_Paulo", depois(t, -15), t).map((d) => d.toISOString()),
    ).toEqual([t.toISOString()]);
    expect(
      horariosDevidos(TODO_DIA, "America/Sao_Paulo", t, depois(t, 15)).map((d) => d.toISOString()),
    ).toEqual([t.toISOString()]);
  });

  test("um milissegundo fora, de qualquer lado, fica de fora", () => {
    const t = SEG_0800_SP.getTime();
    expect(
      horariosDevidos(TODO_DIA, "America/Sao_Paulo", new Date(t + 1), new Date(t + 15 * MIN)),
    ).toEqual([]);
    expect(
      horariosDevidos(TODO_DIA, "America/Sao_Paulo", new Date(t - 15 * MIN), new Date(t - 1)),
    ).toEqual([]);
  });

  test("um intervalo que cruza dias locais traz um horário por dia, em ordem", () => {
    expect(
      horariosDevidos(
        TODO_DIA,
        "America/Sao_Paulo",
        new Date("2026-01-04T00:00:00.000Z"),
        new Date("2026-01-06T23:59:00.000Z"),
      ).map((d) => d.toISOString()),
    ).toEqual(["2026-01-04T11:00:00.000Z", "2026-01-05T11:00:00.000Z", "2026-01-06T11:00:00.000Z"]);
  });
});

describe("proximaTentativa: quando a 'pulada' tenta de novo", () => {
  const pulada = (attempts: number, endedAt: string) => ({
    status: "pulada",
    attempts,
    endedAt,
    scheduledFor: SEG_0800_SP.toISOString(),
  });

  test("5 minutos depois da última recusa, se couber na janela; nunca depois da terceira", () => {
    expect(proximaTentativa(pulada(1, SEG_0800_SP.toISOString()))?.toISOString()).toBe(
      depois(SEG_0800_SP, 5).toISOString(),
    );
    expect(proximaTentativa(pulada(2, depois(SEG_0800_SP, 10).toISOString()))?.toISOString()).toBe(
      depois(SEG_0800_SP, 15).toISOString(),
    );
    expect(proximaTentativa(pulada(2, depois(SEG_0800_SP, 11).toISOString()))).toBeNull();
    expect(proximaTentativa(pulada(3, depois(SEG_0800_SP, 10).toISOString()))).toBeNull();
  });

  test("execução de verdade, de qualquer desfecho, não tenta de novo", () => {
    for (const status of ["em_andamento", "concluida", "falhou", "cancelada", "interrompida"]) {
      expect(
        proximaTentativa({ ...pulada(1, SEG_0800_SP.toISOString()), status }),
        status,
      ).toBeNull();
    }
  });
});

describe("diaParaPrazo não mudou ao passar a usar instanteLocal", () => {
  /** A versão de antes da Etapa F, copiada de `formato.ts` para comparar. */
  function diaParaPrazoAntigo(dia: string, fuso: string): string {
    const comoSeFosseUtc = (instante: Date) => {
      const partes = new Intl.DateTimeFormat("en-US", {
        timeZone: fuso,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(instante);
      const campo = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
      return Date.UTC(
        campo("year"),
        campo("month") - 1,
        campo("day"),
        campo("hour") % 24,
        campo("minute"),
        campo("second"),
      );
    };
    const [ano, mes, d] = dia.split("-").map(Number);
    const alvo = Date.UTC(ano ?? 0, (mes ?? 1) - 1, d ?? 1, 23, 59, 59);
    let instante = alvo;
    for (let volta = 0; volta < 2; volta += 1) {
      instante = alvo - (comoSeFosseUtc(new Date(instante)) - instante);
    }
    return new Date(instante).toISOString();
  }

  test("valores de referência, inclusive no dia da virada do horário de verão", () => {
    expect(diaParaPrazo("2026-01-05", "America/Sao_Paulo")).toBe("2026-01-06T02:59:59.000Z");
    expect(diaParaPrazo("2026-01-05", "Asia/Tokyo")).toBe("2026-01-05T14:59:59.000Z");
    expect(diaParaPrazo("2026-03-08", "America/New_York")).toBe("2026-03-09T03:59:59.000Z");
    expect(diaParaPrazo("2026-11-01", "America/New_York")).toBe("2026-11-02T04:59:59.000Z");
  });

  test("todo dia de 2026, em seis fusos, dá o mesmo que a versão antiga", () => {
    const fusos = [
      "UTC",
      "America/Sao_Paulo",
      "America/New_York",
      "Asia/Tokyo",
      "Asia/Kolkata",
      "Pacific/Auckland",
    ];
    const divergentes: string[] = [];
    for (const fuso of fusos) {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 24 * 60 * MIN) {
        const dia = new Date(t).toISOString().slice(0, 10);
        const novo = diaParaPrazo(dia, fuso);
        const antigo = diaParaPrazoAntigo(dia, fuso);
        if (novo !== antigo) divergentes.push(`${fuso} ${dia}: ${novo} != ${antigo}`);
      }
    }
    expect(divergentes).toEqual([]);
  });

  test("data impossível segue recusada com a frase de sempre", () => {
    expect(() => diaParaPrazo("2026-02-30", "UTC")).toThrow("dueDate não é uma data existente");
    expect(() => diaParaPrazo("2026-13-01", "UTC")).toThrow("dueDate não é uma data existente");
  });
});
