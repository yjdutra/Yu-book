import { Prisma } from "@prisma/client";
import type { Tag, Workspace, WorkspaceInput } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";

const nomeDuplicado = (o: string) => new AppError(409, "NOME_DUPLICADO", `Já existe ${o}`);

function ehDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

/**
 * Boards e cards por workspace (RF-09).
 *
 * Uma query só para todos os workspaces: são poucos, e a alternativa seria
 * um `count` aninhado por workspace, que o Prisma não modela em dois níveis.
 */
async function contarKanban(userId: string): Promise<Map<string, [number, number]>> {
  const linhas = await prisma.$queryRaw<
    { workspace_id: string; boards: bigint; cards: bigint }[]
  >`
    SELECT b.workspace_id, count(DISTINCT b.id) AS boards, count(c.id) AS cards
    FROM board b
    LEFT JOIN board_column bc ON bc.board_id = b.id
    LEFT JOIN card c ON c.column_id = bc.id AND c.archived = false
    WHERE b.user_id = ${userId}::uuid
    GROUP BY b.workspace_id
  `;

  return new Map(linhas.map((l) => [l.workspace_id, [Number(l.boards), Number(l.cards)]]));
}

export async function listarWorkspaces(userId: string): Promise<Workspace[]> {
  const [workspaces, kanban] = await Promise.all([
    prisma.workspace.findMany({
      where: { userId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { _count: { select: { notes: { where: { deletedAt: null } } } } },
    }),
    contarKanban(userId),
  ]);

  return workspaces.map((w) => {
    const [boards, cards] = kanban.get(w.id) ?? [0, 0];
    return {
      id: w.id,
      name: w.name,
      color: w.color,
      noteCount: w._count.notes,
      boardCount: boards,
      cardCount: cards,
    };
  });
}

export async function criarWorkspace(userId: string, input: WorkspaceInput): Promise<Workspace> {
  try {
    const maior = await prisma.workspace.aggregate({
      where: { userId },
      _max: { position: true },
    });

    const w = await prisma.workspace.create({
      data: {
        userId,
        name: input.name,
        color: input.color ?? "#6366f1",
        position: (maior._max.position ?? -1) + 1,
      },
    });
    return { id: w.id, name: w.name, color: w.color, noteCount: 0, boardCount: 0, cardCount: 0 };
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`um workspace chamado "${input.name}"`);
    throw erro;
  }
}

export async function atualizarWorkspace(
  userId: string,
  id: string,
  input: Partial<WorkspaceInput>,
): Promise<Workspace> {
  const existe = await prisma.workspace.findFirst({ where: { id, userId } });
  if (!existe) throw notFound("Workspace não encontrado");

  try {
    const w = await prisma.workspace.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
      },
      include: { _count: { select: { notes: { where: { deletedAt: null } } } } },
    });
    const [boards, cards] = (await contarKanban(userId)).get(id) ?? [0, 0];
    return {
      id: w.id,
      name: w.name,
      color: w.color,
      noteCount: w._count.notes,
      boardCount: boards,
      cardCount: cards,
    };
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`um workspace chamado "${input.name}"`);
    throw erro;
  }
}

/** RF-43: excluir workspace NÃO exclui as notas — elas ficam sem workspace. */
export async function excluirWorkspace(userId: string, id: string): Promise<void> {
  const { count } = await prisma.workspace.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Workspace não encontrado");
}

export async function listarTags(userId: string): Promise<Tag[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { _count: { select: { notes: { where: { note: { deletedAt: null } } } } } },
  });

  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, noteCount: t._count.notes }));
}

export async function atualizarTag(
  userId: string,
  id: string,
  input: { name?: string; color?: string },
): Promise<Tag> {
  const existe = await prisma.tag.findFirst({ where: { id, userId } });
  if (!existe) throw notFound("Tag não encontrada");

  const nome = input.name?.trim().toLowerCase();

  try {
    // Renomear para uma tag que já existe funde as duas, em vez de dar erro:
    // é o que o usuário quer dizer com "renomear X para Y" quando Y existe.
    if (nome && nome !== existe.name) {
      const alvo = await prisma.tag.findFirst({ where: { userId, name: nome } });
      if (alvo) {
        await prisma.$transaction(async (tx) => {
          const notas = await tx.noteTag.findMany({ where: { tagId: id } });
          await tx.noteTag.createMany({
            data: notas.map((n) => ({ noteId: n.noteId, tagId: alvo.id })),
            skipDuplicates: true,
          });
          await tx.tag.delete({ where: { id } });
        });

        const fundida = await prisma.tag.findUniqueOrThrow({
          where: { id: alvo.id },
          include: { _count: { select: { notes: { where: { note: { deletedAt: null } } } } } },
        });
        return {
          id: fundida.id,
          name: fundida.name,
          color: fundida.color,
          noteCount: fundida._count.notes,
        };
      }
    }

    const t = await prisma.tag.update({
      where: { id },
      data: { ...(nome && { name: nome }), ...(input.color && { color: input.color }) },
      include: { _count: { select: { notes: { where: { note: { deletedAt: null } } } } } },
    });
    return { id: t.id, name: t.name, color: t.color, noteCount: t._count.notes };
  } catch (erro) {
    if (ehDuplicado(erro)) throw nomeDuplicado(`uma tag chamada "${nome}"`);
    throw erro;
  }
}

/** RF-41: some de todas as notas, sem excluir nenhuma nota. */
export async function excluirTag(userId: string, id: string): Promise<void> {
  const { count } = await prisma.tag.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Tag não encontrada");
}
