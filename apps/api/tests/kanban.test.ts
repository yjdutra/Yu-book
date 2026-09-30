import type {
  BoardDetail,
  CardDetail,
  NoteDetail,
  SearchResponse,
  Workspace,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

let app: FastifyInstance;
let dono: Usuario;
let intruso: Usuario;
let workspaceId: string;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("dono");
  intruso = await criarUsuario("intruso");

  const workspace = await prisma.workspace.create({
    data: { userId: dono.id, name: "Coders" },
  });
  workspaceId = workspace.id;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

async function novoBoard(nome: string): Promise<BoardDetail> {
  const { body } = await chamar(app, {
    method: "POST",
    url: "/boards",
    token: dono.token,
    body: { name: nome, workspaceId },
  });
  return body as BoardDetail;
}

async function novoCard(columnId: string, title: string): Promise<CardDetail> {
  const { body } = await chamar(app, {
    method: "POST",
    url: "/cards",
    token: dono.token,
    body: { columnId, title },
  });
  return body as CardDetail;
}

describe("boards e colunas", () => {
  // CA-07 / RF-14
  test("board novo nasce com A fazer, Fazendo e Feito", async () => {
    const board = await novoBoard("Board padrão");
    expect(board.columns.map((c) => c.name)).toEqual(["A fazer", "Fazendo", "Feito"]);
    expect(board.columns.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  // CA-09 / RF-17 / RN-01
  test("mover coluna renumera as posições sem buraco", async () => {
    const board = await novoBoard("Board de colunas");
    const ultima = board.columns[2];

    const { status, body } = await chamar(app, {
      method: "PATCH",
      url: `/columns/${ultima?.id}/move`,
      token: dono.token,
      body: { position: 0 },
    });

    expect(status).toBe(200);
    const depois = body as BoardDetail;
    expect(depois.columns.map((c) => c.name)).toEqual(["Feito", "A fazer", "Fazendo"]);
    expect(depois.columns.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  // CA-08 / RF-16
  test("excluir coluna com cards exige dizer o que fazer com eles", async () => {
    const board = await novoBoard("Board de exclusão");
    const [origem, destino] = board.columns;
    await novoCard(origem?.id as string, "Card A");
    await novoCard(origem?.id as string, "Card B");
    await novoCard(destino?.id as string, "Já estava aqui");

    const recusa = await chamar(app, {
      method: "DELETE",
      url: `/columns/${origem?.id}`,
      token: dono.token,
    });
    expect(recusa.status).toBe(409);
    expect((recusa.body as { error: { code: string } }).error.code).toBe("COLUNA_COM_CARDS");

    const movida = await chamar(app, {
      method: "DELETE",
      url: `/columns/${origem?.id}?moveCardsTo=${destino?.id}`,
      token: dono.token,
    });
    expect(movida.status).toBe(200);

    const depois = movida.body as BoardDetail;
    const coluna = depois.columns.find((c) => c.id === destino?.id);
    expect(coluna?.cards.map((c) => c.title)).toEqual(["Já estava aqui", "Card A", "Card B"]);
    expect(coluna?.cards.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(depois.columns.map((c) => c.position)).toEqual([0, 1]);
  });

  test("excluir coluna com deleteCards leva os cards junto", async () => {
    const board = await novoBoard("Board de exclusão total");
    const alvo = board.columns[0];
    const card = await novoCard(alvo?.id as string, "Some junto");

    const { status } = await chamar(app, {
      method: "DELETE",
      url: `/columns/${alvo?.id}?deleteCards=true`,
      token: dono.token,
    });

    expect(status).toBe(200);
    expect(await prisma.card.findUnique({ where: { id: card.id } })).toBeNull();
  });

  // CA-10 / RN-05
  test("limite de WIP avisa, mas não bloqueia o movimento", async () => {
    const board = await novoBoard("Board com WIP");
    const [aFazer, fazendo] = board.columns;

    await chamar(app, {
      method: "PATCH",
      url: `/columns/${fazendo?.id}`,
      token: dono.token,
      body: { wipLimit: 1 },
    });

    await novoCard(fazendo?.id as string, "Já em andamento");
    const extra = await novoCard(aFazer?.id as string, "Estoura o limite");

    const { status } = await chamar(app, {
      method: "PATCH",
      url: `/cards/${extra.id}/move`,
      token: dono.token,
      body: { columnId: fazendo?.id, position: 0 },
    });

    expect(status).toBe(200);
    const atual = await prisma.card.count({ where: { columnId: fazendo?.id, archived: false } });
    expect(atual).toBe(2);
  });
});

describe("cards", () => {
  // CA-21 / RF-33
  test("arquivar tira do board e desarquivar devolve ao fim da coluna", async () => {
    const board = await novoBoard("Board de arquivo");
    const coluna = board.columns[0];
    const primeiro = await novoCard(coluna?.id as string, "Primeiro");
    await novoCard(coluna?.id as string, "Segundo");

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${primeiro.id}`,
      token: dono.token,
      body: { archived: true },
    });

    const noBoard = await chamar(app, {
      method: "GET",
      url: `/boards/${board.id}`,
      token: dono.token,
    });
    const semArquivado = noBoard.body as BoardDetail;
    const colunaDepois = semArquivado.columns.find((c) => c.id === coluna?.id);
    expect(colunaDepois?.cards.map((c) => c.title)).toEqual(["Segundo"]);
    expect(colunaDepois?.cards.map((c) => c.position)).toEqual([0]);
    expect(semArquivado.archivedCount).toBe(1);

    const arquivados = await chamar(app, {
      method: "GET",
      url: `/boards/${board.id}/archived`,
      token: dono.token,
    });
    expect((arquivados.body as { id: string }[]).map((c) => c.id)).toEqual([primeiro.id]);

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${primeiro.id}`,
      token: dono.token,
      body: { archived: false },
    });

    const volta = await chamar(app, {
      method: "GET",
      url: `/boards/${board.id}`,
      token: dono.token,
    });
    const colunaFinal = (volta.body as BoardDetail).columns.find((c) => c.id === coluna?.id);
    expect(colunaFinal?.cards.map((c) => c.title)).toEqual(["Segundo", "Primeiro"]);
    expect(colunaFinal?.cards.map((c) => c.position)).toEqual([0, 1]);
  });

  // CA-23 / RF-38 e CA-26 / RN-07
  test("nota mostra os cards que a referenciam; lixeira desfaz o vínculo", async () => {
    const board = await novoBoard("Board da nota");
    const coluna = board.columns[0];
    const card = await novoCard(coluna?.id as string, "Exercício de JWT");

    const nota = (
      await chamar(app, {
        method: "POST",
        url: "/notes",
        token: dono.token,
        body: { title: "Autenticação com JWT", kind: "aula", workspaceId },
      })
    ).body as NoteDetail;

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { noteId: nota.id },
    });

    const comCard = (
      await chamar(app, { method: "GET", url: `/notes/${nota.id}`, token: dono.token })
    ).body as NoteDetail;

    expect(comCard.cards).toHaveLength(1);
    expect(comCard.cards[0]).toMatchObject({
      id: card.id,
      title: "Exercício de JWT",
      boardId: board.id,
      columnName: coluna?.name,
    });

    await chamar(app, { method: "DELETE", url: `/notes/${nota.id}`, token: dono.token });

    const depois = (
      await chamar(app, { method: "GET", url: `/cards/${card.id}`, token: dono.token })
    ).body as CardDetail;
    expect(depois.note).toBeNull();
  });
});

/* Tags do card — Fase 5, Etapa A. */
describe("tags do card", () => {
  /** Atalho: aplica tags e devolve o card já salvo. */
  async function comTags(cardId: string, tags: string[]) {
    const { status, body } = await chamar(app, {
      method: "PATCH",
      url: `/cards/${cardId}`,
      token: dono.token,
      body: { tags },
    });
    return { status, card: body as CardDetail };
  }

  // CA-04 / RN-01
  test("normaliza: corta espaço e cerquilha, colapsa espaço e baixa a caixa", async () => {
    const board = await novoBoard("Board de tags");
    const card = await novoCard(board.columns[0]?.id as string, "Card com tag");

    const { card: salvo } = await comTags(card.id, ["  #Banco   De Dados  ", "", "   "]);
    expect(salvo.tags).toEqual(["banco de dados"]);
  });

  // CA-02 / RN-02
  test("funde tags que só diferem por acento ou caixa, mantendo a primeira grafia", async () => {
    const board = await novoBoard("Board de acento");
    const card = await novoCard(board.columns[0]?.id as string, "Card com acento");

    const { card: salvo } = await comTags(card.id, ["Revisão", "revisao", "REVISÃO"]);
    expect(salvo.tags).toEqual(["revisão"]);
  });

  // CA-04: tamanho é cosmético — corta, não recusa.
  test("tag longa demais é cortada em 24 caracteres, não recusada", async () => {
    const board = await novoBoard("Board de tag longa");
    const card = await novoCard(board.columns[0]?.id as string, "Card longo");

    const { status, card: salvo } = await comTags(card.id, ["a".repeat(40)]);
    expect(status).toBe(200);
    expect(salvo.tags).toEqual(["a".repeat(24)]);
  });

  // CA-03: quantidade é limite — recusa.
  test("passar de 8 tags é recusado com 422 e não grava nada", async () => {
    const board = await novoBoard("Board de limite");
    const card = await novoCard(board.columns[0]?.id as string, "Card no limite");

    const oito = Array.from({ length: 8 }, (_, i) => `tag-${i}`);
    const { card: salvo } = await comTags(card.id, oito);
    expect(salvo.tags).toHaveLength(8);

    const { status } = await comTags(card.id, [...oito, "tag-8"]);
    expect(status).toBe(422);

    const depois = (
      await chamar(app, { method: "GET", url: `/cards/${card.id}`, token: dono.token })
    ).body as CardDetail;
    expect(depois.tags).toEqual(oito);
  });

  // CA-05: a tag é do quadro, então vem na face — sem uma requisição por card.
  test("GET /boards/:id devolve as tags na face de cada card", async () => {
    const board = await novoBoard("Board na face");
    const coluna = board.columns[0];
    const card = await novoCard(coluna?.id as string, "Card visível");
    await comTags(card.id, ["sql"]);

    const { body } = await chamar(app, {
      method: "GET",
      url: `/boards/${board.id}`,
      token: dono.token,
    });
    const face = (body as BoardDetail).columns
      .find((c) => c.id === coluna?.id)
      ?.cards.find((c) => c.id === card.id);
    expect(face?.tags).toEqual(["sql"]);
  });

  // O espalhamento condicional de `atualizarCard`: salvar outro campo não pode
  // apagar as tags. É o caminho que o autosave da descrição percorre a cada
  // pausa de digitação.
  test("salvar só o título preserva as tags", async () => {
    const board = await novoBoard("Board de preservação");
    const card = await novoCard(board.columns[0]?.id as string, "Antes");
    await comTags(card.id, ["indices", "revisão"]);

    const { body } = await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { title: "Depois" },
    });
    expect((body as CardDetail).tags).toEqual(["indices", "revisão"]);
  });

  // RN-04: tag não participa de posição nem de arquivamento.
  test("mover e arquivar preservam as tags", async () => {
    const board = await novoBoard("Board de movimento");
    const [origem, destino] = board.columns;
    const card = await novoCard(origem?.id as string, "Card viajante");
    await comTags(card.id, ["entrevista"]);

    const movido = (
      await chamar(app, {
        method: "PATCH",
        url: `/cards/${card.id}/move`,
        token: dono.token,
        body: { columnId: destino?.id, position: 0 },
      })
    ).body as CardDetail;
    expect(movido.tags).toEqual(["entrevista"]);

    const arquivado = (
      await chamar(app, {
        method: "PATCH",
        url: `/cards/${card.id}`,
        token: dono.token,
        body: { archived: true },
      })
    ).body as CardDetail;
    expect(arquivado.tags).toEqual(["entrevista"]);
  });

  test("card novo nasce sem tags", async () => {
    const board = await novoBoard("Board sem tag");
    const card = await novoCard(board.columns[0]?.id as string, "Card pelado");
    expect(card.tags).toEqual([]);
  });
});

// CA-32 / RNF-14 / RNF-15
describe("posse", () => {
  test("id de outro usuário responde 404 em board, coluna e card", async () => {
    const board = await novoBoard("Board privado");
    const coluna = board.columns[0];
    const card = await novoCard(coluna?.id as string, "Só do dono");

    const tentativas = [
      { method: "GET", url: `/boards/${board.id}` },
      { method: "PATCH", url: `/boards/${board.id}`, body: { name: "invadido" } },
      { method: "DELETE", url: `/columns/${coluna?.id}` },
      { method: "PATCH", url: `/columns/${coluna?.id}`, body: { name: "invadida" } },
      { method: "GET", url: `/cards/${card.id}` },
      { method: "PATCH", url: `/cards/${card.id}`, body: { title: "invadido" } },
      { method: "PATCH", url: `/cards/${card.id}/move`, body: { columnId: coluna?.id, position: 0 } },
      { method: "PATCH", url: `/cards/${card.id}`, body: { completed: true } },
      { method: "PATCH", url: `/cards/${card.id}/complete`, body: { completed: true } },
      { method: "DELETE", url: `/cards/${card.id}` },
    ] as const;

    for (const tentativa of tentativas) {
      const { status } = await chamar(app, { ...tentativa, token: intruso.token });
      expect(status, `${tentativa.method} ${tentativa.url}`).toBe(404);
    }

    // Nada foi tocado.
    const intacto = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(intacto.title).toBe("Só do dono");
    expect(intacto.completedAt).toBeNull();
  });
});

/**
 * Frente de cards, Parte 1: concluir é um estado do card, não um lugar.
 *
 * O card concluído fica na coluna e na posição em que estava — mover para
 * "Feito" continua sendo outra coisa, feita pelo arraste. Por isso a conclusão
 * não pode renumerar nada (INV-11) e aparece na face do card, no quadro.
 */
describe("conclusão do card", () => {
  const concluir = (id: string, completed: boolean, token = dono.token) =>
    chamar(app, { method: "PATCH", url: `/cards/${id}`, token, body: { completed } });

  const lerBoard = async (id: string) =>
    (await chamar(app, { method: "GET", url: `/boards/${id}`, token: dono.token }))
      .body as BoardDetail;

  test("INV-11: concluir não move o card nem renumera a coluna, e a face no quadro diz que está concluído", async () => {
    const board = await novoBoard("Board de conclusão");
    const coluna = board.columns[0]?.id as string;
    await novoCard(coluna, "Antes");
    const meio = await novoCard(coluna, "Concluído no meio");
    await novoCard(coluna, "Depois");

    const r = await concluir(meio.id, true);

    expect(r.status).toBe(200);
    const detalhe = r.body as CardDetail;
    expect(detalhe).toMatchObject({ columnId: coluna, position: 1, aiCompletion: null });
    expect(detalhe.completedAt).toEqual(expect.any(String));

    const cards = (await lerBoard(board.id)).columns.find((c) => c.id === coluna)?.cards ?? [];
    expect(cards.map((c) => c.title)).toEqual(["Antes", "Concluído no meio", "Depois"]);
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(cards.map((c) => c.completedAt !== null)).toEqual([false, true, false]);
    expect(cards[1]?.completedAt).toBe(detalhe.completedAt);
  });

  test("concluir de novo um card concluído mantém a data da primeira conclusão", async () => {
    const board = await novoBoard("Board de reconclusão");
    const card = await novoCard(board.columns[0]?.id as string, "Concluído duas vezes");
    await concluir(card.id, true);
    // Data fixa no passado: sem ela, duas conclusões no mesmo milissegundo
    // passariam pelo teste mesmo regravando a data.
    const primeira = new Date("2026-02-01T09:00:00.000Z");
    await prisma.card.update({ where: { id: card.id }, data: { completedAt: primeira } });

    const deNovo = await concluir(card.id, true);
    const pelaRota = await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}/complete`,
      token: dono.token,
      body: { completed: true },
    });

    expect(deNovo.status).toBe(200);
    expect(pelaRota.status).toBe(200);
    expect((pelaRota.body as CardDetail).completedAt).toBe(primeira.toISOString());
  });

  test("reabrir zera a conclusão, pelas duas rotas", async () => {
    const board = await novoBoard("Board de reabertura");
    const coluna = board.columns[0]?.id as string;
    const umCard = await novoCard(coluna, "Reaberto pelo PATCH");
    const outro = await novoCard(coluna, "Reaberto pela rota própria");
    await concluir(umCard.id, true);
    await concluir(outro.id, true);

    const a = (await concluir(umCard.id, false)).body as CardDetail;
    const b = (
      await chamar(app, {
        method: "PATCH",
        url: `/cards/${outro.id}/complete`,
        token: dono.token,
        body: { completed: false },
      })
    ).body as CardDetail;

    for (const reaberto of [a, b]) {
      expect(reaberto.completedAt).toBeNull();
      expect(reaberto.aiCompletion).toBeNull();
    }
    const cards = (await lerBoard(board.id)).columns.find((c) => c.id === coluna)?.cards ?? [];
    expect(cards.every((c) => c.completedAt === null)).toBe(true);
  });

  test("INV-02 / INV-03: /complete em card de outra conta responde como o inexistente, e o card não muda", async () => {
    const board = await novoBoard("Board que o intruso tenta concluir");
    const card = await novoCard(board.columns[0]?.id as string, "Não é do intruso");
    const tentar = (id: string) =>
      chamar(app, {
        method: "PATCH",
        url: `/cards/${id}/complete`,
        token: intruso.token,
        body: { completed: true, origin: { via: "mcp", author: "Intruso" } },
      });

    const alheio = await tentar(card.id);
    const inexistente = await tentar("00000000-0000-4000-8000-000000000000");

    expect(alheio.status).toBe(404);
    expect(alheio).toEqual(inexistente);
    const intacto = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(intacto.completedAt).toBeNull();
    expect(intacto.aiCompletedVia).toBeNull();
  });

  test("card arquivado pode ser concluído, e volta concluído ao desarquivar", async () => {
    const board = await novoBoard("Board de arquivado concluído");
    const coluna = board.columns[0]?.id as string;
    const card = await novoCard(coluna, "Arquivado e concluído");
    await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { archived: true },
    });

    const r = await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}/complete`,
      token: dono.token,
      body: { completed: true },
    });

    expect(r.status).toBe(200);
    const concluido = r.body as CardDetail;
    expect(concluido.archived).toBe(true);
    expect(concluido.completedAt).toEqual(expect.any(String));
    // Sem origin, é humano, mesmo pela rota própria.
    expect(concluido.aiCompletion).toBeNull();

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { archived: false },
    });
    const face = (await lerBoard(board.id)).columns
      .find((c) => c.id === coluna)
      ?.cards.find((c) => c.id === card.id);
    expect(face?.completedAt).toBe(concluido.completedAt);
  });
});

describe("busca", () => {
  // CA-27, CA-28, CA-29
  test("card aparece na paleta, tipo:card filtra e arquivado some", async () => {
    const board = await novoBoard("Board da busca");
    const coluna = board.columns[0];
    const card = await novoCard(coluna?.id as string, "Exercício de JWT na busca");

    const busca = (
      await chamar(app, {
        method: "GET",
        url: "/search?q=exercicio%20jwt",
        token: dono.token,
      })
    ).body as SearchResponse;

    const achado = busca.results.find((r) => r.id === card.id);
    expect(achado).toBeDefined();
    expect(achado?.type).toBe("card");
    expect(achado?.boardName).toBe("Board da busca");
    expect(achado?.columnName).toBe(coluna?.name);

    const soCards = (
      await chamar(app, {
        method: "GET",
        url: "/search?q=tipo%3Acard%20exercicio",
        token: dono.token,
      })
    ).body as SearchResponse;
    expect(soCards.results.length).toBeGreaterThan(0);
    expect(soCards.results.every((r) => r.type === "card")).toBe(true);
    expect(soCards.filtros.card).toBe(true);

    await chamar(app, {
      method: "PATCH",
      url: `/cards/${card.id}`,
      token: dono.token,
      body: { archived: true },
    });

    const depois = (
      await chamar(app, {
        method: "GET",
        url: "/search?q=tipo%3Acard%20exercicio",
        token: dono.token,
      })
    ).body as SearchResponse;
    expect(depois.results.some((r) => r.id === card.id)).toBe(false);
  });

  // CA-01 (lado da API) / RF-02
  test("workspaceId restringe a busca ao workspace ativo", async () => {
    const outro = await prisma.workspace.create({
      data: { userId: dono.id, name: "Trabalho" },
    });
    const board = (
      await chamar(app, {
        method: "POST",
        url: "/boards",
        token: dono.token,
        body: { name: "Board do trabalho", workspaceId: outro.id },
      })
    ).body as BoardDetail;
    const fora = await novoCard(board.columns[0]?.id as string, "Escopo de outro workspace");

    const doWorkspace = (
      await chamar(app, {
        method: "GET",
        url: `/search?q=escopo&workspaceId=${workspaceId}`,
        token: dono.token,
      })
    ).body as SearchResponse;
    expect(doWorkspace.results.some((r) => r.id === fora.id)).toBe(false);

    const semEscopo = (
      await chamar(app, { method: "GET", url: "/search?q=escopo", token: dono.token })
    ).body as SearchResponse;
    expect(semEscopo.results.some((r) => r.id === fora.id)).toBe(true);
  });
});

// CA-05 / RF-09
test("workspace informa quantos boards e cards perde na exclusão", async () => {
  const workspace = await prisma.workspace.create({
    data: { userId: dono.id, name: "Contagem" },
  });
  const board = (
    await chamar(app, {
      method: "POST",
      url: "/boards",
      token: dono.token,
      body: { name: "Board contado", workspaceId: workspace.id },
    })
  ).body as BoardDetail;
  await novoCard(board.columns[0]?.id as string, "Um");
  await novoCard(board.columns[1]?.id as string, "Dois");

  const workspaces = (
    await chamar(app, { method: "GET", url: "/workspaces", token: dono.token })
  ).body as Workspace[];

  const contado = workspaces.find((w) => w.id === workspace.id);
  expect(contado?.boardCount).toBe(1);
  expect(contado?.cardCount).toBe(2);
});
