import { Prisma } from "@prisma/client";
import type { LinkFolder } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { renumerarFavoritos } from "./links.service.js";

/* ---------------------------------------------------------------
   Pastas de favoritos da gaveta de links: um nível só. A pasta é
   um recipiente de ordem — o link guarda `folderId`, e a posição
   dele conta dentro da pasta.
   --------------------------------------------------------------- */

type PastaNoBanco = Prisma.LinkFolderGetPayload<Record<string, never>>;

function toPasta(pasta: PastaNoBanco): LinkFolder {
  return {
    id: pasta.id,
    name: pasta.name,
    position: pasta.position,
    createdAt: pasta.createdAt.toISOString(),
  };
}

const duplicada = () => new AppError(409, "NOME_DUPLICADO", "Já existe uma pasta com esse nome.");

function ehDuplicada(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

async function daPessoa(userId: string, id: string): Promise<PastaNoBanco> {
  const pasta = await prisma.linkFolder.findFirst({ where: { id, userId } });
  if (!pasta) throw notFound("Pasta não encontrada");
  return pasta;
}

/** Posições contíguas a partir de 0 entre as pastas, como os favoritos (RN-03). */
async function renumerar(
  userId: string,
  ordem?: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const ids =
    ordem ??
    (
      await db.linkFolder.findMany({
        where: { userId },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    ).map((p) => p.id);
  if (ids.length === 0) return;

  const valores = Prisma.join(ids.map((id, i) => Prisma.sql`(${id}::uuid, ${i}::int)`));
  await db.$executeRaw`
    UPDATE link_folder SET position = v.pos
    FROM (VALUES ${valores}) AS v(id, pos)
    WHERE link_folder.id = v.id
  `;
}

export async function listar(userId: string): Promise<LinkFolder[]> {
  const pastas = await prisma.linkFolder.findMany({
    where: { userId },
    orderBy: { position: "asc" },
  });
  return pastas.map(toPasta);
}

/** A pasta nova entra no fim. */
export async function criar(userId: string, name: string): Promise<LinkFolder> {
  try {
    const pasta = await prisma.linkFolder.create({
      data: { userId, name, position: await prisma.linkFolder.count({ where: { userId } }) },
    });
    return toPasta(pasta);
  } catch (erro) {
    if (ehDuplicada(erro)) throw duplicada();
    throw erro;
  }
}

export async function renomear(userId: string, id: string, name: string): Promise<LinkFolder> {
  await daPessoa(userId, id);
  try {
    return toPasta(await prisma.linkFolder.update({ where: { id }, data: { name } }));
  } catch (erro) {
    if (ehDuplicada(erro)) throw duplicada();
    throw erro;
  }
}

export async function mover(userId: string, id: string, position: number): Promise<LinkFolder[]> {
  await daPessoa(userId, id);
  const outras = await prisma.linkFolder.findMany({
    where: { userId, NOT: { id } },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const ordem = outras.map((p) => p.id);
  ordem.splice(Math.min(Math.max(position, 0), ordem.length), 0, id);
  await renumerar(userId, ordem);
  return listar(userId);
}

/**
 * Excluir a pasta não apaga link: os dela voltam à raiz, no fim e na ordem em
 * que estavam. Tudo numa transação, para a raiz não ficar com posição repetida.
 */
export async function excluir(userId: string, id: string): Promise<void> {
  await daPessoa(userId, id);
  await prisma.$transaction(async (tx) => {
    const raiz = await tx.link.findMany({
      where: { userId, kind: "favorito", folderId: null },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const dela = await tx.link.findMany({
      where: { userId, folderId: id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await tx.link.updateMany({ where: { userId, folderId: id }, data: { folderId: null } });
    await tx.linkFolder.delete({ where: { id } });
    await renumerarFavoritos(
      userId,
      null,
      [...raiz, ...dela].map((l) => l.id),
      tx,
    );
    await renumerar(userId, undefined, tx);
  });
}
