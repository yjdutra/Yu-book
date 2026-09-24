import { MAX_FONTES_VIVAS, MAX_NOTAS_BASE, MAX_PREMISSAS_DO_AGENTE } from "@yu-book/shared";
import type {
  AgentDetail,
  AgentPreview,
  AgentSummary,
  BoardDetail,
  CardDetail,
  ChatEvent,
  Conversation,
  ConversationDetail,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";
import { chamadasAoChat, subirProvedor } from "./provedor.js";
import type { Dublê } from "./provedor.js";

/**
 * Agentes especialistas — Etapa D da frente de IA, §5.6 de
 * `docs/prd-ia-no-yu-book.md`, CA-23 a CA-28.
 *
 * O que esta suíte protege, em uma frase: **um agente é o chat com premissas,
 * e nada além do que o usuário deu a ele.** As premissas são dele (RN-15), as
 * ferramentas são as que a lista concede e não as que o texto pede (RN-14), as
 * regras do Yu-book vêm antes das instruções (RN-13), e o que não coube no
 * contexto é declarado, nunca calado (RNF-04).
 *
 * O provedor é o dublê de `tests/provedor.ts`, o mesmo de `chat.test.ts`.
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

/** Um favorito gravado como a tela de ajustes gravaria, com preço opcional. */
async function favoritar(
  usuario: Usuario,
  modelId: string,
  opcoes: { promptMicros?: number; completionMicros?: number; supportsTools?: boolean } = {},
): Promise<void> {
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId,
      name: `Nome de ${modelId}`,
      contextLength: 128_000,
      promptMicros: opcoes.promptMicros ?? 0,
      completionMicros: opcoes.completionMicros ?? 0,
      supportsTools: opcoes.supportsTools ?? true,
    },
  });
}

/** Um usuário pronto para conversar: favorito gratuito escolhido para `chat`. */
async function comChat(apelido: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await favoritar(usuario, "estudio/conversa");
  await prisma.aiTaskModel.create({
    data: { userId: usuario.id, task: "chat", modelId: "estudio/conversa" },
  });
  return usuario;
}

async function criarNota(
  usuario: Usuario,
  title: string,
  contentMd: string,
  deletedAt: Date | null = null,
): Promise<string> {
  const nota = await prisma.note.create({
    data: { userId: usuario.id, title, kind: "livre", contentMd, deletedAt },
  });
  return nota.id;
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

async function criarCard(usuario: Usuario, columnId: string, title: string): Promise<void> {
  const { status } = await chamar(app, {
    method: "POST",
    url: "/cards",
    token: usuario.token,
    body: { columnId, title },
  });
  expect(status).toBe(201);
}

const criarAgente = (usuario: Usuario, corpo: Record<string, unknown>) =>
  chamar(app, { method: "POST", url: "/ai/agents", token: usuario.token, body: corpo });

const previa = (usuario: Usuario, corpo: Record<string, unknown>) =>
  chamar(app, { method: "POST", url: "/ai/agents/preview", token: usuario.token, body: corpo });

async function agentePronto(usuario: Usuario, corpo: Record<string, unknown>): Promise<AgentDetail> {
  const { status, body } = await criarAgente(usuario, corpo);
  expect(status).toBe(201);
  return body as AgentDetail;
}

async function conversaCom(usuario: Usuario, agentId?: string): Promise<Conversation> {
  const { status, body } = await chamar(app, {
    method: "POST",
    url: "/ai/conversations",
    token: usuario.token,
    body: { title: "Conversa", ...(agentId !== undefined && { agentId }) },
  });
  expect(status).toBe(201);
  return body as Conversation;
}

interface Resultado {
  status: number;
  eventos: ChatEvent[];
}

/// Um IP por chamada: a rota de mensagem tem limite próprio de 10/min por IP,
/// e `app.inject` usa sempre o mesmo endereço (ver `apoio.ts`).
let proximoIp = 0;

async function enviar(usuario: Usuario, conversationId: string, content: string): Promise<Resultado> {
  const resposta = await app.inject({
    method: "POST",
    url: `/ai/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${usuario.token}` },
    remoteAddress: `10.1.0.${(proximoIp += 1) % 250}`,
    payload: { content },
  });

  if (resposta.headers["content-type"]?.toString().includes("event-stream") !== true) {
    return { status: resposta.statusCode, eventos: [] };
  }

  const eventos = resposta.body
    .split("\n\n")
    .map((bloco) => bloco.replace(/^data: /, "").trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => JSON.parse(linha) as ChatEvent);
  return { status: resposta.statusCode, eventos };
}

interface CorpoDoPedido {
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
}

const ultimoPedido = () => dublê.corpos.at(-1) as unknown as CorpoDoPedido;

/** A mensagem `system` do último pedido que chegou ao provedor. */
const sistemaEnviado = () =>
  ultimoPedido().messages.find((m) => m.role === "system")?.content ?? "";

/** Uma nota que ocupa sozinha bem mais da metade do limite de premissas. */
const METADE_E_TANTO = "x".repeat(Math.ceil(MAX_PREMISSAS_DO_AGENTE * 0.6));

/* ------------------------------------------------------------------- CRUD */

describe("RF-43: o agente é do usuário, e só dele", () => {
  test("criar devolve o detalhe com as notas-base na ordem dada, e o detalhe relido é o mesmo", async () => {
    const usuario = await criarUsuario("agente-criar");
    const segunda = await criarNota(usuario, "Segunda premissa", "b");
    const primeira = await criarNota(usuario, "Primeira premissa", "a");

    const { status, body } = await criarAgente(usuario, {
      name: "Revisor",
      instructionsMd: "Revise com cuidado.",
      tools: ["search_notes", "get_note"],
      baseNoteIds: [primeira, segunda],
    });

    expect(status).toBe(201);
    const criado = body as AgentDetail;
    expect(criado).toMatchObject({
      name: "Revisor",
      color: "violeta",
      modelId: null,
      instructionsMd: "Revise com cuidado.",
      tools: ["search_notes", "get_note"],
      toolCount: 2,
      writes: false,
      baseNoteTitles: ["Primeira premissa", "Segunda premissa"],
    });
    expect(criado.baseNotes.map((n) => n.id)).toEqual([primeira, segunda]);

    const relido = await chamar(app, {
      method: "GET",
      url: `/ai/agents/${criado.id}`,
      token: usuario.token,
    });
    expect(relido.status).toBe(200);
    expect(relido.body).toEqual(criado);
  });

  test("a lista vem em ordem de nome, qualquer que tenha sido a ordem de criação", async () => {
    const usuario = await criarUsuario("agente-listar");
    for (const name of ["Marketing", "Anotador", "Revisor"]) await agentePronto(usuario, { name });

    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/agents",
      token: usuario.token,
    });

    expect(status).toBe(200);
    expect((body as AgentSummary[]).map((a) => a.name)).toEqual(["Anotador", "Marketing", "Revisor"]);
  });

  test("editar as notas-base substitui a lista inteira, e a ordem nova é a que vale", async () => {
    const usuario = await criarUsuario("agente-patch");
    const a = await criarNota(usuario, "Nota A", "a");
    const b = await criarNota(usuario, "Nota B", "b");
    const c = await criarNota(usuario, "Nota C", "c");
    const agente = await agentePronto(usuario, { name: "Editável", baseNoteIds: [a, b] });

    const { status, body } = await chamar(app, {
      method: "PATCH",
      url: `/ai/agents/${agente.id}`,
      token: usuario.token,
      body: { baseNoteIds: [c, a] },
    });

    expect(status).toBe(200);
    // B saiu, C entrou, e C vem antes de A: nada da lista antiga sobra.
    expect((body as AgentDetail).baseNotes.map((n) => n.id)).toEqual([c, a]);
    // O resto do agente não é tocado por um patch só de notas.
    expect((body as AgentDetail).name).toBe("Editável");
  });

  test("excluir responde 204, e o agente deixa de existir", async () => {
    const usuario = await criarUsuario("agente-excluir");
    const agente = await agentePronto(usuario, { name: "Passageiro" });

    const excluido = await chamar(app, {
      method: "DELETE",
      url: `/ai/agents/${agente.id}`,
      token: usuario.token,
    });
    expect(excluido.status).toBe(204);

    const depois = await chamar(app, {
      method: "GET",
      url: `/ai/agents/${agente.id}`,
      token: usuario.token,
    });
    expect(depois.status).toBe(404);
  });

  test("nome repetido na mesma conta é 409 NOME_DUPLICADO, ao criar e ao renomear", async () => {
    const usuario = await criarUsuario("agente-nome");
    await agentePronto(usuario, { name: "Único" });
    const outro = await agentePronto(usuario, { name: "Outro" });

    const criando = await criarAgente(usuario, { name: "Único" });
    expect(criando.status).toBe(409);
    expect(codigo(criando.body)).toBe("NOME_DUPLICADO");

    const renomeando = await chamar(app, {
      method: "PATCH",
      url: `/ai/agents/${outro.id}`,
      token: usuario.token,
      body: { name: "Único" },
    });
    expect(renomeando.status).toBe(409);
    expect(codigo(renomeando.body)).toBe("NOME_DUPLICADO");
  });

  test("o mesmo nome em outra conta não colide: a unicidade é por usuário", async () => {
    const um = await criarUsuario("agente-nome-um");
    const outro = await criarUsuario("agente-nome-outro");
    await agentePronto(um, { name: "Especialista" });

    const { status } = await criarAgente(outro, { name: "Especialista" });
    expect(status).toBe(201);
  });

  test("INV-02: agente de outra conta é 404 em ler, editar, excluir e exportar — igual ao inexistente", async () => {
    const dono = await criarUsuario("agente-dono");
    const intruso = await criarUsuario("agente-intruso");
    const agente = await agentePronto(dono, { name: "Privado", instructionsMd: "segredo" });
    const inexistente = crypto.randomUUID();

    const tentativas = [
      { method: "GET" as const, sufixo: "" },
      { method: "PATCH" as const, sufixo: "", body: { name: "Tomado" } },
      { method: "DELETE" as const, sufixo: "" },
      { method: "GET" as const, sufixo: "/export" },
    ];

    for (const t of tentativas) {
      const alheio = await chamar(app, {
        method: t.method,
        url: `/ai/agents/${agente.id}${t.sufixo}`,
        token: intruso.token,
        ...(t.body && { body: t.body }),
      });
      const nenhum = await chamar(app, {
        method: t.method,
        url: `/ai/agents/${inexistente}${t.sufixo}`,
        token: intruso.token,
        ...(t.body && { body: t.body }),
      });
      expect(alheio.status, `${t.method} ${t.sufixo}`).toBe(404);
      // Mesmo corpo: nada na resposta distingue "existe, mas não é seu".
      expect(alheio.body).toEqual(nenhum.body);
    }

    // E nenhuma das tentativas mudou o agente do dono.
    const intacto = await prisma.aiAgent.findUnique({ where: { id: agente.id } });
    expect(intacto?.name).toBe("Privado");
  });
});

/* ----------------------------------------------------------------- RN-15 */

describe("RN-15 / CA-25: premissa de outra conta não existe", () => {
  test("nota-base de outra conta é 404 igual à inexistente, ao criar e na prévia, e nada é gravado", async () => {
    const dono = await criarUsuario("premissa-dono");
    const intruso = await criarUsuario("premissa-intruso");
    const alheia = await criarNota(dono, "Nota do dono", "conteúdo privado do dono");
    const inexistente = crypto.randomUUID();

    for (const enviarRascunho of [criarAgente, previa]) {
      const comAlheia = await enviarRascunho(intruso, { name: "Ladrão", baseNoteIds: [alheia] });
      const comNenhuma = await enviarRascunho(intruso, {
        name: "Ladrão",
        baseNoteIds: [inexistente],
      });
      expect(comAlheia.status).toBe(404);
      expect(comAlheia.body).toEqual(comNenhuma.body);
      // O corpo da nota alheia não vaza por mensagem de erro nem por prévia.
      expect(JSON.stringify(comAlheia.body)).not.toContain("privado");
    }

    expect(await prisma.aiAgent.count({ where: { userId: intruso.id } })).toBe(0);
  });

  test("editar um agente para apontar para nota de outra conta também é 404, e a lista antiga fica", async () => {
    const dono = await criarUsuario("premissa-patch-dono");
    const intruso = await criarUsuario("premissa-patch-intruso");
    const alheia = await criarNota(dono, "Alheia", "x");
    const propria = await criarNota(intruso, "Própria", "y");
    const agente = await agentePronto(intruso, { name: "Meu", baseNoteIds: [propria] });

    const { status } = await chamar(app, {
      method: "PATCH",
      url: `/ai/agents/${agente.id}`,
      token: intruso.token,
      body: { baseNoteIds: [propria, alheia] },
    });
    expect(status).toBe(404);

    const ligadas = await prisma.aiAgentBaseNote.findMany({ where: { agentId: agente.id } });
    expect(ligadas.map((l) => l.noteId)).toEqual([propria]);
  });

  test("coluna de outra conta é 404 igual à inexistente ao criar, e nada é gravado", async () => {
    const dono = await criarUsuario("fonte-dono");
    const intruso = await criarUsuario("fonte-intruso");
    const quadro = await criarQuadro(dono, "Publicados do dono");
    const fonte = (columnId: string, boardId: string) => ({
      name: "Espião",
      liveSources: [{ tipo: "coluna", boardId, columnId }],
    });

    const alheia = await criarAgente(intruso, fonte(colunaDe(quadro, 0), quadro.id));
    const nenhuma = await criarAgente(intruso, fonte(crypto.randomUUID(), crypto.randomUUID()));
    expect(alheia.status).toBe(404);
    expect(alheia.body).toEqual(nenhuma.body);

    expect(await prisma.aiAgent.count({ where: { userId: intruso.id } })).toBe(0);
  });

  test("na prévia, coluna de outra conta é indisponível igual à inexistente, e nada dela vaza", async () => {
    // A prévia não confere fonte viva (é o editor reabrindo um agente cuja
    // coluna pode ter sumido); a alheia precisa sair igual à inexistente,
    // sem nome de quadro, de coluna nem card do dono.
    const dono = await criarUsuario("fonte-previa-dono");
    const intruso = await criarUsuario("fonte-previa-intruso");
    const quadro = await criarQuadro(dono, "QUADRO-SECRETO-DO-DONO");
    await criarCard(dono, colunaDe(quadro, 0), "CARD-SECRETO-DO-DONO");
    const fonte = (columnId: string, boardId: string) => ({
      name: "Espião",
      liveSources: [{ tipo: "coluna", boardId, columnId }],
    });

    const alheia = await previa(intruso, fonte(colunaDe(quadro, 0), quadro.id));
    const nenhuma = await previa(intruso, fonte(crypto.randomUUID(), crypto.randomUUID()));

    expect(alheia.status).toBe(200);
    expect(nenhuma.status).toBe(200);
    const p = alheia.body as AgentPreview;
    expect(p.blocks.find((b) => b.kind === "fonte")?.status).toBe("indisponivel");
    expect(p.blocks).toEqual((nenhuma.body as AgentPreview).blocks);
    expect(p.warnings).toEqual((nenhuma.body as AgentPreview).warnings);
    const texto = JSON.stringify(alheia.body);
    for (const segredo of ["QUADRO-SECRETO-DO-DONO", "CARD-SECRETO-DO-DONO"]) {
      expect(texto).not.toContain(segredo);
    }
    const nomeDaColuna = quadro.columns[0]?.name ?? "";
    expect(nomeDaColuna).not.toBe("");
    expect(p.system).not.toContain(nomeDaColuna);
    expect(p.blocks.map((b) => b.title).join("|")).not.toContain(nomeDaColuna);
    expect(await prisma.aiAgent.count({ where: { userId: intruso.id } })).toBe(0);
  });

  test("INV-03: coluna própria declarada sob outro quadro próprio é 404 ao criar e indisponível na prévia", async () => {
    const usuario = await criarUsuario("fonte-cadeia");
    const um = await criarQuadro(usuario, "Quadro um");
    const dois = await criarQuadro(usuario, "Quadro dois");
    await criarCard(usuario, colunaDe(um, 0), "Card do quadro um");

    const corpo = {
      name: "Cruzado",
      liveSources: [{ tipo: "coluna", boardId: dois.id, columnId: colunaDe(um, 0) }],
    };
    expect((await criarAgente(usuario, corpo)).status).toBe(404);

    const { status, body } = await previa(usuario, corpo);
    expect(status).toBe(200);
    const p = body as AgentPreview;
    expect(p.blocks.find((b) => b.kind === "fonte")?.status).toBe("indisponivel");
    expect(p.system).not.toContain("Card do quadro um");
  });

  test("PATCH que reenvia a fonte cuja coluna foi excluída salva: o gravado não é conferido de novo", async () => {
    // O editor manda a lista inteira. Conferir o que já estava gravado
    // travaria o agente até o usuário tirar a fonte.
    const usuario = await criarUsuario("fonte-patch-excluida");
    const quadro = await criarQuadro(usuario, "Some depois");
    const coluna = colunaDe(quadro, 1);
    const fontes = [{ tipo: "coluna", boardId: quadro.id, columnId: coluna }];
    const agente = await agentePronto(usuario, { name: "Teimoso", liveSources: fontes });
    await prisma.boardColumn.delete({ where: { id: coluna } });

    const { status, body } = await chamar(app, {
      method: "PATCH",
      url: `/ai/agents/${agente.id}`,
      token: usuario.token,
      body: { name: "Teimoso renomeado", liveSources: fontes },
    });

    expect(status).toBe(200);
    const detalhe = body as AgentDetail;
    expect(detalhe.name).toBe("Teimoso renomeado");
    expect(detalhe.liveSources[0]?.columnId).toBe(coluna);
    expect(detalhe.liveSources[0]?.columnName).toBeNull();
  });

  test("PATCH que acrescenta coluna de outra conta é 404, e as fontes antigas ficam", async () => {
    const dono = await criarUsuario("fonte-patch-dono");
    const intruso = await criarUsuario("fonte-patch-intruso");
    const alheio = await criarQuadro(dono, "Do dono");
    const proprio = await criarQuadro(intruso, "Do intruso");
    const antiga = { tipo: "coluna", boardId: proprio.id, columnId: colunaDe(proprio, 0) };
    const agente = await agentePronto(intruso, { name: "Guloso", liveSources: [antiga] });

    const { status } = await chamar(app, {
      method: "PATCH",
      url: `/ai/agents/${agente.id}`,
      token: intruso.token,
      body: {
        liveSources: [antiga, { tipo: "coluna", boardId: alheio.id, columnId: colunaDe(alheio, 0) }],
      },
    });
    expect(status).toBe(404);

    const gravado = await prisma.aiAgent.findUniqueOrThrow({ where: { id: agente.id } });
    expect((gravado.liveSources as { columnId: string }[]).map((f) => f.columnId)).toEqual([
      colunaDe(proprio, 0),
    ]);
  });
});

/* ------------------------------------------------------------- validação */

describe("RN-14: só a lista concede, e a lista cabe no chat", () => {
  test("ferramenta que o chat não oferece é 422, ao criar e na prévia", async () => {
    const usuario = await criarUsuario("ferramenta-fora");

    for (const fora of ["move_card", "trash_note"]) {
      const criando = await criarAgente(usuario, { name: `Com ${fora}`, tools: [fora] });
      expect(criando.status, fora).toBe(422);
      expect(codigo(criando.body)).toBe("VALIDATION_ERROR");

      const previsto = await previa(usuario, { name: "Rascunho", tools: [fora] });
      expect(previsto.status, fora).toBe(422);
    }

    expect(await prisma.aiAgent.count({ where: { userId: usuario.id } })).toBe(0);
  });

  test("mais notas-base ou mais fontes vivas que o limite é 422", async () => {
    const usuario = await criarUsuario("limites");
    const notas = Array.from({ length: MAX_NOTAS_BASE + 1 }, () => crypto.randomUUID());
    const fontes = Array.from({ length: MAX_FONTES_VIVAS + 1 }, () => ({
      tipo: "coluna",
      boardId: crypto.randomUUID(),
      columnId: crypto.randomUUID(),
    }));

    // Ids que nem existem: o 422 do schema vem antes de qualquer consulta de
    // posse, e é ele que se afirma aqui.
    const muitasNotas = await criarAgente(usuario, { name: "Notas", baseNoteIds: notas });
    expect(muitasNotas.status).toBe(422);
    const muitasFontes = await criarAgente(usuario, { name: "Fontes", liveSources: fontes });
    expect(muitasFontes.status).toBe(422);
  });
});

/* ----------------------------------------------------------------- prévia */

describe("CA-26 / RF-48: a prévia mostra o que o agente recebe", () => {
  test("a nota que não cabe no limite sai cortada por inteiro, e a menor que vem depois ainda entra", async () => {
    const usuario = await criarUsuario("previa-corte");
    const grande = await criarNota(usuario, "Grande", `${METADE_E_TANTO}FIM-DA-GRANDE`);
    const sobra = await criarNota(usuario, "Sobra", `${METADE_E_TANTO}FIM-DA-SOBRA`);
    const pequena = await criarNota(usuario, "Pequena", "cabe folgado");

    const { status, body } = await previa(usuario, {
      name: "Pesado",
      baseNoteIds: [grande, sobra, pequena],
    });

    expect(status).toBe(200);
    const p = body as AgentPreview;
    const notas = p.blocks.filter((b) => b.kind === "nota");
    expect(notas.map((b) => [b.title, b.status])).toEqual([
      ["Grande", "incluido"],
      ["Sobra", "cortado"],
      ["Pequena", "incluido"],
    ]);
    expect(p.cut).toEqual(["Sobra"]);
    expect(p.premisesLimit).toBe(MAX_PREMISSAS_DO_AGENTE);
    expect(p.premisesChars).toBeLessThanOrEqual(MAX_PREMISSAS_DO_AGENTE);

    // Por inteiro, nos dois sentidos: a grande entra até o último caractere,
    // e da cortada não entra nem o começo.
    expect(p.system).toContain("FIM-DA-GRANDE");
    expect(p.system).not.toContain("FIM-DA-SOBRA");
    expect(p.system).not.toContain("<<< Sobra >>>");
    expect(p.system).toContain("cabe folgado");
    // RNF-04 também para o modelo: o corte vai declarado na própria mensagem.
    expect(p.system).toMatch(/não couberam.*Sobra/);

    // Prévia não grava.
    expect(await prisma.aiAgent.count({ where: { userId: usuario.id } })).toBe(0);
  });

  test("nota-base na lixeira fica fora do contexto, com status lixeira e aviso", async () => {
    const usuario = await criarUsuario("previa-lixeira");
    const viva = await criarNota(usuario, "Viva", "corpo que entra");
    const morta = await criarNota(usuario, "Descartada", "corpo-que-nao-entra", new Date());

    const { status, body } = await previa(usuario, { name: "", baseNoteIds: [viva, morta] });

    expect(status).toBe(200);
    const p = body as AgentPreview;
    expect(p.blocks.find((b) => b.title === "Descartada")?.status).toBe("lixeira");
    expect(p.warnings.some((w) => w.includes("Descartada") && /lixeira/.test(w))).toBe(true);
    expect(p.system).not.toContain("corpo-que-nao-entra");
    expect(p.system).toContain("corpo que entra");
  });

  test("coluna excluída depois de o agente ser salvo aparece como indisponível na prévia do editor", async () => {
    // O editor reabre o agente pelo detalhe e manda o rascunho para a prévia.
    // A coluna sumiu entre salvar e reabrir: o bloco precisa aparecer como
    // `indisponivel`, que é o status que o contrato reserva para isso.
    const usuario = await criarUsuario("previa-coluna-excluida");
    const quadro = await criarQuadro(usuario, "Efêmero");
    const coluna = colunaDe(quadro, 2);
    const agente = await agentePronto(usuario, {
      name: "Órfão",
      liveSources: [{ tipo: "coluna", boardId: quadro.id, columnId: coluna }],
    });

    await prisma.boardColumn.delete({ where: { id: coluna } });

    const reaberto = (
      await chamar(app, { method: "GET", url: `/ai/agents/${agente.id}`, token: usuario.token })
    ).body as AgentDetail;
    expect(reaberto.liveSources[0]?.columnName).toBeNull();

    const { status, body } = await previa(usuario, {
      name: reaberto.name,
      liveSources: reaberto.liveSources.map(({ tipo, boardId, columnId, limite, detalhe }) => ({
        tipo,
        boardId,
        columnId,
        limite,
        detalhe,
      })),
    });

    expect(status).toBe(200);
    const p = body as AgentPreview;
    expect(p.blocks.find((b) => b.kind === "fonte")?.status).toBe("indisponivel");
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  test("o custo de um passo usa o preço do favorito escolhido pelo agente", async () => {
    const usuario = await criarUsuario("previa-custo");
    await favoritar(usuario, "estudio/caro", {
      promptMicros: 3_000_000,
      completionMicros: 15_000_000,
    });

    const { status, body } = await previa(usuario, {
      name: "Caro",
      instructionsMd: "Escreva bem.",
      modelId: "estudio/caro",
    });

    expect(status).toBe(200);
    const p = body as AgentPreview;
    expect(p.modelId).toBe("estudio/caro");
    expect(p.modelName).toBe("Nome de estudio/caro");
    // Um passo: o contexto inteiro de entrada a quatro caracteres por token,
    // mais a saída máxima de 2048 tokens, aos preços por milhão do favorito.
    const entrada = Math.ceil(p.chars / 4);
    expect(p.tokens).toBe(entrada);
    expect(p.costPerStepMicros).toBe(Math.ceil(entrada * 3 + 2_048 * 15));
  });

  test("modelo fora dos favoritos não derruba a prévia: custo nulo, e o aviso diz por quê", async () => {
    const usuario = await criarUsuario("previa-sem-modelo");

    const { status, body } = await previa(usuario, { name: "Sem", modelId: "estudio/sumido" });

    expect(status).toBe(200);
    const p = body as AgentPreview;
    expect(p.costPerStepMicros).toBeNull();
    expect(p.warnings.some((w) => /saiu dos favoritos/.test(w))).toBe(true);
  });
});

/* ------------------------------------------------------------------- chat */

describe("CA-23 / RN-13: o que o agente manda ao provedor", () => {
  test("a mensagem system traz as regras primeiro, depois as instruções, a nota-base inteira e os títulos da coluna", async () => {
    const usuario = await comChat("chat-contexto");
    const quadro = await criarQuadro(usuario, "LinkedIn");
    const publicados = colunaDe(quadro, 2);
    await criarCard(usuario, publicados, "Post sobre fuso horário");
    await criarCard(usuario, publicados, "Post sobre Postgres");
    const guia = await criarNota(usuario, "Guia de posts", "Abra com um número.\n\nNUNCA use emoji.");
    const agente = await agentePronto(usuario, {
      name: "LinkedIn",
      instructionsMd: "INSTRUCAO-DO-AGENTE: escreva posts.",
      tools: ["search_notes"],
      baseNoteIds: [guia],
      liveSources: [{ tipo: "coluna", boardId: quadro.id, columnId: publicados }],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const r = await enviar(usuario, conversa.id, "escreva um post");

    expect(r.status).toBe(200);
    const sistema = sistemaEnviado();
    const posicao = (trecho: string) => {
      const i = sistema.indexOf(trecho);
      expect(i, trecho).toBeGreaterThanOrEqual(0);
      return i;
    };
    const regras = posicao("Regras que valem sempre");
    const instrucoes = posicao("INSTRUCAO-DO-AGENTE");
    const nota = posicao("NUNCA use emoji.");
    const coluna = posicao("Post sobre fuso horário");
    posicao("Post sobre Postgres");

    // RN-13: as regras do Yu-book abrem, e as do agente só vêm depois.
    expect(regras).toBeLessThan(instrucoes);
    expect(instrucoes).toBeLessThan(nota);
    expect(nota).toBeLessThan(coluna);
    // A nota entra inteira, não resumida.
    expect(sistema).toContain("Abra com um número.\n\nNUNCA use emoji.");
  });

  test("RF-45: a fonte viva é relida a cada mensagem — o card novo aparece na seguinte", async () => {
    const usuario = await comChat("chat-fonte-fresca");
    const quadro = await criarQuadro(usuario, "Fila");
    const fila = colunaDe(quadro, 0);
    const agente = await agentePronto(usuario, {
      name: "Atento",
      liveSources: [{ tipo: "coluna", boardId: quadro.id, columnId: fila }],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    await enviar(usuario, conversa.id, "primeira");
    expect(sistemaEnviado()).not.toContain("Card que chegou depois");

    await criarCard(usuario, fila, "Card que chegou depois");
    await enviar(usuario, conversa.id, "segunda");
    expect(sistemaEnviado()).toContain("Card que chegou depois");
  });

  test("coluna de fonte viva excluída depois de salvo não derruba a conversa: a fonte fica fora", async () => {
    const usuario = await comChat("chat-coluna-excluida");
    const quadro = await criarQuadro(usuario, "Some");
    const coluna = colunaDe(quadro, 1);
    await criarCard(usuario, coluna, "Card da coluna que some");
    const guia = await criarNota(usuario, "Fica", "PREMISSA-QUE-FICA");
    const agente = await agentePronto(usuario, {
      name: "Resiliente",
      baseNoteIds: [guia],
      liveSources: [{ tipo: "coluna", boardId: quadro.id, columnId: coluna }],
    });
    const conversa = await conversaCom(usuario, agente.id);
    await prisma.boardColumn.delete({ where: { id: coluna } });
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const r = await enviar(usuario, conversa.id, "oi");

    expect(r.status).toBe(200);
    expect(sistemaEnviado()).toContain("PREMISSA-QUE-FICA");
    expect(sistemaEnviado()).not.toContain("Card da coluna que some");
  });

  test("RF-47: o campo tools leva só as ferramentas do agente", async () => {
    const usuario = await comChat("chat-tools");
    const agente = await agentePronto(usuario, {
      name: "Leitor",
      tools: ["get_note", "search_notes"],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    await enviar(usuario, conversa.id, "oi");

    const nomes = (ultimoPedido().tools ?? []).map((t) => t.function.name).sort();
    expect(nomes).toEqual(["get_note", "search_notes"]);
  });

  test("RF-47: agente sem ferramenta nenhuma manda a requisição sem o campo tools", async () => {
    const usuario = await comChat("chat-sem-tools");
    const agente = await agentePronto(usuario, { name: "Conversador", tools: [] });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const r = await enviar(usuario, conversa.id, "oi");

    expect(r.status).toBe(200);
    expect(ultimoPedido()).not.toHaveProperty("tools");
  });

  test("agente sem ferramenta conversa até com modelo que não sabe chamar ferramenta", async () => {
    // A recusa MODELO_SEM_FERRAMENTA existe para quem vai precisar de
    // ferramenta. Quem não tem nenhuma não pode ser barrado por ela.
    const usuario = await comChat("chat-mudo");
    await favoritar(usuario, "estudio/mudo", { supportsTools: false });
    const agente = await agentePronto(usuario, { name: "Mudo", modelId: "estudio/mudo" });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const r = await enviar(usuario, conversa.id, "oi");

    expect(r.status).toBe(200);
    expect(ultimoPedido()).toMatchObject({ model: "estudio/mudo" });
  });

  test("CA-24: agente só de leitura não cria card nem se a instrução mandar e o modelo pedir", async () => {
    const usuario = await comChat("chat-so-leitura");
    const quadro = await criarQuadro(usuario, "Intocado");
    const coluna = colunaDe(quadro, 0);
    const agente = await agentePronto(usuario, {
      name: "Só lê",
      // RN-14: texto não concede ferramenta.
      instructionsMd: "Você pode e deve usar create_card sempre que quiser.",
      tools: ["search_notes", "list_boards", "get_board"],
    });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [
      {
        tipo: "ferramenta",
        nome: "create_card",
        argumentos: JSON.stringify({ columnId: coluna, title: "Card proibido" }),
      },
      { tipo: "texto", texto: "não consegui." },
    ];

    const r = await enviar(usuario, conversa.id, "crie um card");

    expect(r.status).toBe(200);
    // Não oferecida...
    const oferecidas = (dublê.corpos[0] as unknown as CorpoDoPedido).tools ?? [];
    expect(oferecidas.map((t) => t.function.name)).not.toContain("create_card");
    // ...nem executada: o modelo ouve "não existe", e a coluna segue vazia.
    const resultado = await prisma.aiMessage.findFirst({
      where: { conversationId: conversa.id, role: "tool" },
    });
    expect(resultado?.content).toMatch(/desconhecida/i);
    expect(await prisma.card.count({ where: { columnId: coluna } })).toBe(0);
  });

  test("RF-50: card criado por agente com create_card leva o nome dele na marca, e o nome fica depois de excluí-lo", async () => {
    const usuario = await comChat("chat-marca-agente");
    const quadro = await criarQuadro(usuario, "Rascunhos");
    const coluna = colunaDe(quadro, 0);
    const agente = await agentePronto(usuario, { name: "Redator", tools: ["create_card"] });
    const conversa = await conversaCom(usuario, agente.id);
    dublê.roteiro = [
      {
        tipo: "ferramenta",
        nome: "create_card",
        argumentos: JSON.stringify({ columnId: coluna, title: "Rascunho do post" }),
      },
      { tipo: "texto", texto: "Criei o card Rascunho do post." },
    ];

    const r = await enviar(usuario, conversa.id, "crie um card com o rascunho");
    expect(r.status).toBe(200);

    const card = await prisma.card.findFirstOrThrow({ where: { columnId: coluna } });
    const lerCard = async () =>
      (await chamar(app, { method: "GET", url: `/cards/${card.id}`, token: usuario.token }))
        .body as CardDetail;
    expect((await lerCard()).ai).toMatchObject({
      via: "chat",
      conversationId: conversa.id,
      agentName: "Redator",
    });

    await chamar(app, { method: "DELETE", url: `/ai/agents/${agente.id}`, token: usuario.token });
    expect((await lerCard()).ai?.agentName).toBe("Redator");
  });
});

describe("CA-28 / RF-46: favorito removido recusa, não troca de modelo calado", () => {
  test("agente cujo modelo saiu dos favoritos responde 422 MODELO_NAO_ESCOLHIDO sem chamar o provedor", async () => {
    const usuario = await comChat("chat-favorito-sumiu");
    await favoritar(usuario, "estudio/proprio");
    const agente = await agentePronto(usuario, { name: "Fiel", modelId: "estudio/proprio" });
    const conversa = await conversaCom(usuario, agente.id);

    await prisma.aiModelFavorite.deleteMany({
      where: { userId: usuario.id, modelId: "estudio/proprio" },
    });

    const resposta = await app.inject({
      method: "POST",
      url: `/ai/conversations/${conversa.id}/messages`,
      headers: { authorization: `Bearer ${usuario.token}` },
      remoteAddress: "10.2.0.1",
      payload: { content: "oi" },
    });

    expect(resposta.statusCode).toBe(422);
    const body = JSON.parse(resposta.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("MODELO_NAO_ESCOLHIDO");
    // O motivo aponta o agente, que é onde se conserta.
    expect(body.error.message).toContain("Fiel");
    // O modelo do chat existe e funcionaria — e mesmo assim não foi usado.
    expect(chamadasAoChat(dublê)).toEqual([]);
  });
});

describe("CA-27 / RF-49: o agente é fixo por conversa e sobrevive à própria exclusão", () => {
  test("excluído o agente, a conversa segue legível com o nome gravado e a cor neutra", async () => {
    const usuario = await comChat("chat-agente-excluido");
    const agente = await agentePronto(usuario, { name: "Efêmero", color: "azul" });
    const conversa = await conversaCom(usuario, agente.id);
    expect(conversa.agent).toEqual({ id: agente.id, name: "Efêmero", color: "azul" });
    dublê.roteiro = [{ tipo: "texto", texto: "resposta guardada" }];
    await enviar(usuario, conversa.id, "pergunta guardada");

    await chamar(app, { method: "DELETE", url: `/ai/agents/${agente.id}`, token: usuario.token });

    const { status, body } = await chamar(app, {
      method: "GET",
      url: `/ai/conversations/${conversa.id}`,
      token: usuario.token,
    });
    expect(status).toBe(200);
    const detalhe = body as ConversationDetail;
    expect(detalhe.agent).toEqual({ id: null, name: "Efêmero", color: "cinza" });
    expect(detalhe.messages.map((m) => m.content)).toEqual([
      "pergunta guardada",
      "resposta guardada",
    ]);

    const lista = (
      await chamar(app, { method: "GET", url: "/ai/conversations", token: usuario.token })
    ).body as Conversation[];
    expect(lista.find((c) => c.id === conversa.id)?.agent).toEqual({
      id: null,
      name: "Efêmero",
      color: "cinza",
    });
  });

  test("mensagem nova em conversa de agente excluído é 422, e não vira o Assistente calado", async () => {
    const usuario = await comChat("chat-agente-excluido-envio");
    const agente = await agentePronto(usuario, { name: "Partiu" });
    const conversa = await conversaCom(usuario, agente.id);
    await chamar(app, { method: "DELETE", url: `/ai/agents/${agente.id}`, token: usuario.token });

    const r = await enviar(usuario, conversa.id, "ainda está aí?");

    expect(r.status).toBe(422);
    expect(chamadasAoChat(dublê)).toEqual([]);
    expect(await prisma.aiMessage.count({ where: { conversationId: conversa.id } })).toBe(0);
  });

  test("conversa com agente de outra conta é 404 igual ao inexistente, e nada é criado", async () => {
    const dono = await criarUsuario("conversa-agente-dono");
    const intruso = await criarUsuario("conversa-agente-intruso");
    const agente = await agentePronto(dono, { name: "Do dono" });

    const pedir = (agentId: string) =>
      chamar(app, {
        method: "POST",
        url: "/ai/conversations",
        token: intruso.token,
        body: { title: "Emprestada", agentId },
      });
    const alheio = await pedir(agente.id);
    const nenhum = await pedir(crypto.randomUUID());

    expect(alheio.status).toBe(404);
    expect(alheio.body).toEqual(nenhum.body);
    expect(await prisma.aiConversation.count({ where: { userId: intruso.id } })).toBe(0);
  });

  test("agente excluído entre a conferência e a gravação é o mesmo 404, não um 500 da FK", async () => {
    const usuario = await criarUsuario("conversa-agente-corrida");
    const agente = await agentePronto(usuario, { name: "Por um triz" });
    const nenhum = await chamar(app, {
      method: "POST",
      url: "/ai/conversations",
      token: usuario.token,
      body: { title: "Sem agente", agentId: crypto.randomUUID() },
    });

    // A corrida, sem depender de tempo: o `findFirst` acha o agente e, antes de
    // devolver, ele é excluído — o `create` seguinte bate na FK.
    const original = prisma.aiAgent.findFirst.bind(prisma.aiAgent);
    const espiao = vi.spyOn(prisma.aiAgent, "findFirst").mockImplementationOnce((async (
      args: Parameters<typeof original>[0],
    ) => {
      const achado = await original(args);
      await prisma.aiAgent.delete({ where: { id: agente.id } });
      return achado;
    }) as never);
    try {
      const r = await chamar(app, {
        method: "POST",
        url: "/ai/conversations",
        token: usuario.token,
        body: { title: "Por um triz", agentId: agente.id },
      });

      expect(espiao).toHaveBeenCalledOnce();
      expect(r.status).toBe(404);
      expect(r.body).toEqual(nenhum.body);
      expect(await prisma.aiConversation.count({ where: { userId: usuario.id } })).toBe(0);
    } finally {
      espiao.mockRestore();
    }
  });
});

describe("RNF-04: premissa cortada é declarada no evento inicio", () => {
  test("premissasCortadas lista o que não coube; sem agente, vem vazia", async () => {
    const usuario = await comChat("chat-premissas-cortadas");
    const a = await criarNota(usuario, "Cabe", METADE_E_TANTO);
    const b = await criarNota(usuario, "Não cabe", METADE_E_TANTO);
    const agente = await agentePronto(usuario, { name: "Sobrecarregado", baseNoteIds: [a, b] });
    dublê.roteiro = [{ tipo: "texto", texto: "ok" }];

    const comAgente = await enviar(usuario, (await conversaCom(usuario, agente.id)).id, "oi");
    const inicio = comAgente.eventos.find((e) => e.tipo === "inicio");
    expect(inicio?.tipo === "inicio" && inicio.premissasCortadas).toEqual(["Não cabe"]);

    const semAgente = await enviar(usuario, (await conversaCom(usuario)).id, "oi");
    const inicioPuro = semAgente.eventos.find((e) => e.tipo === "inicio");
    expect(inicioPuro?.tipo === "inicio" && inicioPuro.premissasCortadas).toEqual([]);
  });
});

/* ------------------------------------------------------------- exportação */

/**
 * Leitor mínimo do frontmatter: escalares, listas de escalar e listas de
 * objeto raso — as formas que a exportação produz. O escalar entre aspas
 * duplas do YAML é lido como string JSON, que é o subconjunto que ele usa.
 */
function lerFrontmatter(linhas: string[]): Record<string, unknown> {
  const escalar = (bruto: string): unknown => {
    if (bruto === "[]") return [];
    return JSON.parse(bruto) as unknown;
  };
  const saida: Record<string, unknown> = {};
  let lista: unknown[] | null = null;
  let objeto: Record<string, unknown> | null = null;

  for (const linha of linhas) {
    const topo = /^([A-Za-z]+):(?: (.*))?$/.exec(linha);
    if (topo) {
      const [, chave = "", valor] = topo;
      lista = null;
      objeto = null;
      if (valor === undefined) {
        lista = [];
        saida[chave] = lista;
      } else {
        saida[chave] = escalar(valor);
      }
      continue;
    }
    const item = /^ {2}- (.*)$/.exec(linha);
    const campo = /^ {4}([A-Za-z]+): (.*)$/.exec(linha);
    if (item && lista) {
      const par = /^([A-Za-z]+): (.*)$/.exec(item[1] ?? "");
      if (par) {
        objeto = { [par[1] ?? ""]: escalar(par[2] ?? "") };
        lista.push(objeto);
      } else {
        lista.push(escalar(item[1] ?? ""));
      }
    } else if (campo && objeto) {
      objeto[campo[1] ?? ""] = escalar(campo[2] ?? "");
    } else {
      throw new Error(`linha de frontmatter que o leitor não entende: ${linha}`);
    }
  }
  return saida;
}

describe("RF-52: o agente exporta como Markdown com frontmatter", () => {
  test("nome com dois-pontos, aspas e cerquilha sai como YAML válido, e o corpo são as instruções", async () => {
    const usuario = await criarUsuario("exportar");
    const quadro = await criarQuadro(usuario, "Publicações");
    const guia = await criarNota(usuario, "Guia: tom e voz", "x");
    const nome = 'Revisor: o "chato" #1';
    const instrucoes = "## Como revisar\n\n- Aponte, não reescreva.\n- yes: isto é texto.";
    const agente = await agentePronto(usuario, {
      name: nome,
      description: "- começa com hífen",
      color: "verde",
      instructionsMd: instrucoes,
      tools: ["search_notes", "get_note"],
      baseNoteIds: [guia],
      liveSources: [
        { tipo: "coluna", boardId: quadro.id, columnId: colunaDe(quadro, 2), detalhe: "faces" },
      ],
    });

    const resposta = await app.inject({
      method: "GET",
      url: `/ai/agents/${agente.id}/export`,
      headers: { authorization: `Bearer ${usuario.token}` },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/^text\/markdown/);
    expect(resposta.headers["content-disposition"]).toBe(
      'attachment; filename="revisor-o-chato-1.md"',
    );

    const linhas = resposta.body.split("\n");
    expect(linhas[0]).toBe("---");
    const fecha = linhas.indexOf("---", 1);
    expect(fecha).toBeGreaterThan(1);

    const frente = lerFrontmatter(linhas.slice(1, fecha));
    expect(frente).toEqual({
      name: nome,
      description: "- começa com hífen",
      color: "verde",
      model: null,
      tools: ["search_notes", "get_note"],
      // Por título: o id não significa nada fora deste banco.
      baseNotes: ["Guia: tom e voz"],
      liveSources: [{ board: "Publicações", column: "Feito", limit: 10, detail: "faces" }],
    });

    expect(linhas.slice(fecha + 1).join("\n").trim()).toBe(instrucoes);
  });
});
