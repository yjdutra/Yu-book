import {
  FERRAMENTAS_DO_ACERVO,
  FERRAMENTAS_DO_CHAT,
  FUSO_PADRAO,
  diaLocal,
  formatarCard,
  formatarCardDetalhe,
  formatarNota,
} from "@yu-book/shared";
import type {
  BoardDetail,
  CardDetail,
  NomeDeFerramenta,
  NoteCounts,
  NoteDetail,
  NoteListResponse,
  SearchResponse,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { catalogoParaProvedor, executar } from "../src/modules/assistente/ferramentas.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * A marca de conteúdo gerado por IA — Etapa C da frente de IA, §5.5 de
 * `docs/prd-ia-no-yu-book.md`, CA-17 a CA-21.
 *
 * O que esta suíte protege, em uma frase: **a marca é gravada só pelo
 * servidor e nunca some.** Três portas gravam (o executor do chat, o `origin`
 * do MCP e o "virar nota"), e nenhuma aceita a palavra do cliente sobre o
 * chat; editar à mão registra revisão sem apagar a origem.
 *
 * Nenhum teste aqui chama o provedor: os executores do chat são chamados
 * direto, com o contexto que `chat.service` montaria.
 */

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
let colunaId: string;
let boardId: string;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("marca-dono");
  intruso = await criarUsuario("marca-intruso");

  const workspace = await prisma.workspace.create({ data: { userId: dono.id, name: "Marca" } });
  const { body } = await chamar(app, {
    method: "POST",
    url: "/boards",
    token: dono.token,
    body: { name: "Quadro da marca", workspaceId: workspace.id },
  });
  const board = body as BoardDetail;
  boardId = board.id;
  colunaId = board.columns[0]?.id ?? "";
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

async function novaConversa(usuario: Usuario, titulo = "Conversa"): Promise<string> {
  const conversa = await prisma.aiConversation.create({
    data: { userId: usuario.id, title: titulo },
  });
  return conversa.id;
}

/** O contexto que `chat.service` monta para o executor — origem vinda da conversa. */
function contextoDoChat(usuario: Usuario, conversationId: string, author = "estudio/conversa") {
  return {
    userId: usuario.id,
    fuso: FUSO_PADRAO,
    origem: { via: "chat" as const, author, conversationId },
    permitidas: FERRAMENTAS_DO_CHAT,
  };
}

async function criarNota(usuario: Usuario, corpo: Record<string, unknown>) {
  return chamar(app, { method: "POST", url: "/notes", token: usuario.token, body: corpo });
}

const lerNota = async (id: string) =>
  (await chamar(app, { method: "GET", url: `/notes/${id}`, token: dono.token })).body as NoteDetail;

const lerCard = async (id: string) =>
  (await chamar(app, { method: "GET", url: `/cards/${id}`, token: dono.token })).body as CardDetail;

describe("o chat grava a marca pelo contexto, não pelos argumentos", () => {
  test("CA-17: card criado pelo chat traz via chat, o modelo que respondeu e a conversa", async () => {
    const conversa = await novaConversa(dono);

    const saida = await executar(
      "create_card",
      { columnId: colunaId, title: "Revisar contrato" },
      contextoDoChat(dono, conversa, "estudio/conversa-v2"),
    );

    expect(saida.criados).toHaveLength(1);
    const card = await lerCard(saida.criados[0]?.id ?? "");
    expect(card.ai).toMatchObject({
      via: "chat",
      author: "estudio/conversa-v2",
      conversationId: conversa,
      revisedAt: null,
    });
    expect(card.ai?.generatedAt).toEqual(expect.any(String));
  });

  test("nota criada pelo chat nasce marcada com a mesma origem", async () => {
    const conversa = await novaConversa(dono);

    const saida = await executar(
      "create_note",
      { title: "Resumo gerado no chat", contentMd: "corpo" },
      contextoDoChat(dono, conversa),
    );

    const nota = await lerNota(saida.criados[0]?.id ?? "");
    expect(nota.ai).toMatchObject({
      via: "chat",
      author: "estudio/conversa",
      conversationId: conversa,
    });
  });

  test("prazo que não existe no calendário volta erro ao modelo, e nada é criado", async () => {
    // 30 de fevereiro passa pela regex AAAA-MM-DD; quem recusa é a conversão
    // para o fim do dia no fuso — e o erro precisa ser um que o modelo saiba ler.
    const conversa = await novaConversa(dono);
    const antes = await prisma.card.count({ where: { columnId: colunaId } });

    await expect(
      executar(
        "create_card",
        { columnId: colunaId, title: "Prazo impossível", dueDate: "2026-02-30" },
        contextoDoChat(dono, conversa),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "VALIDATION_ERROR" });

    expect(await prisma.card.count({ where: { columnId: colunaId } })).toBe(antes);
  });
});

describe("o MCP declara a origem pelo corpo, e só como mcp", () => {
  test("POST /notes com origin mcp grava via mcp e o nome do cliente", async () => {
    const r = await criarNota(dono, {
      title: "Nota do cliente MCP",
      origin: { via: "mcp", author: "Claude Desktop" },
    });

    expect(r.status).toBe(201);
    const nota = r.body as NoteDetail;
    expect(nota.ai).toMatchObject({ via: "mcp", author: "Claude Desktop", conversationId: null });
  });

  test("POST /cards com origin mcp grava via mcp e o nome do cliente", async () => {
    const r = await chamar(app, {
      method: "POST",
      url: "/cards",
      token: dono.token,
      body: { columnId: colunaId, title: "Card do MCP", origin: { via: "mcp", author: "Cursor" } },
    });

    expect(r.status).toBe(201);
    expect((r.body as CardDetail).ai).toMatchObject({ via: "mcp", author: "Cursor" });
  });

  test("ninguém se passa pelo chat pelo corpo da requisição: origin chat é 422", async () => {
    // Aceitar `chat` aqui deixaria um cliente HTTP qualquer gravar a marca do
    // assistente — com um `conversationId` alheio.
    const conversa = await novaConversa(intruso);
    const nota = await criarNota(dono, {
      title: "Falsa nota do chat",
      origin: { via: "chat", author: "x", conversationId: conversa },
    });
    const card = await chamar(app, {
      method: "POST",
      url: "/cards",
      token: dono.token,
      body: { columnId: colunaId, title: "Falso card do chat", origin: { via: "chat", author: "x" } },
    });

    expect(nota.status).toBe(422);
    expect(card.status).toBe(422);
    expect(await prisma.note.count({ where: { title: "Falsa nota do chat" } })).toBe(0);
    expect(await prisma.card.count({ where: { title: "Falso card do chat" } })).toBe(0);
  });

  test("conteúdo escrito sem origin é humano: a marca é nula", async () => {
    const nota = (await criarNota(dono, { title: "Escrita à mão" })).body as NoteDetail;
    const card = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Card à mão" },
      })
    ).body as CardDetail;

    expect(nota.ai).toBeNull();
    expect(card.ai).toBeNull();
  });
});

describe("RN-11: a marca nunca some, e só editar o texto é revisão", () => {
  async function notaGerada(titulo: string): Promise<NoteDetail> {
    return (
      await criarNota(dono, {
        title: titulo,
        contentMd: "texto do modelo",
        origin: { via: "mcp", author: "Claude Desktop" },
      })
    ).body as NoteDetail;
  }

  const salvar = (id: string, corpo: Record<string, unknown>) =>
    chamar(app, { method: "PATCH", url: `/notes/${id}`, token: dono.token, body: corpo });

  test("CA-19: favoritar nota gerada não mexe na marca", async () => {
    const nota = await notaGerada("Gerada e favoritada");

    const r = await salvar(nota.id, { isFavorite: true });

    expect(r.status).toBe(200);
    expect((r.body as NoteDetail).ai).toEqual(nota.ai);
  });

  test("CA-19: editar o corpo à mão marca revisão e mantém a origem", async () => {
    const nota = await notaGerada("Gerada e revisada");

    const r = await salvar(nota.id, { contentMd: "texto do modelo, corrigido por mim" });

    const ai = (r.body as NoteDetail).ai;
    expect(ai?.revisedAt).toEqual(expect.any(String));
    expect(ai).toMatchObject({
      generatedAt: nota.ai?.generatedAt,
      via: "mcp",
      author: "Claude Desktop",
    });
  });

  test("o autosave reenviando o mesmo corpo não é revisão", async () => {
    const nota = await notaGerada("Gerada e reenviada");

    const r = await salvar(nota.id, { contentMd: "texto do modelo" });

    expect((r.body as NoteDetail).ai?.revisedAt).toBeNull();
  });

  test("PATCH com só origin é recusado: nenhuma rota de edição regrava a marca", async () => {
    const nota = (await criarNota(dono, { title: "Humana que quer marca" })).body as NoteDetail;

    const r = await salvar(nota.id, { origin: { via: "mcp", author: "impostor" } });

    expect(r.status).toBe(422);
    expect((await lerNota(nota.id)).ai).toBeNull();
  });

  test("CA-19 no card: título alterado marca revisão; prioridade, não", async () => {
    const criado = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Card gerado", origin: { via: "mcp", author: "Cursor" } },
      })
    ).body as CardDetail;

    const soPrioridade = await chamar(app, {
      method: "PATCH",
      url: `/cards/${criado.id}`,
      token: dono.token,
      body: { priority: "alta" },
    });
    expect(soPrioridade.status).toBe(200);
    expect((await lerCard(criado.id)).ai?.revisedAt).toBeNull();

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${criado.id}`,
      token: dono.token,
      body: { title: "Card gerado, renomeado à mão" },
    });

    const depois = await lerCard(criado.id);
    expect(depois.ai?.revisedAt).toEqual(expect.any(String));
    expect(depois.ai).toMatchObject({ via: "mcp", author: "Cursor" });
  });
});

describe("CA-20: o filtro Geradas por IA e a contagem concordam", () => {
  test("duas geradas e uma à mão: o filtro devolve as duas e a contagem diz 2", async () => {
    // Usuário próprio: a contagem é da conta inteira, e as outras suítes
    // deste arquivo também criam notas geradas.
    const usuario = await criarUsuario("marca-filtro");
    const origin = { via: "mcp", author: "Claude Desktop" };
    const a = (await criarNota(usuario, { title: "Gerada A", origin })).body as NoteDetail;
    const b = (await criarNota(usuario, { title: "Gerada B", origin })).body as NoteDetail;
    await criarNota(usuario, { title: "À mão" });

    const lista = (
      await chamar(app, { method: "GET", url: "/notes?ai=true", token: usuario.token })
    ).body as NoteListResponse;
    const contagem = (
      await chamar(app, { method: "GET", url: "/notes/counts", token: usuario.token })
    ).body as NoteCounts;

    expect(lista.items.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(lista.items.every((n) => n.ai !== null)).toBe(true);
    expect(contagem.ai).toBe(2);
    expect(contagem.total).toBe(3);
  });
});

describe("a busca traz a marca", () => {
  test("resultado de nota e de card gerados vem com ai; o humano, com null", async () => {
    const origin = { via: "mcp", author: "Claude Desktop" };
    await criarNota(dono, { title: "Quiabo gerado", contentMd: "quiabo", origin });
    await criarNota(dono, { title: "Quiabo humano", contentMd: "quiabo" });
    await chamar(app, {
      method: "POST",
      url: "/cards",
      token: dono.token,
      body: { columnId: colunaId, title: "Comprar quiabo", origin },
    });

    const r = (
      await chamar(app, { method: "GET", url: "/search?q=quiabo", token: dono.token })
    ).body as SearchResponse;

    const porTitulo = (t: string) => r.results.find((x) => x.title === t);
    expect(porTitulo("Quiabo gerado")?.ai).toMatchObject({ via: "mcp", author: "Claude Desktop" });
    expect(porTitulo("Comprar quiabo")?.type).toBe("card");
    expect(porTitulo("Comprar quiabo")?.ai).toMatchObject({ via: "mcp" });
    expect(porTitulo("Quiabo humano")?.ai).toBeNull();
  });
});

describe("CA-18: virar nota lê a mensagem gravada, nunca o cliente", () => {
  async function mensagem(
    conversationId: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<string> {
    const m = await prisma.aiMessage.create({
      data: {
        conversationId,
        role,
        content,
        ...(role === "assistant" && { modelId: "estudio/pedido", modelUsed: "estudio/respondeu" }),
      },
    });
    return m.id;
  }

  const virar = (usuario: Usuario, conversa: string, msg: string, corpo: unknown) =>
    chamar(app, {
      method: "POST",
      url: `/ai/conversations/${conversa}/messages/${msg}/note`,
      token: usuario.token,
      body: corpo,
    });

  test("resposta do assistente vira nota com o texto dela e o modelo que de fato respondeu", async () => {
    const conversa = await novaConversa(dono);
    const msg = await mensagem(conversa, "assistant", "# Plano\n\nTrês passos.");

    const r = await virar(dono, conversa, msg, { title: "Plano do assistente" });

    expect(r.status).toBe(201);
    const nota = r.body as NoteDetail;
    expect(nota.contentMd).toBe("# Plano\n\nTrês passos.");
    // `modelUsed` vence `modelId`: o roteamento pode trocar o modelo pedido.
    expect(nota.ai).toMatchObject({
      via: "chat",
      author: "estudio/respondeu",
      conversationId: conversa,
    });
  });

  test("conteúdo enviado pelo cliente é ignorado: o corpo sai do banco", async () => {
    const conversa = await novaConversa(dono);
    const msg = await mensagem(conversa, "assistant", "o que o modelo disse");

    const r = await virar(dono, conversa, msg, {
      title: "Tentativa de forjar",
      contentMd: "o que eu queria que ele tivesse dito",
    });

    expect((r.body as NoteDetail).contentMd).toBe("o que o modelo disse");
  });

  test("mensagem de outra conta é 404, e não 403", async () => {
    const conversa = await novaConversa(dono);
    const msg = await mensagem(conversa, "assistant", "segredo do dono");

    const r = await virar(intruso, conversa, msg, { title: "Roubada" });

    expect(r.status).toBe(404);
    expect(await prisma.note.count({ where: { userId: intruso.id } })).toBe(0);
  });

  test("mensagem de outra conversa do mesmo usuário também é 404", async () => {
    // A posse resolve pela cadeia mensagem → conversa → usuário: a mensagem
    // precisa ser **daquela** conversa, não só de alguma conversa minha.
    const certa = await novaConversa(dono);
    const outra = await novaConversa(dono);
    const msg = await mensagem(certa, "assistant", "fala da conversa certa");

    const r = await virar(dono, outra, msg, { title: "Cruzada" });

    expect(r.status).toBe(404);
  });

  test("fala do próprio usuário é recusada: marcá-la como gerada seria mentir no dado", async () => {
    const conversa = await novaConversa(dono);
    const msg = await mensagem(conversa, "user", "minha pergunta");

    const r = await virar(dono, conversa, msg, { title: "Minha pergunta" });

    expect(r.status).toBe(422);
  });

  test("título repetido é 409 TITULO_DUPLICADO, como em qualquer nota", async () => {
    await criarNota(dono, { title: "Título ocupado" });
    const conversa = await novaConversa(dono);
    const msg = await mensagem(conversa, "assistant", "qualquer coisa");

    const r = await virar(dono, conversa, msg, { title: "titulo ocupado" });

    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: "TITULO_DUPLICADO" } });
  });
});

describe("apagar a conversa não apaga a marca", () => {
  test("nota e card continuam gerados, só perdem o vínculo com a conversa", async () => {
    const conversa = await novaConversa(dono);
    const contexto = contextoDoChat(dono, conversa);
    const nota = await executar(
      "create_note",
      { title: "Sobrevive à conversa", contentMd: "x" },
      contexto,
    );
    const card = await executar(
      "create_card",
      { columnId: colunaId, title: "Card que sobrevive" },
      contexto,
    );

    const r = await chamar(app, {
      method: "DELETE",
      url: `/ai/conversations/${conversa}`,
      token: dono.token,
    });
    expect(r.status).toBe(204);

    const notaDepois = await lerNota(nota.criados[0]?.id ?? "");
    const cardDepois = await lerCard(card.criados[0]?.id ?? "");
    expect(notaDepois.ai).toMatchObject({ via: "chat", author: "estudio/conversa" });
    expect(notaDepois.ai?.conversationId).toBeNull();
    expect(cardDepois.ai).toMatchObject({ via: "chat", author: "estudio/conversa" });
    expect(cardDepois.ai?.conversationId).toBeNull();
  });
});

describe("CA-21 / RN-12: o chat escreve criando e concluindo, nunca movendo nem apagando", () => {
  test("o catálogo oferecido ao provedor tem nove ações, e nenhuma de mover ou apagar", () => {
    // Oito do acervo — as leituras, as duas criações e, desde a Parte 1 da
    // frente de cards, `complete_card` — mais `open_page`, da web (Etapa G).
    const nomes = catalogoParaProvedor(FERRAMENTAS_DO_CHAT).map((f) => f.function.name);

    expect(nomes).toHaveLength(9);
    expect(new Set(nomes).size).toBe(9);
    expect(nomes).not.toContain("move_card");
    expect(nomes).not.toContain("trash_note");
    expect(nomes).not.toContain("restore_note");
  });

  test("toda ação de escrita do catálogo compartilhado, fora as duas criações e a conclusão, fica fora", () => {
    // Derivado do catálogo, e não enumerado: uma ação de escrita nova em
    // `ferramentas.ts` não pode entrar no chat só por existir lá (RN-12).
    const oferecidas = new Set(catalogoParaProvedor(FERRAMENTAS_DO_CHAT).map((f) => f.function.name));
    const escritas = (Object.keys(FERRAMENTAS_DO_ACERVO) as NomeDeFerramenta[]).filter(
      (n) => FERRAMENTAS_DO_ACERVO[n].escrita,
    );

    const escritasOferecidas = escritas.filter((n) => oferecidas.has(n)).sort();
    expect(escritasOferecidas).toEqual(["complete_card", "create_card", "create_note"]);
    // E o inverso: toda leitura está lá — senão o "nove" fecharia por troca.
    const leituras = (Object.keys(FERRAMENTAS_DO_ACERVO) as NomeDeFerramenta[]).filter(
      (n) => !FERRAMENTAS_DO_ACERVO[n].escrita,
    );
    expect(leituras.every((n) => oferecidas.has(n))).toBe(true);
  });

  test("ação de escrita sem executor responde como desconhecida", async () => {
    const nota = (await criarNota(dono, { title: "Não vai para a lixeira" })).body as NoteDetail;
    const conversa = await novaConversa(dono);

    await expect(
      executar("trash_note", { noteId: nota.id }, contextoDoChat(dono, conversa)),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect((await lerNota(nota.id)).deletedAt).toBeNull();
  });

  test("move_card segue 422 como desconhecida, com ou sem executor", async () => {
    const conversa = await novaConversa(dono);
    await expect(
      executar("move_card", { cardId: colunaId, columnId: colunaId }, contextoDoChat(dono, conversa)),
    ).rejects.toMatchObject({ statusCode: 422, code: "VALIDATION_ERROR" });
  });
});

/**
 * O `workspaceId` vem do cliente nas quatro portas que gravam nota: POST, PATCH,
 * o `create_note` do chat e o "virar nota". O de outra conta e o inexistente
 * precisam dar a mesma resposta — senão a diferença entre os dois já diz que o
 * id existe —, e o nome do workspace alheio nunca volta.
 */
describe("INV-02: workspace alheio na nota é 404, igual ao inexistente", () => {
  const INEXISTENTE = "00000000-0000-4000-8000-000000000000";
  let alheio: string;

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { userId: intruso.id, name: "Segredo do intruso" },
    });
    alheio = ws.id;
  });

  test("POST /notes: alheio e inexistente dão o mesmo 404, sem o nome", async () => {
    const a = await criarNota(dono, { title: "Nota no alheio", workspaceId: alheio });
    const b = await criarNota(dono, { title: "Nota no inexistente", workspaceId: INEXISTENTE });

    expect(a.status).toBe(404);
    expect(a).toEqual(b);
    expect((a.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(a.body)).not.toContain("Segredo do intruso");
    expect(await prisma.note.count({ where: { userId: dono.id, title: "Nota no alheio" } })).toBe(0);
  });

  test("PATCH /notes/:id: alheio e inexistente dão o mesmo 404, e a nota não muda", async () => {
    const nota = (await criarNota(dono, { title: "Nota que fica" })).body as NoteDetail;
    const patch = (workspaceId: string) =>
      chamar(app, {
        method: "PATCH",
        url: `/notes/${nota.id}`,
        token: dono.token,
        body: { workspaceId },
      });

    const a = await patch(alheio);
    const b = await patch(INEXISTENTE);

    expect(a.status).toBe(404);
    expect(a).toEqual(b);
    expect(JSON.stringify(a.body)).not.toContain("Segredo do intruso");
    expect((await lerNota(nota.id)).workspaceId).toBeNull();
  });

  test("create_note do chat: alheio e inexistente dão o mesmo erro, e nada é criado", async () => {
    const conversa = await novaConversa(dono);
    const criar = (title: string, workspaceId: string) =>
      executar(
        "create_note",
        { title, contentMd: "corpo", workspaceId },
        contextoDoChat(dono, conversa),
      ).then(
        () => null,
        (erro: { statusCode: number; code: string; message: string }) => ({
          statusCode: erro.statusCode,
          code: erro.code,
          message: erro.message,
        }),
      );

    const a = await criar("Chat no alheio", alheio);
    const b = await criar("Chat no inexistente", INEXISTENTE);

    expect(a).toEqual({ statusCode: 404, code: "NOT_FOUND", message: expect.any(String) });
    expect(a).toEqual(b);
    expect(a?.message).not.toContain("Segredo do intruso");
    expect(await prisma.note.count({ where: { userId: dono.id, title: "Chat no alheio" } })).toBe(0);
  });
});

describe("RF-40: o texto que o MCP e o chat leem traz a marca", () => {
  test("a nota lida por inteiro diz que foi gerada, por quem, por onde e quando", async () => {
    const nota = (
      await criarNota(dono, {
        title: "Nota impressa",
        origin: { via: "mcp", author: "Claude Desktop" },
      })
    ).body as NoteDetail;
    const dia = diaLocal(new Date(nota.ai?.generatedAt ?? ""), FUSO_PADRAO);

    expect(formatarNota(nota, FUSO_PADRAO)).toContain(
      `gerada por IA · Claude Desktop · via mcp · ${dia}`,
    );
  });

  test("a nota revisada ganha 'revisada em'; a humana não ganha linha nenhuma", async () => {
    const gerada = (
      await criarNota(dono, {
        title: "Nota impressa e revisada",
        contentMd: "a",
        origin: { via: "mcp", author: "Claude Desktop" },
      })
    ).body as NoteDetail;
    const revisada = (
      await chamar(app, {
        method: "PATCH",
        url: `/notes/${gerada.id}`,
        token: dono.token,
        body: { contentMd: "b" },
      })
    ).body as NoteDetail;
    const humana = (await criarNota(dono, { title: "Nota impressa humana" })).body as NoteDetail;

    const diaRevisao = diaLocal(new Date(revisada.ai?.revisedAt ?? ""), FUSO_PADRAO);
    expect(formatarNota(revisada, FUSO_PADRAO)).toContain(`revisada em ${diaRevisao}`);
    expect(formatarNota(humana, FUSO_PADRAO)).not.toMatch(/por IA/);
  });

  test("o card lido por inteiro diz 'gerado', no masculino", async () => {
    const card = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Card impresso", origin: { via: "mcp", author: "Cursor" } },
      })
    ).body as CardDetail;
    const dia = diaLocal(new Date(card.ai?.generatedAt ?? ""), FUSO_PADRAO);

    const texto = formatarCardDetalhe(card, FUSO_PADRAO);
    expect(texto).toContain(`gerado por IA · Cursor · via mcp · ${dia}`);
    expect(texto).not.toContain("gerada por IA");
  });

  test("na linha do quadro, o card gerado leva só o sufixo · IA; o humano, nada", async () => {
    const gerado = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Card de linha", origin: { via: "mcp", author: "Cursor" } },
      })
    ).body as CardDetail;
    const humano = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Card de linha humano" },
      })
    ).body as CardDetail;

    // A face vem do quadro, que é de onde `formatarQuadro` a tira.
    const board = (await chamar(app, { method: "GET", url: `/boards/${boardId}`, token: dono.token }))
      .body as BoardDetail;
    const faces = board.columns.flatMap((c) => c.cards);
    const faceGerada = faces.find((c) => c.id === gerado.id);
    const faceHumana = faces.find((c) => c.id === humano.id);
    expect(faceGerada?.ai).not.toBeNull();

    const linhaGerada = formatarCard(faceGerada!, FUSO_PADRAO).split("\n")[0] ?? "";
    const linhaHumana = formatarCard(faceHumana!, FUSO_PADRAO).split("\n")[0] ?? "";
    expect(linhaGerada.endsWith(" · IA")).toBe(true);
    // O detalhe custa token numa lista: autor e data não entram na linha.
    expect(linhaGerada).not.toContain("Cursor");
    expect(linhaHumana).not.toContain("IA");
  });
});

/**
 * Frente de cards, Parte 1: a marca de **quem concluiu**.
 *
 * Não é a marca de geração e não segue as regras dela. A de geração nunca
 * some; esta acompanha o estado — diz quem pôs o card concluído, e vai a
 * `null` quando alguém o reabre ou o conclui à mão. O que as duas têm em comum
 * é a porta: só o servidor grava, pelo contexto do chat ou pelo `origin` do MCP
 * numa rota que o aceita, e o `PATCH` comum não é essa rota.
 */
describe("INV-63: a marca de quem concluiu acompanha o estado, e só o servidor a grava", () => {
  async function novoCard(titulo: string, origin?: Record<string, unknown>): Promise<CardDetail> {
    const r = await chamar(app, {
      method: "POST",
      url: "/cards",
      token: dono.token,
      body: { columnId: colunaId, title: titulo, ...(origin && { origin }) },
    });
    expect(r.status).toBe(201);
    return r.body as CardDetail;
  }

  const concluirPelaRota = (usuario: Usuario, id: string, corpo: Record<string, unknown>) =>
    chamar(app, { method: "PATCH", url: `/cards/${id}/complete`, token: usuario.token, body: corpo });

  const salvarCard = (id: string, corpo: Record<string, unknown>) =>
    chamar(app, { method: "PATCH", url: `/cards/${id}`, token: dono.token, body: corpo });

  const MCP = { via: "mcp", author: "Claude Desktop" };

  test("/complete com origin mcp conclui e grava via mcp e o nome do cliente, sem agente", async () => {
    const card = await novoCard("Concluído pelo MCP");

    const r = await concluirPelaRota(dono, card.id, { completed: true, origin: MCP });

    expect(r.status).toBe(200);
    const concluido = r.body as CardDetail;
    expect(concluido.completedAt).toEqual(expect.any(String));
    expect(concluido.aiCompletion).toEqual({ via: "mcp", author: "Claude Desktop", agentName: null });
    // O que a rota devolveu é o que ficou gravado.
    expect(await lerCard(card.id)).toMatchObject({
      completedAt: concluido.completedAt,
      aiCompletion: concluido.aiCompletion,
    });
  });

  test("ninguém conclui em nome do chat pelo corpo: origin chat em /complete é 422, e o card fica aberto", async () => {
    const card = await novoCard("Falsa conclusão do chat");
    const conversa = await novaConversa(intruso);

    const r = await concluirPelaRota(dono, card.id, {
      completed: true,
      origin: { via: "chat", author: "x", conversationId: conversa },
    });

    expect(r.status).toBe(422);
    const depois = await lerCard(card.id);
    expect(depois.completedAt).toBeNull();
    expect(depois.aiCompletion).toBeNull();
  });

  test("PATCH /cards/:id não grava quem concluiu: origin sozinho é 422, e junto de completed é ignorado", async () => {
    const card = await novoCard("Conclusão à mão com origin");

    const soOrigem = await salvarCard(card.id, { origin: MCP });
    expect(soOrigem.status).toBe(422);
    expect((await lerCard(card.id)).completedAt).toBeNull();

    await salvarCard(card.id, { completed: true, origin: MCP });

    const depois = await lerCard(card.id);
    expect(depois.completedAt).toEqual(expect.any(String));
    expect(depois.aiCompletion).toBeNull();
  });

  test("reabrir apaga a marca, e concluir à mão depois deixa a conclusão sem marca", async () => {
    const card = await novoCard("Concluído, reaberto e concluído à mão");
    await concluirPelaRota(dono, card.id, { completed: true, origin: MCP });

    const reaberto = (await salvarCard(card.id, { completed: false })).body as CardDetail;
    expect(reaberto.completedAt).toBeNull();
    expect(reaberto.aiCompletion).toBeNull();

    const aMao = (await salvarCard(card.id, { completed: true })).body as CardDetail;
    expect(aMao.completedAt).toEqual(expect.any(String));
    expect(aMao.aiCompletion).toBeNull();
  });

  test("concluir de novo um card concluído não troca a data nem quem concluiu, por nenhuma das portas", async () => {
    const card = await novoCard("Reconcluído");
    await concluirPelaRota(dono, card.id, { completed: true, origin: MCP });
    // Data fixa no passado: a mesma requisição no mesmo milissegundo não
    // pode fazer o teste passar por coincidência.
    const antiga = new Date("2026-01-15T12:00:00.000Z");
    await prisma.card.update({ where: { id: card.id }, data: { completedAt: antiga } });

    // O painel do front reenvia `completed` igual a cada salvar.
    await salvarCard(card.id, { completed: true });
    await concluirPelaRota(dono, card.id, {
      completed: true,
      origin: { via: "mcp", author: "Outro cliente" },
    });
    await executar(
      "complete_card",
      { cardId: card.id },
      contextoDoChat(dono, await novaConversa(dono), "estudio/outro"),
    );

    const depois = await lerCard(card.id);
    expect(depois.completedAt).toBe(antiga.toISOString());
    expect(depois.aiCompletion).toEqual({ via: "mcp", author: "Claude Desktop", agentName: null });
  });

  test("RN-11: concluir e reabrir não mexe na marca de geração e não é revisão", async () => {
    const card = await novoCard("Gerado e concluído", { via: "mcp", author: "Cursor" });
    expect(card.ai).not.toBeNull();

    await concluirPelaRota(dono, card.id, { completed: true, origin: MCP });
    expect((await lerCard(card.id)).ai).toEqual(card.ai);

    await salvarCard(card.id, { completed: false });
    await salvarCard(card.id, { completed: true });

    const depois = await lerCard(card.id);
    expect(depois.ai).toEqual(card.ai);
    expect(depois.ai?.revisedAt).toBeNull();
  });

  test("card humano concluído pelo MCP continua humano: concluir não gera a marca de geração", async () => {
    const card = await novoCard("Humano concluído pela IA");

    await concluirPelaRota(dono, card.id, { completed: true, origin: MCP });

    const depois = await lerCard(card.id);
    expect(depois.ai).toBeNull();
    expect(depois.aiCompletion).toMatchObject({ via: "mcp" });
  });
});

describe("o executor de complete_card no chat", () => {
  async function cardHumano(titulo: string): Promise<CardDetail> {
    return (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: titulo },
      })
    ).body as CardDetail;
  }

  test("conclui com a origem do contexto — via chat e o modelo que respondeu — e não conta como criado", async () => {
    const card = await cardHumano("Concluído pelo chat");
    const conversa = await novaConversa(dono);

    const saida = await executar(
      "complete_card",
      { cardId: card.id },
      contextoDoChat(dono, conversa, "estudio/conversa-v3"),
    );

    expect(saida.criados).toEqual([]);
    const depois = await lerCard(card.id);
    expect(depois.completedAt).toEqual(expect.any(String));
    expect(depois.aiCompletion).toEqual({
      via: "chat",
      author: "estudio/conversa-v3",
      agentName: null,
    });
    // O card não virou conteúdo gerado nem saiu do lugar.
    expect(depois.ai).toBeNull();
    expect(depois.columnId).toBe(card.columnId);
    expect(depois.position).toBe(card.position);
    // O que volta ao modelo diz que concluiu, e quem.
    expect(saida.texto).toContain("concluído em");
    expect(saida.texto).toContain("por IA via chat");
  });

  test("numa conversa de agente, a marca leva o nome do agente", async () => {
    const card = await cardHumano("Concluído por agente");
    const conversa = await novaConversa(dono);
    const contexto = contextoDoChat(dono, conversa, "estudio/agente");

    await executar(
      "complete_card",
      { cardId: card.id },
      { ...contexto, origem: { ...contexto.origem, agentName: "Organizador" } },
    );

    expect((await lerCard(card.id)).aiCompletion).toEqual({
      via: "chat",
      author: "estudio/agente",
      agentName: "Organizador",
    });
  });

  test("completed false reabre, e a marca de quem concluiu some junto", async () => {
    const card = await cardHumano("Reaberto pelo chat");
    const contexto = contextoDoChat(dono, await novaConversa(dono));
    await executar("complete_card", { cardId: card.id }, contexto);

    const saida = await executar("complete_card", { cardId: card.id, completed: false }, contexto);

    expect(saida.criados).toEqual([]);
    const depois = await lerCard(card.id);
    expect(depois.completedAt).toBeNull();
    expect(depois.aiCompletion).toBeNull();
    expect(saida.texto).not.toContain("concluído em");
  });

  test("INV-02: card de outra conta é 404 para o modelo, e o card não muda", async () => {
    const card = await cardHumano("Card que o intruso não conclui");
    const conversa = await novaConversa(intruso);

    await expect(
      executar("complete_card", { cardId: card.id }, contextoDoChat(intruso, conversa)),
    ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

    expect((await lerCard(card.id)).completedAt).toBeNull();
  });

  test("RN-14: sem complete_card na lista do agente, o pedido é ferramenta desconhecida", async () => {
    const card = await cardHumano("Card fora do alcance do agente");
    const contexto = contextoDoChat(dono, await novaConversa(dono));

    await expect(
      executar(
        "complete_card",
        { cardId: card.id },
        { ...contexto, permitidas: ["search_notes", "get_board", "create_card"] },
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "VALIDATION_ERROR" });

    expect((await lerCard(card.id)).completedAt).toBeNull();
  });
});

describe("RF-40: o texto que o MCP e o chat leem diz que o card está concluído", () => {
  test("no detalhe, a linha da conclusão diz o dia e, se foi o assistente, por onde, qual agente e quem", async () => {
    const humano = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Detalhe concluído à mão" },
      })
    ).body as CardDetail;
    const aMao = (
      await chamar(app, {
        method: "PATCH",
        url: `/cards/${humano.id}`,
        token: dono.token,
        body: { completed: true },
      })
    ).body as CardDetail;
    const dia = diaLocal(new Date(aMao.completedAt ?? ""), FUSO_PADRAO);

    const textoAMao = formatarCardDetalhe(aMao, FUSO_PADRAO);
    expect(textoAMao).toContain(`concluído em ${dia}`);
    expect(textoAMao).not.toContain("por IA");

    const contexto = contextoDoChat(dono, await novaConversa(dono), "estudio/modelo");
    const outro = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Detalhe concluído por agente" },
      })
    ).body as CardDetail;
    await executar(
      "complete_card",
      { cardId: outro.id },
      { ...contexto, origem: { ...contexto.origem, agentName: "Organizador" } },
    );
    const pelaIa = await lerCard(outro.id);
    const diaIa = diaLocal(new Date(pelaIa.completedAt ?? ""), FUSO_PADRAO);

    expect(formatarCardDetalhe(pelaIa, FUSO_PADRAO)).toContain(
      `concluído em ${diaIa} · por IA via chat · «Organizador» · estudio/modelo`,
    );
  });

  test("na linha do quadro, o concluído vem logo depois do título, antes do prazo", async () => {
    const card = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Linha concluída", dueDate: "2026-01-10T12:00:00.000Z" },
      })
    ).body as CardDetail;
    const aberto = (
      await chamar(app, {
        method: "POST",
        url: "/cards",
        token: dono.token,
        body: { columnId: colunaId, title: "Linha aberta" },
      })
    ).body as CardDetail;
    await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { completed: true },
    });

    const board = (await chamar(app, { method: "GET", url: `/boards/${boardId}`, token: dono.token }))
      .body as BoardDetail;
    const faces = board.columns.flatMap((c) => c.cards);
    const face = faces.find((c) => c.id === card.id);
    const faceAberta = faces.find((c) => c.id === aberto.id);

    const linha = formatarCard(face!, FUSO_PADRAO).split("\n")[0] ?? "";
    // Um prazo passado lido antes de "concluído" parece atraso.
    expect(linha.startsWith("- Linha concluída · concluído · prazo ")).toBe(true);
    expect(formatarCard(faceAberta!, FUSO_PADRAO)).not.toContain("concluído");
  });
});
