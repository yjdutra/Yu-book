import { FERRAMENTAS_DO_ACERVO } from "@yu-book/shared";
import type {
  AgentDetail,
  AiSettings,
  BoardDetail,
  CardDetail,
  NomeDeFerramenta,
  RotinaEvent,
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
import {
  assinantesDe,
  assinar,
  reconciliarExecucoes,
} from "../src/modules/assistente/execucao.service.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";
import { chamadasAoChat, subirProvedor } from "./provedor.js";
import type { Dublê } from "./provedor.js";

/**
 * Rotinas — Etapa E da frente de IA, §5.7 de `docs/prd-ia-no-yu-book.md`,
 * RN-16 a RN-19, RNF-11 e CA-29 a CA-34.
 *
 * O que esta suíte protege, em uma frase: **a rotina escreve pelo código, só
 * no fim, e só quando tudo deu certo.** Falhou, estourou o teto ou foi
 * cancelada: nenhum card, e a ideia fica onde estava para a próxima vez.
 *
 * A execução roda destacada da requisição (RF-58): o `POST` responde 202 e o
 * teste espera o término relendo `GET /ai/runs/:runId`. Quando precisa agir
 * **no meio**, o dublê segura a geração num turno `segura` e o teste solta —
 * nada aqui depende de relógio para acertar a ordem.
 */

let app: FastifyInstance;
let dublê: Dublê;
/// Base HTTP de verdade, só para o SSE: `app.inject` só devolve a resposta
/// quando o fluxo fecha, e assinar no meio exige ler o primeiro evento antes.
let base: string;

beforeAll(async () => {
  await limpar();
  dublê = await subirProvedor();
  app = await subirApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
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
const INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/// O início de execução tem limite próprio de 10/min por IP; um IP por chamada
/// é o que aconteceria com sessões diferentes (ver `apoio.ts`).
let ipSeguinte = 0;
const proximoIp = () => {
  ipSeguinte += 1;
  return `10.9.${Math.floor(ipSeguinte / 250)}.${(ipSeguinte % 250) + 1}`;
};

/** Um usuário pronto para rodar rotina: o modelo do chat escolhido. */
async function comChat(
  apelido: string,
  preco: { promptMicros?: number; completionMicros?: number } = {},
): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId: "estudio/conversa",
      name: "Estúdio: Conversa",
      contextLength: 128_000,
      promptMicros: preco.promptMicros ?? 0,
      completionMicros: preco.completionMicros ?? 0,
      supportsTools: true,
    },
  });
  await prisma.aiTaskModel.create({
    data: { userId: usuario.id, task: "chat", modelId: "estudio/conversa" },
  });
  return usuario;
}

/** Um quadro com as três colunas padrão, pelas rotas de verdade. */
async function criarQuadro(usuario: Usuario, nome: string): Promise<BoardDetail> {
  const workspace = await prisma.workspace.create({
    data: { userId: usuario.id, name: `Espaço ${nome}` },
  });
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/boards",
    token: usuario.token,
    body: { name: nome, workspaceId: workspace.id },
  });
  expect(status).toBe(201);
  return body as BoardDetail;
}

const colunaDe = (quadro: BoardDetail, i: number) => quadro.columns[i]?.id ?? "";

async function criarCard(
  usuario: Usuario,
  columnId: string,
  title: string,
  descriptionMd = "",
): Promise<string> {
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/cards",
    token: usuario.token,
    body: { columnId, title, descriptionMd },
  });
  expect(status).toBe(201);
  return (body as CardDetail).id;
}

async function agentePronto(usuario: Usuario, corpo: Record<string, unknown>): Promise<AgentDetail> {
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/ai/agents",
    token: usuario.token,
    body: corpo,
  });
  expect(status).toBe(201);
  return body as AgentDetail;
}

/** Entrada, consumidas e uma saída noutro quadro — a saída pode ser de qualquer um. */
interface Cenario {
  usuario: Usuario;
  conteudo: BoardDetail;
  entrada: string;
  consumidas: string;
  saida: string;
}

async function cenario(apelido: string, preco?: Parameters<typeof comChat>[1]): Promise<Cenario> {
  const usuario = await comChat(apelido, preco);
  const conteudo = await criarQuadro(usuario, "Conteúdo");
  const publicacao = await criarQuadro(usuario, "Publicação");
  return {
    usuario,
    conteudo,
    entrada: colunaDe(conteudo, 0),
    consumidas: colunaDe(conteudo, 2),
    saida: colunaDe(publicacao, 0),
  };
}

function corpoDaRotina(
  c: Cenario,
  steps: RoutineInput["steps"],
  extra: Partial<RoutineInput> = {},
): RoutineInput {
  return {
    name: "Post do LinkedIn",
    inputBoardId: c.conteudo.id,
    inputColumnId: c.entrada,
    outputColumnId: c.saida,
    consumeAction: "mover",
    consumeColumnId: c.consumidas,
    steps,
    ...extra,
  };
}

const criarRotina = (usuario: Usuario, corpo: unknown) =>
  chamar(app, { method: "POST", url: "/ai/routines", token: usuario.token, body: corpo });

async function rotinaPronta(usuario: Usuario, corpo: RoutineInput): Promise<RoutineDetail> {
  const { status, body } = await criarRotina(usuario, corpo);
  expect(status, JSON.stringify(body)).toBe(201);
  return body as RoutineDetail;
}

const rodar = (usuario: Usuario, routineId: string) =>
  chamar(app, {
    method: "POST",
    url: `/ai/routines/${routineId}/runs`,
    token: usuario.token,
    ip: proximoIp(),
  });

async function rodarAceito(usuario: Usuario, routineId: string): Promise<string> {
  const { status, body } = await rodar(usuario, routineId);
  expect(status, JSON.stringify(body)).toBe(202);
  return (body as RoutineRunStarted).runId;
}

const lerRun = async (usuario: Usuario, runId: string) => {
  const { status, body } = await chamar(app, {
    method: "GET",
    url: `/ai/runs/${runId}`,
    token: usuario.token,
  });
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

/** Uma trava que o teste solta. */
function trava(): { solta: Promise<void>; soltar: () => void } {
  let soltar: () => void = () => undefined;
  const solta = new Promise<void>((ok) => {
    soltar = ok;
  });
  return { solta, soltar };
}

interface CorpoDoPedido {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
}

const pedidos = () => dublê.corpos as unknown as CorpoDoPedido[];
const mensagem = (corpo: CorpoDoPedido | undefined, role: string) =>
  corpo?.messages.find((m) => m.role === role)?.content ?? "";

/** Assere que os trechos aparecem, e nesta ordem. */
function emOrdem(texto: string, trechos: string[]): void {
  let anterior = -1;
  for (const trecho of trechos) {
    const i = texto.indexOf(trecho);
    expect(i, `«${trecho}» ausente`).toBeGreaterThanOrEqual(0);
    expect(i, `«${trecho}» fora de ordem`).toBeGreaterThan(anterior);
    anterior = i;
  }
}

const cardNoBanco = (id: string) =>
  prisma.card.findUniqueOrThrow({ where: { id }, select: { columnId: true, archived: true } });

const cardsNaColuna = (columnId: string) => prisma.card.count({ where: { columnId } });

/* ------------------------------------------------------------------- CRUD */

describe("RF-54 / RN-15: a rotina é do usuário, e só dele", () => {
  test("criar devolve o detalhe válido, com a próxima ideia, e o detalhe relido é o mesmo", async () => {
    const c = await cenario("rotina-criar");
    await criarCard(c.usuario, c.entrada, "Primeira ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve", instruction: "Escreva." }]),
    );

    expect(rotina).toMatchObject({
      name: "Post do LinkedIn",
      valid: true,
      problems: [],
      eligibleCount: 1,
      nextIdea: { title: "Primeira ideia" },
      consumeAction: "mover",
      consume: { columnId: c.consumidas, boardId: c.conteudo.id },
      steps: [{ position: 0, agentId: escritor.id, agentName: "Escritor", mode: "reescreve" }],
    });
    const relido = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect(relido.body).toEqual(rotina);
  });

  test("INV-02: rotina de outra conta responde igual à inexistente, em toda rota", async () => {
    const c = await cenario("rotina-dona");
    const intruso = await comChat("rotina-intrusa");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );

    const rotas = [
      { method: "GET" as const, url: (id: string) => `/ai/routines/${id}` },
      { method: "PATCH" as const, url: (id: string) => `/ai/routines/${id}`, body: { name: "x" } },
      { method: "DELETE" as const, url: (id: string) => `/ai/routines/${id}` },
      { method: "POST" as const, url: (id: string) => `/ai/routines/${id}/runs` },
      { method: "GET" as const, url: (id: string) => `/ai/routines/${id}/runs` },
    ];
    for (const rota of rotas) {
      const alheia = await chamar(app, {
        method: rota.method,
        url: rota.url(rotina.id),
        token: intruso.token,
        body: rota.body,
        ip: proximoIp(),
      });
      const nenhuma = await chamar(app, {
        method: rota.method,
        url: rota.url(INEXISTENTE),
        token: intruso.token,
        body: rota.body,
        ip: proximoIp(),
      });
      expect(alheia.status, `${rota.method} ${rota.url("…")}`).toBe(404);
      expect(alheia.body).toEqual(nenhuma.body);
    }

    const lista = await chamar(app, { method: "GET", url: "/ai/routines", token: intruso.token });
    expect(lista.body).toEqual([]);
    // Nada mudou do lado da dona: nem nome, nem existência, nem execução.
    const dela = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect((dela.body as RoutineDetail).name).toBe("Post do LinkedIn");
    expect(await prisma.aiRoutineRun.count({ where: { routineId: rotina.id } })).toBe(0);
  });

  test("RN-15 / INV-59: coluna e agente de outra conta são o mesmo 404 do inexistente", async () => {
    const c = await cenario("rotina-refs");
    const outro = await cenario("rotina-refs-alheio");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const agenteAlheio = await agentePronto(outro.usuario, { name: "Alheio" });
    const passo = [{ agentId: escritor.id, mode: "reescreve" as const }];

    const casos: { rotulo: string; alheio: RoutineInput; inexistente: RoutineInput }[] = [
      {
        rotulo: "entrada",
        alheio: corpoDaRotina(c, passo, {
          inputBoardId: outro.conteudo.id,
          inputColumnId: outro.entrada,
          consumeAction: "manter",
          consumeColumnId: null,
        }),
        inexistente: corpoDaRotina(c, passo, {
          inputBoardId: INEXISTENTE,
          inputColumnId: INEXISTENTE,
          consumeAction: "manter",
          consumeColumnId: null,
        }),
      },
      {
        rotulo: "saída",
        alheio: corpoDaRotina(c, passo, { outputColumnId: outro.saida }),
        inexistente: corpoDaRotina(c, passo, { outputColumnId: INEXISTENTE }),
      },
      {
        rotulo: "consumidas",
        alheio: corpoDaRotina(c, passo, { consumeColumnId: outro.consumidas }),
        inexistente: corpoDaRotina(c, passo, { consumeColumnId: INEXISTENTE }),
      },
      {
        rotulo: "agente",
        alheio: corpoDaRotina(c, [{ agentId: agenteAlheio.id, mode: "reescreve" }]),
        inexistente: corpoDaRotina(c, [{ agentId: INEXISTENTE, mode: "reescreve" }]),
      },
    ];
    for (const caso of casos) {
      const alheio = await criarRotina(c.usuario, caso.alheio);
      const inexistente = await criarRotina(c.usuario, caso.inexistente);
      expect(alheio.status, caso.rotulo).toBe(404);
      expect(alheio.body, caso.rotulo).toEqual(inexistente.body);
    }
    expect(await prisma.aiRoutine.count({ where: { userId: c.usuario.id } })).toBe(0);
  });

  test("INV-12: a coluna das ideias usadas precisa ser do quadro da entrada", async () => {
    const c = await cenario("rotina-outro-quadro");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });

    // A saída é de outro quadro e isso é permitido; a de consumidas, não.
    const { status, body } = await criarRotina(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }], {
        consumeColumnId: c.saida,
      }),
    );

    expect(status).toBe(422);
    expect(codigo(body)).toBe("VALIDATION_ERROR");
    expect(await prisma.aiRoutine.count({ where: { userId: c.usuario.id } })).toBe(0);
  });

  test("sem passo que reescreva, ou com mais de seis passos, a rotina é recusada", async () => {
    const c = await cenario("rotina-passos");
    const agente = await agentePronto(c.usuario, { name: "Revisor" });

    const soRevisa = await criarRotina(
      c.usuario,
      corpoDaRotina(c, [{ agentId: agente.id, mode: "revisa" }]),
    );
    const demais = await criarRotina(
      c.usuario,
      corpoDaRotina(
        c,
        Array.from({ length: 7 }, () => ({ agentId: agente.id, mode: "reescreve" as const })),
      ),
    );
    const nenhum = await criarRotina(c.usuario, corpoDaRotina(c, []));

    for (const r of [soRevisa, demais, nenhum]) {
      expect(r.status).toBe(422);
      expect(codigo(r.body)).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.aiRoutine.count({ where: { userId: c.usuario.id } })).toBe(0);
  });

  test("PATCH confere só o que mudou: coluna e agente que sumiram não impedem renomear", async () => {
    const c = await cenario("rotina-patch");
    const outro = await cenario("rotina-patch-alheio");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    await prisma.boardColumn.delete({ where: { id: c.saida } });
    await chamar(app, { method: "DELETE", url: `/ai/agents/${escritor.id}`, token: c.usuario.token });

    const renomear = await chamar(app, {
      method: "PATCH",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
      body: { name: "Renomeada" },
    });
    expect(renomear.status).toBe(200);
    const detalhe = renomear.body as RoutineDetail;
    expect(detalhe.name).toBe("Renomeada");
    // O que sumiu não some da tela: vira problema apontado no bloco.
    expect(detalhe.valid).toBe(false);
    expect(detalhe.problems.map((p) => [p.block, p.position])).toEqual(
      expect.arrayContaining([
        ["passo", 0],
        ["saida", null],
      ]),
    );

    // O que muda é conferido: a saída trocada por uma alheia é 404.
    const saidaAlheia = await chamar(app, {
      method: "PATCH",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
      body: { outputColumnId: outro.saida },
    });
    expect(saidaAlheia.status).toBe(404);

    // As regras que cruzam campo valem para a rotina mesclada.
    const semReescreve = await chamar(app, {
      method: "PATCH",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
      body: { steps: [{ agentId: (await agentePronto(c.usuario, { name: "R" })).id, mode: "revisa" }] },
    });
    expect(semReescreve.status).toBe(422);

    const manter = await chamar(app, {
      method: "PATCH",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
      body: { consumeAction: "manter" },
    });
    expect(manter.status).toBe(200);
    expect((manter.body as RoutineDetail).consume).toBeNull();
    const moverSemColuna = await chamar(app, {
      method: "PATCH",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
      body: { consumeAction: "mover" },
    });
    expect(moverSemColuna.status).toBe(422);
  });
});

/* --------------------------------------------------------------- execução */

describe("CA-29 / RF-56 / RF-57: três passos até o card de saída", () => {
  test("reescreve, reescreve, revisa: cada passo recebe o que deve, e o card leva o segundo texto e as observações do terceiro", async () => {
    const c = await cenario("rotina-ca29");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia A", "DESCRICAO-DA-IDEIA");
    await criarCard(c.usuario, c.entrada, "Ideia B");
    const escritor = await agentePronto(c.usuario, {
      name: "Escritor",
      instructionsMd: "CONTEXTO-DO-ESCRITOR",
    });
    const marketing = await agentePronto(c.usuario, {
      name: "Marketing",
      instructionsMd: "CONTEXTO-DO-MARKETING",
    });
    const revisor = await agentePronto(c.usuario, {
      name: "Revisor",
      instructionsMd: "CONTEXTO-DO-REVISOR",
    });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [
        { agentId: escritor.id, mode: "reescreve", instruction: "INSTRUCAO-UM" },
        { agentId: marketing.id, mode: "reescreve", instruction: "INSTRUCAO-DOIS" },
        { agentId: revisor.id, mode: "revisa", instruction: "INSTRUCAO-TRES" },
      ]),
    );
    dublê.roteiro = [
      { tipo: "texto", texto: "RASCUNHO-UM", custoMicros: 10 },
      { tipo: "texto", texto: "RASCUNHO-DOIS", custoMicros: 20 },
      { tipo: "texto", texto: "- OBSERVACAO-TRES", custoMicros: 30 },
    ];

    const runId = await rodarAceito(c.usuario, rotina.id);
    const run = await esperarFim(c.usuario, runId);

    expect(run).toMatchObject({
      status: "concluida",
      routineId: rotina.id,
      routineName: "Post do LinkedIn",
      inputCardId: ideia,
      inputTitle: "Ideia A",
      costMicros: 60,
      errorCode: null,
    });
    expect(run.steps.map((s) => [s.agentName, s.mode, s.status, s.text])).toEqual([
      ["Escritor", "reescreve", "concluido", "RASCUNHO-UM"],
      ["Marketing", "reescreve", "concluido", "RASCUNHO-DOIS"],
      ["Revisor", "revisa", "concluido", "- OBSERVACAO-TRES"],
    ]);

    // O que cada passo mandou ao provedor.
    const [p1, p2, p3] = pedidos();
    expect(pedidos()).toHaveLength(3);
    expect(mensagem(p1, "system")).toContain("CONTEXTO-DO-ESCRITOR");
    expect(mensagem(p2, "system")).toContain("CONTEXTO-DO-MARKETING");
    expect(mensagem(p3, "system")).toContain("CONTEXTO-DO-REVISOR");
    expect(mensagem(p2, "system")).not.toContain("CONTEXTO-DO-ESCRITOR");
    emOrdem(mensagem(p1, "user"), [
      "Ideia A",
      "DESCRICAO-DA-IDEIA",
      "## Rascunho atual",
      "ainda não há rascunho",
      "INSTRUCAO-UM",
    ]);
    // "reescreve" substitui o rascunho: o terceiro vê o segundo, não o primeiro.
    emOrdem(mensagem(p2, "user"), ["Ideia A", "RASCUNHO-UM", "INSTRUCAO-DOIS"]);
    emOrdem(mensagem(p3, "user"), ["Ideia A", "RASCUNHO-DOIS", "INSTRUCAO-TRES"]);
    expect(mensagem(p3, "user")).not.toContain("RASCUNHO-UM");
    expect(mensagem(p3, "user")).toContain("Não reescreva o rascunho");

    // O card de saída, na coluna de saída, com a marca da execução (INV-58).
    expect(run.outputCardId).not.toBeNull();
    const saida = await chamar(app, {
      method: "GET",
      url: `/cards/${run.outputCardId}`,
      token: c.usuario.token,
    });
    const card = saida.body as CardDetail;
    expect(card.columnId).toBe(c.saida);
    expect(card.title).toBe("Ideia A");
    emOrdem(card.descriptionMd, ["RASCUNHO-DOIS", "### Observações", "Revisor", "- OBSERVACAO-TRES"]);
    expect(card.descriptionMd).not.toContain("RASCUNHO-UM");
    expect(card.ai).toMatchObject({
      via: "rotina",
      routineName: "Post do LinkedIn",
      // O agente do último passo que reescreveu: foi ele quem escreveu o texto.
      agentName: "Marketing",
      runId,
      author: "estudio/conversa",
      conversationId: null,
      revisedAt: null,
    });

    // A ideia foi para as consumidas, e a próxima é a seguinte.
    expect((await cardNoBanco(ideia)).columnId).toBe(c.consumidas);
    const detalhe = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect((detalhe.body as RoutineDetail).nextIdea?.title).toBe("Ideia B");
    expect((detalhe.body as RoutineDetail).lastRun?.id).toBe(runId);

    const historico = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}/runs`,
      token: c.usuario.token,
    });
    expect((historico.body as RoutineRunPage).items.map((r) => r.id)).toEqual([runId]);
  });

  test("o passo depois de um 'revisa' recebe as observações, entre o rascunho e a tarefa", async () => {
    const c = await cenario("rotina-observacoes");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const revisor = await agentePronto(c.usuario, { name: "Revisor" });
    const final = await agentePronto(c.usuario, { name: "Finalizador" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [
        { agentId: escritor.id, mode: "reescreve" },
        { agentId: revisor.id, mode: "revisa" },
        { agentId: final.id, mode: "reescreve", instruction: "APLIQUE-AS-OBSERVACOES" },
      ]),
    );
    dublê.roteiro = [
      { tipo: "texto", texto: "RASCUNHO-UM" },
      { tipo: "texto", texto: "OBSERVACAO-DO-REVISOR" },
      { tipo: "texto", texto: "RASCUNHO-FINAL" },
    ];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect(run.status).toBe("concluida");
    emOrdem(mensagem(pedidos()[2], "user"), [
      "## Ideia",
      "## Rascunho atual",
      "RASCUNHO-UM",
      "## Observações dos passos anteriores",
      "Revisor",
      "OBSERVACAO-DO-REVISOR",
      "## Sua tarefa neste passo",
      "APLIQUE-AS-OBSERVACOES",
    ]);
    const card = await chamar(app, {
      method: "GET",
      url: `/cards/${run.outputCardId}`,
      token: c.usuario.token,
    });
    emOrdem((card.body as CardDetail).descriptionMd, ["RASCUNHO-FINAL", "OBSERVACAO-DO-REVISOR"]);
    expect((card.body as CardDetail).ai?.agentName).toBe("Finalizador");
  });

  test("ação 'arquivar': a ideia sai da numeração, e o título pela primeira linha tira a marcação", async () => {
    const c = await cenario("rotina-arquivar");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia a arquivar");
    const vizinha = await criarCard(c.usuario, c.entrada, "Vizinha");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }], {
        consumeAction: "arquivar",
        consumeColumnId: null,
        outputTitle: "primeira_linha",
      }),
    );
    dublê.roteiro = [{ tipo: "texto", texto: "# Título do post\n\nCorpo do post." }];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect(run.status).toBe("concluida");
    expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: true });
    // INV-13: arquivado sai da numeração — a vizinha passa a ser a primeira.
    const vizinhaNoBanco = await prisma.card.findUniqueOrThrow({ where: { id: vizinha } });
    expect(vizinhaNoBanco.position).toBe(0);
    const card = await chamar(app, {
      method: "GET",
      url: `/cards/${run.outputCardId}`,
      token: c.usuario.token,
    });
    expect((card.body as CardDetail).title).toBe("Título do post");
  });
});

describe("CA-30 / RN-18: uma ideia, um post", () => {
  test("com 'manter', a segunda execução pega a ideia seguinte; sem ideia elegível, 404 SEM_IDEIA", async () => {
    const c = await cenario("rotina-manter");
    const primeira = await criarCard(c.usuario, c.entrada, "Primeira");
    const segunda = await criarCard(c.usuario, c.entrada, "Segunda");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }], {
        consumeAction: "manter",
        consumeColumnId: null,
      }),
    );
    dublê.roteiro = [{ tipo: "texto", texto: "post" }];

    const um = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));
    const dois = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect([um.status, um.inputCardId]).toEqual(["concluida", primeira]);
    expect([dois.status, dois.inputCardId]).toEqual(["concluida", segunda]);
    // "manter" é manter: as duas continuam na entrada, ativas.
    expect(await cardNoBanco(primeira)).toEqual({ columnId: c.entrada, archived: false });
    expect(await cardNoBanco(segunda)).toEqual({ columnId: c.entrada, archived: false });

    const terceira = await rodar(c.usuario, rotina.id);
    expect(terceira.status).toBe(404);
    expect(codigo(terceira.body)).toBe("SEM_IDEIA");
    expect(await cardsNaColuna(c.saida)).toBe(2);
  });

  test("coluna de entrada vazia é 404 SEM_IDEIA, e nenhuma execução é criada", async () => {
    const c = await cenario("rotina-vazia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );

    const r = await rodar(c.usuario, rotina.id);

    expect(r.status).toBe(404);
    expect(codigo(r.body)).toBe("SEM_IDEIA");
    expect(await prisma.aiRoutineRun.count({ where: { userId: c.usuario.id } })).toBe(0);
    expect(chamadasAoChat(dublê)).toHaveLength(0);
  });
});

describe("RN-19: uma execução em andamento por conta", () => {
  test("rodar de novo enquanto a primeira roda é 409, mesmo sendo outra rotina", async () => {
    const c = await cenario("rotina-uma-por-vez");
    await criarCard(c.usuario, c.entrada, "Ideia 1");
    await criarCard(c.usuario, c.entrada, "Ideia 2");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    const outra = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }], { name: "Outra" }),
    );
    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "meio ", depois: "fim", solta }];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        async () => chamadasAoChat(dublê).length,
        (n) => n === 1,
        "o passo não chegou ao provedor",
      );

      const mesma = await rodar(c.usuario, rotina.id);
      const deOutra = await rodar(c.usuario, outra.id);

      for (const r of [mesma, deOutra]) {
        expect(r.status).toBe(409);
        expect(codigo(r.body)).toBe("ROTINA_EM_ANDAMENTO");
      }
      expect(await prisma.aiRoutineRun.count({ where: { userId: c.usuario.id } })).toBe(1);

      soltar();
      expect((await esperarFim(c.usuario, runId)).status).toBe("concluida");
    } finally {
      soltar();
    }
  });

  test("INV-04: dois inícios que passam juntos pela consulta — um em cada instância — dão um só", async () => {
    const c = await cenario("rotina-duas-instancias");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia disputada");
    const rotina = await rotinaDeDoisPassos(c);

    // A instância vizinha escolheu a mesma ideia e cria a execução dela
    // **depois** de esta ter conferido que não havia nenhuma e escolhido a
    // ideia — entre a conferência e a transação que cria. Só a escrita pode
    // recusar. A conferência passa inalterada, mas é registrada: a vizinha só
    // entra se ela já rodou, senão o 409 viria da consulta e não do índice.
    const conferir = prisma.aiRoutineRun.findFirst.bind(prisma.aiRoutineRun);
    let conferiu = false;
    const espiaConferencia = vi
      .spyOn(prisma.aiRoutineRun, "findFirst")
      .mockImplementation(((args: Parameters<typeof conferir>[0]) => {
        if (args?.where?.status === "em_andamento") conferiu = true;
        return conferir(args);
      }) as unknown as typeof prisma.aiRoutineRun.findFirst);
    const transacionar = prisma.$transaction.bind(prisma) as (...a: unknown[]) => unknown;
    let vizinha = "";
    const espiaTransacao = vi.spyOn(prisma, "$transaction").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (conferiu && !vizinha) vizinha = await execucaoSemDono(c, rotina, ideia, 0);
      return transacionar(...args);
    }) as unknown as typeof prisma.$transaction);

    try {
      const r = await rodar(c.usuario, rotina.id);

      expect(vizinha).not.toBe("");
      expect(r.status).toBe(409);
      expect(codigo(r.body)).toBe("ROTINA_EM_ANDAMENTO");
    } finally {
      espiaConferencia.mockRestore();
      espiaTransacao.mockRestore();
    }
    const runs = await prisma.aiRoutineRun.findMany({
      where: { userId: c.usuario.id },
      select: { id: true, status: true, _count: { select: { steps: true } } },
    });
    // Só a da vizinha, com os dois passos dela: a recusada não deixou passo.
    expect(runs).toEqual([{ id: vizinha, status: "em_andamento", _count: { steps: 2 } }]);
    expect(chamadasAoChat(dublê)).toHaveLength(0);
    expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });
    expect(await prisma.card.count({ where: { columnId: c.saida } })).toBe(0);
  });
});

describe("CA-31 / RN-17: o teto por execução corta antes da chamada", () => {
  test("estoura no segundo passo: falhou com TETO_DA_EXECUCAO, sem card, ideia intacta, o resto pulado", async () => {
    // 1 USD por milhão de tokens de saída: a estimativa de um passo fica em
    // ~2.048 µUSD. O primeiro custa 3.000; o segundo passaria de 5.000.
    const c = await cenario("rotina-teto", { completionMicros: 1_000_000 });
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia cara");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(
        c,
        [
          { agentId: escritor.id, mode: "reescreve" },
          { agentId: escritor.id, mode: "reescreve" },
          { agentId: escritor.id, mode: "revisa" },
        ],
        { runCapMicros: 5_000 },
      ),
    );
    dublê.roteiro = [{ tipo: "texto", texto: "rascunho caro", custoMicros: 3_000 }];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect(run).toMatchObject({
      status: "falhou",
      errorCode: "TETO_DA_EXECUCAO",
      outputCardId: null,
      costMicros: 3_000,
    });
    expect(run.steps.map((s) => s.status)).toEqual(["concluido", "falhou", "pulado"]);
    expect(run.steps[1]?.errorCode).toBe("TETO_DA_EXECUCAO");
    // INV-47: o corte é antes da conexão — o segundo passo nunca chegou ao provedor.
    expect(chamadasAoChat(dublê)).toHaveLength(1);
    expect(await prisma.aiUsage.count({ where: { runId: run.id } })).toBe(1);
    // RN-16: falhou, nada é escrito.
    expect(await cardsNaColuna(c.saida)).toBe(0);
    expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });
    // E a mesma ideia volta a ser a próxima (RN-18: só concluída ou em andamento bloqueia).
    const detalhe = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect((detalhe.body as RoutineDetail).nextIdea?.id).toBe(ideia);
  });
});

describe("CA-32 / RF-59: cancelar no meio", () => {
  test("cancelada no segundo passo: os seguintes ficam pulado, sem card, e a ideia fica na entrada", async () => {
    const c = await cenario("rotina-cancelar");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia cancelada");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [
        { agentId: escritor.id, mode: "reescreve" },
        { agentId: escritor.id, mode: "reescreve" },
        { agentId: escritor.id, mode: "revisa" },
      ]),
    );
    const { solta, soltar } = trava();
    dublê.roteiro = [
      { tipo: "texto", texto: "primeiro" },
      { tipo: "segura", antes: "segundo pela ", depois: "metade", solta },
    ];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        async () => ({ chamadas: chamadasAoChat(dublê).length, run: await lerRun(c.usuario, runId) }),
        (v) => v.chamadas === 2 && v.run.steps[1]?.status === "rodando",
        "o segundo passo não começou",
      );

      const cancelar = await chamar(app, {
        method: "POST",
        url: `/ai/runs/${runId}/cancel`,
        token: c.usuario.token,
      });
      expect(cancelar.status).toBe(204);

      const run = await esperarFim(c.usuario, runId);
      expect(run).toMatchObject({ status: "cancelada", errorCode: "CANCELADA", outputCardId: null });
      expect(run.steps.map((s) => s.status)).toEqual(["concluido", "falhou", "pulado"]);
      expect(await cardsNaColuna(c.saida)).toBe(0);
      expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });

      // Idempotente: cancelar o que já terminou não muda nada.
      const deNovo = await chamar(app, {
        method: "POST",
        url: `/ai/runs/${runId}/cancel`,
        token: c.usuario.token,
      });
      expect(deNovo.status).toBe(204);
      expect((await lerRun(c.usuario, runId)).status).toBe("cancelada");
    } finally {
      soltar();
    }
  });
});

/**
 * O que o processo anterior deixou gravado ao morrer no primeiro passo — ou o
 * que a instância vizinha está rodando agora, se o pulso for fresco.
 */
async function execucaoSemDono(
  c: Cenario,
  rotina: RoutineDetail,
  ideia: string,
  pulsoHaMs: number,
): Promise<string> {
  const run = await prisma.aiRoutineRun.create({
    data: {
      userId: c.usuario.id,
      routineId: rotina.id,
      routineName: rotina.name,
      inputCardId: ideia,
      inputTitle: "Ideia órfã",
      runCapMicros: 500_000,
      heartbeatAt: new Date(Date.now() - pulsoHaMs),
      steps: {
        create: [
          { position: 0, agentName: "Escritor", mode: "reescreve", status: "rodando" },
          { position: 1, agentName: "Escritor", mode: "revisa" },
        ],
      },
    },
  });
  return run.id;
}

async function rotinaDeDoisPassos(c: Cenario): Promise<RoutineDetail> {
  const escritor = await agentePronto(c.usuario, { name: "Escritor" });
  return rotinaPronta(
    c.usuario,
    corpoDaRotina(c, [
      { agentId: escritor.id, mode: "reescreve" },
      { agentId: escritor.id, mode: "revisa" },
    ]),
  );
}

const MINUTO = 60_000;

describe("CA-33 / RNF-11: execução perdida num reinício", () => {
  test("pulso vencido vira interrompida na reconciliação, e a ideia volta", async () => {
    const c = await cenario("rotina-reconciliar");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia órfã");
    const rotina = await rotinaDeDoisPassos(c);
    const orfa = await execucaoSemDono(c, rotina, ideia, MINUTO);

    expect(await reconciliarExecucoes()).toBeGreaterThanOrEqual(1);

    const run = await lerRun(c.usuario, orfa);
    expect(run).toMatchObject({ status: "interrompida", errorCode: "INTERROMPIDA" });
    expect(run.endedAt).not.toBeNull();
    expect(run.steps.map((s) => s.status)).toEqual(["falhou", "pulado"]);
    const detalhe = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect((detalhe.body as RoutineDetail).nextIdea?.id).toBe(ideia);
    expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });
  });

  test("pulso fresco é execução da instância vizinha: não se reconcilia e conta para RN-19", async () => {
    const c = await cenario("rotina-vizinha");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia da vizinha");
    const rotina = await rotinaDeDoisPassos(c);
    const vizinha = await execucaoSemDono(c, rotina, ideia, 0);

    await reconciliarExecucoes();
    expect((await lerRun(c.usuario, vizinha)).status).toBe("em_andamento");
    const outra = await rodar(c.usuario, rotina.id);
    expect(outra.status).toBe(409);
    expect(codigo(outra.body)).toBe("ROTINA_EM_ANDAMENTO");

    // Cancelar a da vizinha é **pedir**: ela lê o pedido e grava o desfecho.
    const cancelar = await chamar(app, {
      method: "POST",
      url: `/ai/runs/${vizinha}/cancel`,
      token: c.usuario.token,
    });
    expect(cancelar.status).toBe(204);
    const linha = await prisma.aiRoutineRun.findUniqueOrThrow({
      where: { id: vizinha },
      select: { status: true, cancelRequestedAt: true },
    });
    expect(linha.status).toBe("em_andamento");
    expect(linha.cancelRequestedAt).not.toBeNull();

    // Quando o pulso vence, o "Rodar agora" fecha a órfã e segue.
    await prisma.aiRoutineRun.update({
      where: { id: vizinha },
      data: { heartbeatAt: new Date(Date.now() - MINUTO) },
    });
    dublê.roteiro = [
      { tipo: "texto", texto: "rascunho" },
      { tipo: "texto", texto: "- ok" },
    ];
    const nova = await rodarAceito(c.usuario, rotina.id);
    expect((await lerRun(c.usuario, vizinha)).status).toBe("interrompida");
    expect(await esperarFim(c.usuario, nova)).toMatchObject({ status: "concluida" });
  });

  test("RN-16: órfã que já criou o card vira concluida com aviso, e a ideia não volta", async () => {
    const c = await cenario("rotina-orfa-com-card");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia já escrita");
    const rotina = await rotinaDeDoisPassos(c);
    const orfa = await execucaoSemDono(c, rotina, ideia, MINUTO);
    // Morreu entre criar o card e registrá-lo: só a marca aponta a execução.
    const card = await criarCard(c.usuario, c.saida, "Post pronto");
    await prisma.card.update({
      where: { id: card },
      data: { aiGeneratedAt: new Date(), aiVia: "rotina", aiRunId: orfa },
    });

    expect(await reconciliarExecucoes()).toBeGreaterThanOrEqual(1);

    const run = await lerRun(c.usuario, orfa);
    expect(run).toMatchObject({
      status: "concluida",
      errorCode: "FINALIZACAO_PARCIAL",
      outputCardId: card,
    });
    const detalhe = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect((detalhe.body as RoutineDetail).nextIdea).toBeNull();
  });
});

/* -------------------------------------------------------------------- SSE */

/** Os eventos de um corpo `text/event-stream` inteiro. */
const eventosDe = (corpo: string) =>
  corpo
    .split("\n\n")
    .map((bloco) => bloco.trim())
    .filter((bloco) => bloco.startsWith("data: "))
    .map((bloco) => JSON.parse(bloco.slice("data: ".length)) as RotinaEvent);

/**
 * Um assinante pela rede de verdade: lê evento a evento, e fecha quando quiser.
 */
async function assinarPelaRede(usuario: Usuario, runId: string) {
  const fechar = new AbortController();
  const resposta = await fetch(`${base}/ai/runs/${runId}/events`, {
    headers: { authorization: `Bearer ${usuario.token}` },
    signal: fechar.signal,
  });
  expect(resposta.status).toBe(200);
  const leitor = (resposta.body as ReadableStream<Uint8Array>).getReader();
  const decodificador = new TextDecoder();
  let sobra = "";
  const fila: RotinaEvent[] = [];

  async function proximo(): Promise<RotinaEvent | null> {
    while (fila.length === 0) {
      const { done, value } = await leitor.read();
      if (done) return null;
      sobra += decodificador.decode(value, { stream: true });
      const blocos = sobra.split("\n\n");
      sobra = blocos.pop() ?? "";
      fila.push(...eventosDe(blocos.map((b) => `${b}\n\n`).join("")));
    }
    return fila.shift() ?? null;
  }

  return {
    proximo,
    fechar: async () => {
      fechar.abort();
      await leitor.cancel().catch(() => undefined);
    },
  };
}

describe("RF-58 / RNF-11: a tela acompanha pelo SSE e pode entrar a qualquer hora", () => {
  test("entrar numa execução terminada dá o retrato e o fim, e fecha", async () => {
    const c = await cenario("rotina-sse-fim");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    dublê.roteiro = [{ tipo: "texto", texto: "pronto" }];
    const runId = await rodarAceito(c.usuario, rotina.id);
    await esperarFim(c.usuario, runId);

    const resposta = await app.inject({
      method: "GET",
      url: `/ai/runs/${runId}/events`,
      headers: { authorization: `Bearer ${c.usuario.token}` },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toContain("text/event-stream");
    const eventos = eventosDe(resposta.body);
    expect(eventos.map((e) => e.tipo)).toEqual(["retrato", "fim"]);
    const [retrato, fim] = eventos;
    expect(retrato).toMatchObject({ tipo: "retrato", parcial: null, run: { status: "concluida" } });
    expect(fim).toMatchObject({ tipo: "fim", run: { id: runId, status: "concluida" } });
  });

  test("entrar no meio dá o retrato com o texto parcial, e os deltas seguintes não o repetem", async () => {
    const c = await cenario("rotina-sse-meio");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    const { solta, soltar } = trava();
    dublê.roteiro = [
      { tipo: "segura", antes: "PARCIAL-JA-CHEGOU ", depois: "E-O-RESTO-DEPOIS", solta },
    ];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);

      // Reentra até o parcial aparecer — o delta pode ainda estar a caminho.
      let assinante = await assinarPelaRede(c.usuario, runId);
      let retrato = await assinante.proximo();
      const limite = Date.now() + 10_000;
      while (retrato?.tipo !== "retrato" || retrato.parcial !== "PARCIAL-JA-CHEGOU ") {
        await assinante.fechar();
        if (Date.now() > limite) throw new Error(`parcial não chegou: ${JSON.stringify(retrato)}`);
        await new Promise((r) => setTimeout(r, 20));
        assinante = await assinarPelaRede(c.usuario, runId);
        retrato = await assinante.proximo();
      }
      expect(retrato.run.status).toBe("em_andamento");
      expect(retrato.run.steps[0]?.status).toBe("rodando");

      soltar();
      const seguintes: RotinaEvent[] = [];
      for (let e = await assinante.proximo(); e; e = await assinante.proximo()) {
        seguintes.push(e);
        if (e.tipo === "fim") break;
      }
      await assinante.fechar();

      const deltas = seguintes
        .filter((e): e is Extract<RotinaEvent, { tipo: "delta" }> => e.tipo === "delta")
        .map((e) => e.texto)
        .join("");
      // O parcial mais o que veio depois é o texto inteiro, uma vez só.
      expect(`${retrato.parcial}${deltas}`).toBe("PARCIAL-JA-CHEGOU E-O-RESTO-DEPOIS");
      expect(seguintes.at(-1)).toMatchObject({ tipo: "fim", run: { status: "concluida" } });
      const run = await lerRun(c.usuario, runId);
      expect(run.steps[0]?.text).toBe("PARCIAL-JA-CHEGOU E-O-RESTO-DEPOIS");
    } finally {
      soltar();
    }
  });
});

describe("o SSE não deixa assinante para trás", () => {
  test("fechado antes do primeiro evento não inscreve; fechado depois, desinscreve", async () => {
    const c = await cenario("rotina-sse-assinante");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "meio ", depois: "fim", solta }];
    const fechou = new AbortController();

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        async () => chamadasAoChat(dublê).length,
        (n) => n === 1,
        "o passo não chegou ao provedor",
      );

      // O que a rota faz quando o cliente fecha durante a posse: o gerador
      // volta e o `Readable.from` é destruído sem puxá-lo. Nada ficou inscrito.
      const descartado = await assinar(c.usuario.id, runId, fechou.signal);
      expect(assinantesDe(runId)).toBe(0);

      // O que começa se inscreve, e o `return` do fechamento o tira.
      const lido = await assinar(c.usuario.id, runId, fechou.signal);
      const primeiro = await lido.next();
      expect(primeiro.value).toMatchObject({ tipo: "retrato" });
      expect(assinantesDe(runId)).toBe(1);
      await lido.return(undefined);
      expect(assinantesDe(runId)).toBe(0);

      // O descartado que começa depois de a execução acabar — o `null` do fim
      // já foi dado — não espera um aviso que não vem: sai pelo relido.
      soltar();
      await esperarFim(c.usuario, runId);
      await esperar(async () => assinantesDe(runId), (n) => n === null, "a execução não saiu do Map");
      const eventos: RotinaEvent[] = [];
      const relogio = setTimeout(() => fechou.abort(), 5_000);
      for await (const e of descartado) if (e !== "ping") eventos.push(e);
      clearTimeout(relogio);
      expect(fechou.signal.aborted).toBe(false);
      expect(eventos.map((e) => e.tipo)).toEqual(["retrato", "fim"]);
      expect(eventos.at(-1)).toMatchObject({ tipo: "fim", run: { status: "concluida" } });
    } finally {
      soltar();
      fechou.abort();
    }
  });
});

/* ------------------------------------------------------- validade e posse */

describe("rotina inválida só recusa ao rodar", () => {
  test("agente excluído deixa a rotina aberta no editor e faz o início ser 422 ROTINA_INVALIDA", async () => {
    const c = await cenario("rotina-agente-excluido");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    const exclusao = await chamar(app, {
      method: "DELETE",
      url: `/ai/agents/${escritor.id}`,
      token: c.usuario.token,
    });
    expect(exclusao.status).toBe(204);

    const detalhe = await chamar(app, {
      method: "GET",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect(detalhe.status).toBe(200);
    expect(detalhe.body).toMatchObject({
      valid: false,
      steps: [{ agentId: null, agentName: "Escritor" }],
      problems: [{ block: "passo", position: 0 }],
    });
    const lista = await chamar(app, { method: "GET", url: "/ai/routines", token: c.usuario.token });
    expect((lista.body as RoutineSummary[])[0]?.valid).toBe(false);

    const r = await rodar(c.usuario, rotina.id);

    expect(r.status).toBe(422);
    expect(codigo(r.body)).toBe("ROTINA_INVALIDA");
    expect(await prisma.aiRoutineRun.count({ where: { userId: c.usuario.id } })).toBe(0);
    expect(chamadasAoChat(dublê)).toHaveLength(0);
  });

  test("INV-02: execução de outra conta é 404 no detalhe, no SSE e no cancelamento — e segue rodando", async () => {
    const c = await cenario("rotina-run-dona");
    const intruso = await comChat("rotina-run-intrusa");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: escritor.id, mode: "reescreve" }]),
    );
    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "a ", depois: "b", solta }];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        async () => chamadasAoChat(dublê).length,
        (n) => n === 1,
        "o passo não chegou ao provedor",
      );

      for (const [method, sufixo] of [
        ["GET", ""],
        ["GET", "/events"],
        ["POST", "/cancel"],
      ] as const) {
        const alheia = await chamar(app, {
          method,
          url: `/ai/runs/${runId}${sufixo}`,
          token: intruso.token,
        });
        const nenhuma = await chamar(app, {
          method,
          url: `/ai/runs/${INEXISTENTE}${sufixo}`,
          token: intruso.token,
        });
        expect(alheia.status, `${method} ${sufixo}`).toBe(404);
        expect(alheia.body).toEqual(nenhuma.body);
      }

      // O cancelamento alheio não teve efeito: a execução termina normalmente.
      soltar();
      expect((await esperarFim(c.usuario, runId)).status).toBe("concluida");
    } finally {
      soltar();
    }
  });
});

/* ------------------------------------------------------------------ custo */

describe("INV-50 / INV-51: o gasto da rotina fica registrado e sobrevive à rotina", () => {
  test("cada chamada grava AiUsage com task 'rotina' e o runId; excluir a rotina não apaga histórico nem gasto do dia", async () => {
    const c = await cenario("rotina-uso");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const escritor = await agentePronto(c.usuario, { name: "Escritor" });
    const revisor = await agentePronto(c.usuario, { name: "Revisor" });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [
        { agentId: escritor.id, mode: "reescreve" },
        { agentId: revisor.id, mode: "revisa" },
      ]),
    );
    dublê.roteiro = [
      { tipo: "texto", texto: "rascunho", custoMicros: 1_200 },
      { tipo: "texto", texto: "observação", custoMicros: 800 },
    ];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));
    expect(run.status).toBe("concluida");

    const usos = await prisma.aiUsage.findMany({
      where: { userId: c.usuario.id },
      orderBy: { createdAt: "asc" },
    });
    expect(usos.map((u) => [u.task, u.runId, u.conversationId, u.costMicros, u.ok])).toEqual([
      ["rotina", run.id, null, 1_200, true],
      ["rotina", run.id, null, 800, true],
    ]);
    const lerGasto = async () =>
      (
        (await chamar(app, { method: "GET", url: "/ai/settings", token: c.usuario.token }))
          .body as AiSettings
      ).usage.spentMicros;
    expect(await lerGasto()).toBe(2_000);

    const exclusao = await chamar(app, {
      method: "DELETE",
      url: `/ai/routines/${rotina.id}`,
      token: c.usuario.token,
    });
    expect(exclusao.status).toBe(204);

    const depois = await lerRun(c.usuario, run.id);
    expect(depois).toMatchObject({ routineId: null, routineName: "Post do LinkedIn" });
    expect(depois.steps).toHaveLength(2);
    expect(await prisma.aiUsage.count({ where: { runId: run.id } })).toBe(2);
    expect(await lerGasto()).toBe(2_000);
    // A marca do card não depende da rotina gravada.
    const card = await chamar(app, {
      method: "GET",
      url: `/cards/${run.outputCardId}`,
      token: c.usuario.token,
    });
    expect((card.body as CardDetail).ai).toMatchObject({ routineName: "Post do LinkedIn", runId: run.id });
  });
});

/* ------------------------------------------------------------- escrita */

/// Derivado de shared, não enumerado à mão: ferramenta de escrita nova entra
/// aqui sozinha.
const DE_ESCRITA = (Object.keys(FERRAMENTAS_DO_ACERVO) as NomeDeFerramenta[]).filter(
  (nome) => FERRAMENTAS_DO_ACERVO[nome].escrita,
);

describe("CA-34 / RN-16: a rotina escreve pelo código, não pelo modelo", () => {
  test("agente com create_card e create_note: o passo só oferece a leitura, e o pedido de escrita é recusado", async () => {
    const c = await cenario("rotina-sem-escrita");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const agente = await agentePronto(c.usuario, {
      name: "Escritor que cria",
      tools: ["search_notes", "create_card", "create_note"],
    });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: agente.id, mode: "reescreve" }]),
    );
    dublê.roteiro = [
      {
        tipo: "ferramenta",
        nome: "create_card",
        argumentos: JSON.stringify({ columnId: c.saida, title: "Card pelo modelo" }),
      },
      { tipo: "texto", texto: "rascunho sem escrever" },
    ];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect(DE_ESCRITA.length).toBeGreaterThan(0);
    expect(run.status).toBe("concluida");
    for (const corpo of pedidos()) {
      const oferecidas = (corpo.tools ?? []).map((t) => t.function.name);
      expect(oferecidas).toEqual(["search_notes"]);
      for (const nome of DE_ESCRITA) expect(oferecidas).not.toContain(nome);
    }
    // O pedido do modelo voltou como erro, e o único card novo é o do código.
    const resposta = pedidos()[1]?.messages.find((m) => m.role === "tool")?.content ?? "";
    expect(resposta).toContain("create_card");
    expect(await prisma.card.count({ where: { title: "Card pelo modelo" } })).toBe(0);
    expect(await cardsNaColuna(c.saida)).toBe(1);
  });

  test("agente só com ferramenta de escrita: o pedido sai sem o campo tools", async () => {
    const c = await cenario("rotina-so-escrita");
    await criarCard(c.usuario, c.entrada, "Ideia");
    const agente = await agentePronto(c.usuario, { name: "Só cria", tools: ["create_card"] });
    const rotina = await rotinaPronta(
      c.usuario,
      corpoDaRotina(c, [{ agentId: agente.id, mode: "reescreve" }]),
    );
    dublê.roteiro = [{ tipo: "texto", texto: "rascunho" }];

    const run = await esperarFim(c.usuario, await rodarAceito(c.usuario, rotina.id));

    expect(run.status).toBe("concluida");
    expect(pedidos()).toHaveLength(1);
    expect(pedidos()[0]).not.toHaveProperty("tools");
  });
});

/* --------------------------------------------------- duas instâncias no ar */

describe("RNF-11: duas instâncias na janela de deploy", () => {
  test("o SSE de uma execução da vizinha manda retratos do banco, sem delta, e o fim relido", async () => {
    const c = await cenario("rotina-sse-vizinha");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia da vizinha");
    const rotina = await rotinaDeDoisPassos(c);
    const vizinha = await execucaoSemDono(c, rotina, ideia, 0);

    const assinante = await assinarPelaRede(c.usuario, vizinha);
    try {
      const primeiro = await assinante.proximo();
      expect(primeiro).toMatchObject({
        tipo: "retrato",
        parcial: null,
        run: { status: "em_andamento" },
      });

      // A vizinha grava o passo: o próximo retrato o traz.
      await prisma.aiRoutineRunStep.update({
        where: { runId_position: { runId: vizinha, position: 0 } },
        data: { status: "concluido", text: "feito lá" },
      });
      const segundo = await assinante.proximo();
      expect(segundo?.tipo).toBe("retrato");
      if (segundo?.tipo !== "retrato") throw new Error("esperava retrato");
      expect(segundo.run.steps[0]).toMatchObject({ status: "concluido", text: "feito lá" });

      await prisma.aiRoutineRun.update({
        where: { id: vizinha },
        data: { status: "cancelada", endedAt: new Date() },
      });
      const eventos: RotinaEvent[] = [];
      for (let e = await assinante.proximo(); e; e = await assinante.proximo()) {
        eventos.push(e);
        if (e.tipo === "fim") break;
      }
      expect(eventos.some((e) => e.tipo === "delta")).toBe(false);
      expect(eventos.at(-1)).toMatchObject({ tipo: "fim", run: { status: "cancelada" } });
    } finally {
      await assinante.fechar();
    }
  });

  test("a vizinha encerrou a execução no meio: este processo não sobrescreve, nem cria card", async () => {
    const c = await cenario("rotina-perdida");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia disputada");
    const rotina = await rotinaDeDoisPassos(c);
    const { solta, soltar } = trava();
    dublê.roteiro = [{ tipo: "segura", antes: "meio ", depois: "fim", solta }];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        () => lerRun(c.usuario, runId),
        (r) => r.steps[0]?.status === "rodando",
        "o primeiro passo não começou",
      );
      const assinante = await assinarPelaRede(c.usuario, runId);
      expect((await assinante.proximo())?.tipo).toBe("retrato");

      // O que a reconciliação da outra instância gravaria.
      await prisma.aiRoutineRun.update({
        where: { id: runId },
        data: { status: "interrompida", errorCode: "INTERROMPIDA", endedAt: new Date() },
      });
      soltar();

      const eventos: RotinaEvent[] = [];
      for (let e = await assinante.proximo(); e; e = await assinante.proximo()) {
        eventos.push(e);
        if (e.tipo === "fim") break;
      }
      await assinante.fechar();
      expect(eventos.at(-1)).toMatchObject({ tipo: "fim", run: { status: "interrompida" } });
      expect(eventos.some((e) => e.tipo === "erro")).toBe(false);

      const run = await lerRun(c.usuario, runId);
      expect(run).toMatchObject({ status: "interrompida", outputCardId: null });
      expect(run.steps[0]?.status).toBe("rodando");
      expect(await cardsNaColuna(c.saida)).toBe(0);
      expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });
    } finally {
      soltar();
    }
  });

  test("cancelamento pedido por outra instância: quem executa o lê antes do passo seguinte", async () => {
    const c = await cenario("rotina-cancelar-vizinha");
    const ideia = await criarCard(c.usuario, c.entrada, "Ideia cancelada de longe");
    const rotina = await rotinaDeDoisPassos(c);
    const { solta, soltar } = trava();
    dublê.roteiro = [
      { tipo: "segura", antes: "primeiro ", depois: "passo", solta },
      { tipo: "texto", texto: "- nunca" },
    ];

    try {
      const runId = await rodarAceito(c.usuario, rotina.id);
      await esperar(
        () => lerRun(c.usuario, runId),
        (r) => r.steps[0]?.status === "rodando",
        "o primeiro passo não começou",
      );
      // O que `POST /cancel` grava quando cai na instância que não executa.
      await prisma.aiRoutineRun.update({
        where: { id: runId },
        data: { cancelRequestedAt: new Date() },
      });
      soltar();

      const run = await esperarFim(c.usuario, runId);
      expect(run).toMatchObject({ status: "cancelada", errorCode: "CANCELADA", outputCardId: null });
      expect(run.steps.map((s) => s.status)).toEqual(["concluido", "pulado"]);
      expect(chamadasAoChat(dublê)).toHaveLength(1);
      expect(await cardNoBanco(ideia)).toEqual({ columnId: c.entrada, archived: false });
    } finally {
      soltar();
    }
  });
});
