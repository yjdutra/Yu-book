import { Prisma } from "@prisma/client";
import type {
  BoardDetail,
  BoardInput,
  CardDetail,
  CardInput,
  CardMoveInput,
  CardRef,
  CardSummary,
  CardUpdateInput,
  BoardSummary,
  ColumnInput,
} from "@yu-book/shared";
import { MAX_COLUNAS, progressoChecklist } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";

/** Colunas de um board novo (RF-14, S-03): board sem coluna é estado morto. */
const COLUNAS_PADRAO = ["A fazer", "Fazendo", "Feito"];

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

const nomeDuplicado = (o: string) => new AppError(409, "NOME_DUPLICADO", `Já existe ${o}`);

function ehDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

/* ------------------------------------------------------------------ posse
 *
 * RNF-14: `card` e `board_column` não têm `user_id`. A posse é sempre
 * resolvida pela cadeia card → coluna → board → usuário DENTRO da mesma
 * query — nunca "busca primeiro, confere depois", que abre janela para id
 * de outro usuário passar.
 *
 * RNF-15: id de outro usuário é indistinguível de id inexistente (404).
 */

type Cliente = Prisma.TransactionClient | typeof prisma;

async function colunaDoUsuario(db: Cliente, userId: string, columnId: string) {
  const coluna = await db.boardColumn.findFirst({
    where: { id: columnId, board: { userId } },
    select: { id: true, boardId: true, name: true, wipLimit: true },
  });
  if (!coluna) throw notFound("Coluna não encontrada");
  return coluna;
}

async function cardDoUsuario(db: Cliente, userId: string, cardId: string) {
  const card = await db.card.findFirst({
    where: { id: cardId, column: { board: { userId } } },
    select: {
      id: true,
      columnId: true,
      archived: true,
      column: { select: { boardId: true } },
    },
  });
  if (!card) throw notFound("Card não encontrado");
  return card;
}

async function boardDoUsuario(db: Cliente, userId: string, boardId: string) {
  const board = await db.board.findFirst({
    where: { id: boardId, userId },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!board) throw notFound("Board não encontrado");
  return board;
}

/* ------------------------------------------------------------ ordenação */

/**
 * RN-01: reescreve `position` como 0,1,2… na ordem recebida.
 *
 * Um `UPDATE … FROM (VALUES …)` por coluna afetada — no máximo duas por
 * movimento —, sempre dentro da transação de quem chama (RNF-17). Fazer um
 * update por card custaria N viagens ao banco.
 */
async function renumerarCards(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const valores = Prisma.join(ids.map((id, i) => Prisma.sql`(${id}::uuid, ${i}::int)`));
  await tx.$executeRaw`
    UPDATE card SET position = v.pos
    FROM (VALUES ${valores}) AS v(id, pos)
    WHERE card.id = v.id
  `;
}

async function renumerarColunas(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const valores = Prisma.join(ids.map((id, i) => Prisma.sql`(${id}::uuid, ${i}::int)`));
  await tx.$executeRaw`
    UPDATE board_column SET position = v.pos
    FROM (VALUES ${valores}) AS v(id, pos)
    WHERE board_column.id = v.id
  `;
}

/**
 * Ordem atual dos cards ativos de uma coluna.
 *
 * Card arquivado fica de fora da contagem e da renumeração: a contiguidade
 * de RN-01 vale para o que está no board. Desarquivar devolve o card ao fim
 * da coluna (RF-33).
 */
function idsAtivos(db: Cliente, columnId: string, exceto?: string) {
  return db.card.findMany({
    where: { columnId, archived: false, ...(exceto && { NOT: { id: exceto } }) },
    orderBy: { position: "asc" },
    select: { id: true },
  });
}

/* -------------------------------------------------------------- conversão */

const CARD_FACE = {
  id: true,
  columnId: true,
  title: true,
  position: true,
  dueDate: true,
  priority: true,
  checklist: true,
  note: { select: { id: true, title: true, kind: true } },
} satisfies Prisma.CardSelect;

type CardFace = Prisma.CardGetPayload<{ select: typeof CARD_FACE }>;

function toCardSummary(card: CardFace): CardSummary {
  const { done, total } = progressoChecklist(card.checklist);
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    position: card.position,
    dueDate: card.dueDate?.toISOString() ?? null,
    priority: card.priority,
    checklistDone: done,
    checklistTotal: total,
    note: card.note,
  };
}

/* ------------------------------------------------------------------ boards */

export async function listarBoards(userId: string, workspaceId?: string): Promise<BoardSummary[]> {
  const boards = await prisma.board.findMany({
    where: { userId, ...(workspaceId && { workspaceId }) },
    orderBy: [{ workspace: { name: "asc" } }, { name: "asc" }],
    include: {
      workspace: { select: { name: true, color: true } },
      columns: { select: { _count: { select: { cards: { where: { archived: false } } } } } },
    },
  });

  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    workspaceId: b.workspaceId,
    workspaceName: b.workspace.name,
    workspaceColor: b.workspace.color,
    columnCount: b.columns.length,
    cardCount: b.columns.reduce((soma, c) => soma + c._count.cards, 0),
  }));
}

export async function criarBoard(userId: string, input: BoardInput): Promise<BoardDetail> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: input.workspaceId, userId },
    select: { id: true },
  });
  // RN-03: board sem workspace não existe.
  if (!workspace) throw notFound("Workspace não encontrado");

  try {
    const id = await prisma.$transaction(async (tx) => {
      const maior = await tx.board.aggregate({
        where: { userId, workspaceId: workspace.id },
        _max: { position: true },
      });

      const board = await tx.board.create({
        data: {
          userId,
          workspaceId: workspace.id,
          name: input.name,
          position: (maior._max.position ?? -1) + 1,
          columns: {
            create: COLUNAS_PADRAO.map((name, position) => ({ name, position })),
          },
        },
      });
      return board.id;
    });

    return buscarBoard(userId, id);
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`um board chamado "${input.name}" neste workspace`);
    throw erro;
  }
}

/** RF-13: colunas e cards em uma requisição só. */
export async function buscarBoard(userId: string, id: string): Promise<BoardDetail> {
  const board = await prisma.board.findFirst({
    where: { id, userId },
    include: {
      workspace: { select: { name: true } },
      columns: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            where: { archived: false },
            orderBy: { position: "asc" },
            select: CARD_FACE,
          },
        },
      },
    },
  });
  if (!board) throw notFound("Board não encontrado");

  const archivedCount = await prisma.card.count({
    where: { column: { boardId: id }, archived: true },
  });

  return {
    id: board.id,
    name: board.name,
    workspaceId: board.workspaceId,
    workspaceName: board.workspace.name,
    archivedCount,
    columns: board.columns.map((c) => ({
      id: c.id,
      name: c.name,
      position: c.position,
      wipLimit: c.wipLimit,
      cards: c.cards.map(toCardSummary),
    })),
  };
}

export async function atualizarBoard(
  userId: string,
  id: string,
  input: { name: string },
): Promise<BoardDetail> {
  await boardDoUsuario(prisma, userId, id);
  try {
    await prisma.board.update({ where: { id }, data: { name: input.name } });
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`um board chamado "${input.name}" neste workspace`);
    throw erro;
  }
  return buscarBoard(userId, id);
}

export async function excluirBoard(userId: string, id: string): Promise<void> {
  const { count } = await prisma.board.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Board não encontrado");
}

/** RF-33: o que saiu do board, sem sair do banco. */
export async function listarArquivados(userId: string, boardId: string): Promise<CardSummary[]> {
  await boardDoUsuario(prisma, userId, boardId);
  const cards = await prisma.card.findMany({
    where: { column: { boardId }, archived: true },
    orderBy: { updatedAt: "desc" },
    select: CARD_FACE,
  });
  return cards.map(toCardSummary);
}

/* ----------------------------------------------------------------- colunas */

export async function criarColuna(userId: string, input: ColumnInput): Promise<BoardDetail> {
  await boardDoUsuario(prisma, userId, input.boardId);

  const total = await prisma.boardColumn.count({ where: { boardId: input.boardId } });
  if (total >= MAX_COLUNAS) throw invalido(`Um board tem no máximo ${MAX_COLUNAS} colunas`);

  try {
    await prisma.boardColumn.create({
      data: {
        boardId: input.boardId,
        name: input.name,
        wipLimit: input.wipLimit ?? null,
        position: total,
      },
    });
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`uma coluna chamada "${input.name}" neste board`);
    throw erro;
  }

  return buscarBoard(userId, input.boardId);
}

export async function atualizarColuna(
  userId: string,
  id: string,
  input: { name?: string; wipLimit?: number | null },
): Promise<BoardDetail> {
  const coluna = await colunaDoUsuario(prisma, userId, id);

  try {
    await prisma.boardColumn.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.wipLimit !== undefined && { wipLimit: input.wipLimit }),
      },
    });
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`uma coluna chamada "${input.name}" neste board`);
    throw erro;
  }

  return buscarBoard(userId, coluna.boardId);
}

export async function moverColuna(
  userId: string,
  id: string,
  position: number,
): Promise<BoardDetail> {
  const coluna = await colunaDoUsuario(prisma, userId, id);

  await prisma.$transaction(async (tx) => {
    const outras = await tx.boardColumn.findMany({
      where: { boardId: coluna.boardId, NOT: { id } },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    const indice = Math.min(Math.max(position, 0), outras.length);
    const ordem = outras.map((c) => c.id);
    ordem.splice(indice, 0, id);
    await renumerarColunas(tx, ordem);
  });

  return buscarBoard(userId, coluna.boardId);
}

/**
 * RF-16: com cards dentro, a chamada precisa dizer o que fazer com eles.
 * Sem `moveCardsTo` nem `deleteCards`, recusamos — apagar em silêncio o
 * trabalho de alguém não é um default aceitável.
 */
export async function excluirColuna(
  userId: string,
  id: string,
  opcoes: { moveCardsTo?: string; deleteCards?: boolean },
): Promise<BoardDetail> {
  const coluna = await colunaDoUsuario(prisma, userId, id);

  await prisma.$transaction(async (tx) => {
    const total = await tx.card.count({ where: { columnId: id } });

    if (total > 0 && !opcoes.deleteCards) {
      if (!opcoes.moveCardsTo) {
        throw new AppError(
          409,
          "COLUNA_COM_CARDS",
          `A coluna "${coluna.name}" tem ${total} card(s). Escolha mover ou excluir junto.`,
        );
      }

      const destino = await tx.boardColumn.findFirst({
        where: { id: opcoes.moveCardsTo, boardId: coluna.boardId },
        select: { id: true },
      });
      if (!destino) throw invalido("A coluna de destino é de outro board");

      // Os cards vão para o fim do destino, preservando a ordem que tinham.
      const [noDestino, movidos] = await Promise.all([
        idsAtivos(tx, destino.id),
        idsAtivos(tx, id),
      ]);

      await tx.card.updateMany({ where: { columnId: id }, data: { columnId: destino.id } });
      await renumerarCards(tx, [...noDestino.map((c) => c.id), ...movidos.map((c) => c.id)]);
    }

    // Cards que sobraram na coluna caem por cascata do schema.
    await tx.boardColumn.delete({ where: { id } });

    const restantes = await tx.boardColumn.findMany({
      where: { boardId: coluna.boardId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await renumerarColunas(
      tx,
      restantes.map((c) => c.id),
    );
  });

  return buscarBoard(userId, coluna.boardId);
}

/* ------------------------------------------------------------------- cards */

/** A nota vinculada precisa ser sua e estar ativa (RN-07). */
async function validarNota(db: Cliente, userId: string, noteId: string): Promise<void> {
  const nota = await db.note.findFirst({
    where: { id: noteId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!nota) throw notFound("Nota não encontrada");
}

export async function criarCard(userId: string, input: CardInput): Promise<CardDetail> {
  const dados = input as Required<CardInput>;
  const coluna = await colunaDoUsuario(prisma, userId, dados.columnId);
  if (dados.noteId) await validarNota(prisma, userId, dados.noteId);

  const id = await prisma.$transaction(async (tx) => {
    const ativos = await idsAtivos(tx, coluna.id);
    const card = await tx.card.create({
      data: {
        columnId: coluna.id,
        title: dados.title,
        descriptionMd: dados.descriptionMd ?? "",
        dueDate: dados.dueDate ? new Date(dados.dueDate) : null,
        priority: dados.priority ?? "media",
        checklist: (dados.checklist ?? []) as Prisma.InputJsonValue,
        noteId: dados.noteId ?? null,
        position: ativos.length, // nasce no fim da coluna
      },
    });
    return card.id;
  });

  return buscarCard(userId, id);
}

export async function buscarCard(userId: string, id: string): Promise<CardDetail> {
  const card = await prisma.card.findFirst({
    where: { id, column: { board: { userId } } },
    include: {
      note: { select: { id: true, title: true, kind: true } },
      column: { select: { name: true, board: { select: { id: true, name: true } } } },
    },
  });
  if (!card) throw notFound("Card não encontrado");

  const { done, total } = progressoChecklist(card.checklist);

  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    position: card.position,
    dueDate: card.dueDate?.toISOString() ?? null,
    priority: card.priority,
    checklistDone: done,
    checklistTotal: total,
    note: card.note,
    boardId: card.column.board.id,
    boardName: card.column.board.name,
    columnName: card.column.name,
    descriptionMd: card.descriptionMd,
    checklist: (card.checklist ?? []) as CardDetail["checklist"],
    archived: card.archived,
    updatedAt: card.updatedAt.toISOString(),
  };
}

export async function atualizarCard(
  userId: string,
  id: string,
  input: CardUpdateInput,
): Promise<CardDetail> {
  const card = await cardDoUsuario(prisma, userId, id);
  if (input.noteId) await validarNota(prisma, userId, input.noteId);

  await prisma.$transaction(async (tx) => {
    await tx.card.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.descriptionMd !== undefined && { descriptionMd: input.descriptionMd }),
        ...(input.dueDate !== undefined && {
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
        }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.checklist !== undefined && {
          checklist: input.checklist as Prisma.InputJsonValue,
        }),
        ...(input.noteId !== undefined && { noteId: input.noteId }),
        ...(input.archived !== undefined && { archived: input.archived }),
      },
    });

    // Arquivar tira o card da coluna: quem fica precisa fechar a fila.
    // Desarquivar devolve ao fim da mesma coluna (RF-33).
    if (input.archived === true && !card.archived) {
      const restantes = await idsAtivos(tx, card.columnId, id);
      await renumerarCards(
        tx,
        restantes.map((c) => c.id),
      );
    } else if (input.archived === false && card.archived) {
      const ativos = await idsAtivos(tx, card.columnId, id);
      await renumerarCards(tx, [...ativos.map((c) => c.id), id]);
    }
  });

  return buscarCard(userId, id);
}

/** RN-02: `position` é o índice no destino, já sem o card que se move. */
export async function moverCard(
  userId: string,
  id: string,
  input: CardMoveInput,
): Promise<CardDetail> {
  await prisma.$transaction(async (tx) => {
    const card = await cardDoUsuario(tx, userId, id);
    if (card.archived) throw invalido("Card arquivado não se move. Desarquive primeiro.");

    const destino = await tx.boardColumn.findFirst({
      where: { id: input.columnId, boardId: card.column.boardId },
      select: { id: true },
    });
    // RN-04: card não atravessa boards.
    if (!destino) throw invalido("A coluna de destino é de outro board");

    const noDestino = await idsAtivos(tx, destino.id, id);
    const indice = Math.min(Math.max(input.position, 0), noDestino.length);
    const ordem = noDestino.map((c) => c.id);
    ordem.splice(indice, 0, id);

    if (card.columnId !== destino.id) {
      await tx.card.update({ where: { id }, data: { columnId: destino.id } });
      const origem = await idsAtivos(tx, card.columnId, id);
      await renumerarCards(
        tx,
        origem.map((c) => c.id),
      );
    }

    await renumerarCards(tx, ordem);
  });

  return buscarCard(userId, id);
}

export async function excluirCard(userId: string, id: string): Promise<void> {
  const card = await cardDoUsuario(prisma, userId, id);

  await prisma.$transaction(async (tx) => {
    await tx.card.delete({ where: { id } });
    const restantes = await idsAtivos(tx, card.columnId);
    await renumerarCards(
      tx,
      restantes.map((c) => c.id),
    );
  });
}

/**
 * RF-38: os cards que referenciam uma nota.
 *
 * Usa `card_note_id_idx` — sem ele, abrir uma nota varreria a tabela inteira
 * de cards (RNF-12).
 */
export async function cardsDaNota(userId: string, noteId: string): Promise<CardRef[]> {
  const cards = await prisma.card.findMany({
    where: { noteId, archived: false, column: { board: { userId } } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      column: { select: { name: true, board: { select: { id: true, name: true } } } },
    },
  });

  return cards.map((c) => ({
    id: c.id,
    title: c.title,
    boardId: c.column.board.id,
    boardName: c.column.board.name,
    columnName: c.column.name,
  }));
}
