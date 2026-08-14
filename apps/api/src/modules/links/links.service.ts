import { Prisma } from "@prisma/client";
import type { Link, LinkInput, LinkKind, LinkUpdateInput } from "@yu-book/shared";
import { normalizarUrl } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { buscarTitulo } from "./titulo.service.js";

type LinkNoBanco = Prisma.LinkGetPayload<Record<string, never>>;

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

function toLink(link: LinkNoBanco): Link {
  return {
    id: link.id,
    url: link.url,
    title: link.title,
    domain: link.domain,
    kind: link.kind,
    position: link.position,
    createdAt: link.createdAt.toISOString(),
    // RF-14: sem título de verdade, o nome é o domínio — e dá para tentar de novo.
    semTitulo: link.title === link.domain,
  };
}

/** Favoritos vêm na ordem manual; a fila, do mais novo para o mais velho. */
export async function listar(userId: string, kind?: LinkKind): Promise<Link[]> {
  const links = await prisma.link.findMany({
    where: { userId, ...(kind && { kind }) },
    orderBy:
      kind === "favorito"
        ? [{ position: "asc" }]
        : [{ kind: "asc" }, { position: "asc" }, { createdAt: "desc" }],
  });

  // Sem filtro de lista, cada uma volta na sua ordem.
  return links
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "favorito" ? -1 : 1;
      if (a.kind === "favorito") return a.position - b.position;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map(toLink);
}

export async function criar(userId: string, input: LinkInput): Promise<Link> {
  const normalizada = normalizarUrl(input.url);
  // RF-07: só http e https entram.
  if (!normalizada) throw invalido("Só dá para salvar links http e https.");

  const kind = (input.kind ?? "depois") as LinkKind;

  // RN-02: a mesma URL não entra duas vezes na mesma lista.
  const existente = await prisma.link.findFirst({
    where: { userId, kind, url: normalizada.url },
  });
  if (existente) return toLink(existente);

  // O desfazer (RN-05) recria o link com o nome que ele já tinha: não faz
  // sentido pagar a busca de título de novo.
  const titulo =
    input.title?.trim() || (await buscarTitulo(normalizada.url)) || normalizada.domain;

  const position =
    kind === "favorito" ? await prisma.link.count({ where: { userId, kind } }) : 0;

  try {
    const link = await prisma.link.create({
      data: {
        userId,
        url: normalizada.url,
        domain: normalizada.domain,
        title: titulo.slice(0, 200), // RNF-06: título é dado de terceiro
        kind,
        position,
      },
    });
    return toLink(link);
  } catch (erro) {
    // Dois cliques simultâneos no mesmo link: o índice único decide, e quem
    // perdeu devolve o que já existe em vez de um erro.
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      const salvo = await prisma.link.findFirst({ where: { userId, kind, url: normalizada.url } });
      if (salvo) return toLink(salvo);
    }
    throw erro;
  }
}

async function doUsuario(userId: string, id: string): Promise<LinkNoBanco> {
  const link = await prisma.link.findFirst({ where: { id, userId } });
  if (!link) throw notFound("Link não encontrado");
  return link;
}

export async function atualizar(
  userId: string,
  id: string,
  input: LinkUpdateInput,
): Promise<Link> {
  const atual = await doUsuario(userId, id);
  const mudouDeLista = input.kind !== undefined && input.kind !== atual.kind;

  try {
    const link = await prisma.link.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title.slice(0, 200) }),
        ...(input.kind !== undefined && { kind: input.kind }),
        // RF-31: quem chega nos favoritos entra no fim da grade.
        ...(mudouDeLista &&
          input.kind === "favorito" && {
            position: await prisma.link.count({ where: { userId, kind: "favorito" } }),
          }),
      },
    });

    // A lista de origem fecha a fila que ficou aberta.
    if (mudouDeLista && atual.kind === "favorito") await renumerarFavoritos(userId);

    return toLink(link);
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      throw new AppError(409, "NOME_DUPLICADO", "Esse link já está na outra lista.");
    }
    throw erro;
  }
}

export async function excluir(userId: string, id: string): Promise<void> {
  const link = await doUsuario(userId, id);
  await prisma.link.delete({ where: { id } });
  if (link.kind === "favorito") await renumerarFavoritos(userId);
}

/** RN-03: posições contíguas a partir de 0, como no kanban. */
async function renumerarFavoritos(userId: string, ordem?: string[]): Promise<void> {
  const ids =
    ordem ??
    (
      await prisma.link.findMany({
        where: { userId, kind: "favorito" },
        orderBy: { position: "asc" },
        select: { id: true },
      })
    ).map((l) => l.id);

  if (ids.length === 0) return;

  const valores = Prisma.join(ids.map((id, i) => Prisma.sql`(${id}::uuid, ${i}::int)`));
  await prisma.$executeRaw`
    UPDATE link SET position = v.pos
    FROM (VALUES ${valores}) AS v(id, pos)
    WHERE link.id = v.id
  `;
}

export async function mover(userId: string, id: string, position: number): Promise<Link[]> {
  const link = await doUsuario(userId, id);
  if (link.kind !== "favorito") throw invalido("Só favoritos têm ordem manual.");

  const outros = await prisma.link.findMany({
    where: { userId, kind: "favorito", NOT: { id } },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  const indice = Math.min(Math.max(position, 0), outros.length);
  const ordem = outros.map((l) => l.id);
  ordem.splice(indice, 0, id);

  await renumerarFavoritos(userId, ordem);
  return listar(userId, "favorito");
}

/** RF-14: tenta de novo o título de um link que ficou com o domínio. */
export async function rebuscarTitulo(userId: string, id: string): Promise<Link> {
  const atual = await doUsuario(userId, id);
  const titulo = await buscarTitulo(atual.url);
  if (!titulo) return toLink(atual);

  const link = await prisma.link.update({
    where: { id },
    data: { title: titulo.slice(0, 200) },
  });
  return toLink(link);
}
