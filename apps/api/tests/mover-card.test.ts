import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { chamar, criarUsuario, limpar, sorteio, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

let app: FastifyInstance;
let dono: Usuario;
let boardId: string;
let colunas: string[];
let outroBoardColuna: string;

beforeAll(async () => {
  await limpar();
  app = await subirApp();
  dono = await criarUsuario("dono");

  const workspace = await prisma.workspace.create({
    data: { userId: dono.id, name: "Coders" },
  });

  const board = await prisma.board.create({
    data: {
      userId: dono.id,
      workspaceId: workspace.id,
      name: "Módulo 3",
      columns: {
        create: [
          { name: "A fazer", position: 0 },
          { name: "Fazendo", position: 1 },
          { name: "Feito", position: 2 },
        ],
      },
    },
    include: { columns: { orderBy: { position: "asc" } } },
  });

  boardId = board.id;
  colunas = board.columns.map((c) => c.id);

  // 12 cards espalhados: 5, 4 e 3.
  for (const [indiceColuna, quantidade] of [5, 4, 3].entries()) {
    for (let i = 0; i < quantidade; i++) {
      await prisma.card.create({
        data: {
          columnId: colunas[indiceColuna] as string,
          title: `Card ${indiceColuna}-${i}`,
          position: i,
        },
      });
    }
  }

  const outro = await prisma.board.create({
    data: {
      userId: dono.id,
      workspaceId: workspace.id,
      name: "Outro board",
      columns: { create: [{ name: "Única", position: 0 }] },
    },
    include: { columns: true },
  });
  outroBoardColuna = outro.columns[0]?.id as string;
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

/** RN-01: posições contíguas a partir de 0, sem buraco e sem repetição. */
async function conferirContiguidade(): Promise<void> {
  const atuais = await prisma.boardColumn.findMany({
    where: { boardId },
    include: { cards: { where: { archived: false }, orderBy: { position: "asc" } } },
  });

  for (const coluna of atuais) {
    const posicoes = coluna.cards.map((c) => c.position);
    expect(posicoes, `coluna ${coluna.name}`).toEqual(posicoes.map((_, i) => i));
  }
}

// CA-17 / M4
test("200 movimentos aleatórios não deixam posição repetida nem com buraco", async () => {
  const proximo = sorteio(20260814);

  for (let rodada = 0; rodada < 200; rodada++) {
    const cards = await prisma.card.findMany({
      where: { column: { boardId }, archived: false },
      select: { id: true, columnId: true },
    });

    const card = cards[proximo(cards.length)];
    const destino = colunas[proximo(colunas.length)] as string;
    const noDestino = cards.filter((c) => c.columnId === destino && c.id !== card?.id).length;
    const position = proximo(noDestino + 1);

    const { status } = await chamar(app, {
      method: "PATCH",
      url: `/cards/${card?.id}/move`,
      token: dono.token,
      body: { columnId: destino, position },
    });

    expect(status, `rodada ${rodada}`).toBe(200);
    await conferirContiguidade();
  }

  const total = await prisma.card.count({ where: { column: { boardId } } });
  expect(total).toBe(12);
});

// RN-02
test("posição além do fim da coluna é ajustada, não recusada", async () => {
  const alvo = await prisma.card.findFirstOrThrow({
    where: { column: { boardId } },
    select: { id: true },
  });

  const { status } = await chamar(app, {
    method: "PATCH",
    url: `/cards/${alvo.id}/move`,
    token: dono.token,
    body: { columnId: colunas[0], position: 999 },
  });

  expect(status).toBe(200);

  const naColuna = await prisma.card.findMany({
    where: { columnId: colunas[0], archived: false },
    orderBy: { position: "asc" },
  });
  expect(naColuna.at(-1)?.id).toBe(alvo.id);
  await conferirContiguidade();
});

// RN-04
test("card não atravessa boards", async () => {
  const alvo = await prisma.card.findFirstOrThrow({
    where: { column: { boardId } },
    select: { id: true, columnId: true },
  });

  const { status } = await chamar(app, {
    method: "PATCH",
    url: `/cards/${alvo.id}/move`,
    token: dono.token,
    body: { columnId: outroBoardColuna, position: 0 },
  });

  expect(status).toBe(422);

  const depois = await prisma.card.findUniqueOrThrow({ where: { id: alvo.id } });
  expect(depois.columnId).toBe(alvo.columnId);
});
