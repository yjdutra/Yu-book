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
      { method: "DELETE", url: `/cards/${card.id}` },
    ] as const;

    for (const tentativa of tentativas) {
      const { status } = await chamar(app, { ...tentativa, token: intruso.token });
      expect(status, `${tentativa.method} ${tentativa.url}`).toBe(404);
    }

    // Nada foi tocado.
    const intacto = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(intacto.title).toBe("Só do dono");
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
