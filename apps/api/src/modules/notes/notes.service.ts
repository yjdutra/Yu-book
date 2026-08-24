import { Prisma } from "@prisma/client";
import type {
  CreateNoteInput,
  ListNotesQuery,
  NoteCounts,
  NoteDetail,
  NoteKind,
  NoteListResponse,
  NoteSummary,
  NoteTitle,
  UpdateNoteInput,
} from "@yu-book/shared";
import { NOTE_KINDS, extrairWikilinks, normalizarTitulo, renomearWikilinks } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { cardsDaNota } from "../kanban/kanban.service.js";

/**
 * Campos que a listagem precisa — `content_md` **não** está entre eles.
 *
 * O trecho de 160 caracteres vem truncado do banco (ver `trechos`): trazer o
 * corpo inteiro de 50 notas para descartar 99% dele é o tipo de desperdício
 * que não aparece em dev, com notas de três linhas, e dói em produção.
 */
const camposDaLista = {
  id: true,
  title: true,
  kind: true,
  workspaceId: true,
  isFavorite: true,
  occurredAt: true,
  updatedAt: true,
  createdAt: true,
  deletedAt: true,
  workspace: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.NoteSelect;

type NoteDaLista = Prisma.NoteGetPayload<{ select: typeof camposDaLista }>;

const RESUMO_TAMANHO = 160;
/** Prefixo lido do banco: sobra folga para a limpeza de marcação encurtar. */
const PREFIXO_RESUMO = 600;

function excerpt(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, " ") // blocos de código não ajudam no resumo
    .replace(/[#>*_`~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, RESUMO_TAMANHO);
}

/** Só o começo do corpo, truncado no banco antes de virar tráfego. */
async function trechos(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const linhas = await prisma.$queryRaw<{ id: string; trecho: string }[]>`
    -- O cast é obrigatório: o Prisma manda número como bigint, e não existe
    -- left(text, bigint).
    SELECT id, left(content_md, ${PREFIXO_RESUMO}::int) AS trecho
    FROM note
    WHERE id = ANY(${ids}::uuid[])
  `;
  return new Map(linhas.map((l) => [l.id, l.trecho]));
}

function toSummary(note: NoteDaLista, textoDoResumo: string): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    kind: note.kind,
    excerpt: excerpt(textoDoResumo),
    workspaceId: note.workspaceId,
    workspaceName: note.workspace?.name ?? null,
    tags: note.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
    isFavorite: note.isFavorite,
    occurredAt: note.occurredAt?.toISOString() ?? null,
    updatedAt: note.updatedAt.toISOString(),
    createdAt: note.createdAt.toISOString(),
    deletedAt: note.deletedAt?.toISOString() ?? null,
  };
}

const tituloDuplicado = (titulo: string) =>
  new AppError(409, "TITULO_DUPLICADO", `Já existe uma nota chamada "${titulo}"`);

/**
 * O índice único parcial é quem garante RN-01; aqui só traduzimos o erro.
 *
 * O Prisma reporta `meta.target` como a lista de expressões da coluna
 * (`["user_id", "lower(immutable_unaccent(title))"]`), não o nome do índice —
 * por isso a checagem é pela presença de `title`.
 */
function ehViolacaoDeTitulo(erro: unknown): boolean {
  if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") {
    return false;
  }
  const alvo = erro.meta?.target;
  const texto = Array.isArray(alvo) ? alvo.join(",") : String(alvo ?? "");
  return texto.includes("title");
}

/** Cria as tags que ainda não existem e devolve os ids de todas (RF-39). */
async function resolverTags(
  tx: Prisma.TransactionClient,
  userId: string,
  nomes: string[],
): Promise<string[]> {
  const limpos = [...new Set(nomes.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (limpos.length === 0) return [];

  await tx.tag.createMany({
    data: limpos.map((name) => ({ userId, name })),
    skipDuplicates: true,
  });

  const tags = await tx.tag.findMany({
    where: { userId, name: { in: limpos } },
    select: { id: true },
  });
  return tags.map((t) => t.id);
}

/**
 * Remove tags que ficaram sem nenhuma nota (RN-05), para o autocomplete não
 * acumular lixo. Roda depois de qualquer operação que desassocie tags.
 */
async function limparTagsOrfas(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM tag t
    WHERE t.user_id = ${userId}::uuid
      AND NOT EXISTS (SELECT 1 FROM note_tag nt WHERE nt.tag_id = t.id)
  `;
}

/**
 * Reescreve `note_link` a partir do conteúdo (RN-02, RF-27).
 *
 * Títulos que não existem simplesmente não viram linha — é o que faz o link
 * aparecer como "não resolvido" no preview (RF-24) sem nenhum estado extra.
 */
async function recalcularLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  noteId: string,
  contentMd: string,
): Promise<void> {
  await tx.noteLink.deleteMany({ where: { fromNoteId: noteId } });

  const titulos = extrairWikilinks(contentMd);
  if (titulos.length === 0) return;

  const normalizados = titulos.map(normalizarTitulo);
  const alvos = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM note
    WHERE user_id = ${userId}::uuid
      AND deleted_at IS NULL
      AND id <> ${noteId}::uuid
      AND lower(public.immutable_unaccent(title)) = ANY(${normalizados}::text[])
  `;

  if (alvos.length > 0) {
    await tx.noteLink.createMany({
      data: alvos.map((alvo) => ({ fromNoteId: noteId, toNoteId: alvo.id })),
      skipDuplicates: true,
    });
  }
}

/**
 * Refaz os links **de entrada** de um título que passou a existir.
 *
 * Sem isto, escrever `[[B]]` antes de B existir só resolveria quando A fosse
 * salva de novo — e o autosave deixou de recalcular link à toa (ver
 * `linksMudaram`), então "de novo" poderia nunca acontecer.
 */
async function reconstruirEntradas(
  tx: Prisma.TransactionClient,
  userId: string,
  titulo: string,
): Promise<void> {
  const referenciadoras = await tx.note.findMany({
    where: { userId, deletedAt: null, contentMd: { contains: `[[${titulo}` } },
    select: { id: true, contentMd: true },
  });
  for (const nota of referenciadoras) {
    await recalcularLinks(tx, userId, nota.id, nota.contentMd);
  }
}

/** Os mesmos alvos, na mesma ordem, significam nada a recalcular. */
function mesmosLinks(antes: string, depois: string): boolean {
  const a = extrairWikilinks(antes).map(normalizarTitulo);
  const b = extrairWikilinks(depois).map(normalizarTitulo);
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

export async function criar(userId: string, input: CreateNoteInput): Promise<NoteDetail> {
  const dados = input as Required<CreateNoteInput>;

  try {
    const id = await prisma.$transaction(async (tx) => {
      const tagIds = await resolverTags(tx, userId, dados.tags ?? []);

      const note = await tx.note.create({
        data: {
          userId,
          title: dados.title,
          contentMd: dados.contentMd ?? "",
          kind: (dados.kind ?? "livre") as NoteKind,
          workspaceId: dados.workspaceId ?? null,
          meta: (dados.meta ?? {}) as Prisma.InputJsonValue,
          sourceUrl: dados.sourceUrl ?? null,
          occurredAt: dados.occurredAt ? new Date(dados.occurredAt) : null,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
      });

      await recalcularLinks(tx, userId, note.id, note.contentMd);
      // Quem já apontava para este título passa a ter um link resolvido.
      await reconstruirEntradas(tx, userId, note.title);
      return note.id;
    });

    return buscarPorId(userId, id);
  } catch (erro) {
    if (ehViolacaoDeTitulo(erro)) throw tituloDuplicado(dados.title);
    throw erro;
  }
}

export async function buscarPorId(userId: string, id: string): Promise<NoteDetail> {
  const note = await prisma.note.findFirst({
    where: { id, userId },
    select: { ...camposDaLista, contentMd: true, meta: true, sourceUrl: true },
  });
  if (!note) throw notFound("Nota não encontrada");

  const [backlinks, cards] = await Promise.all([
    prisma.noteLink.findMany({
      where: { toNoteId: id, from: { deletedAt: null } },
      select: { from: { select: { id: true, title: true, kind: true } } },
      orderBy: { from: { title: "asc" } },
    }),
    // RF-38: o vínculo card ↔ nota aparece dos dois lados.
    cardsDaNota(userId, id),
  ]);

  return {
    ...toSummary(note, note.contentMd.slice(0, PREFIXO_RESUMO)),
    contentMd: note.contentMd,
    meta: (note.meta ?? {}) as Record<string, string | number | boolean>,
    sourceUrl: note.sourceUrl,
    backlinks: backlinks.map((b) => b.from),
    cards,
  };
}

export async function atualizar(
  userId: string,
  id: string,
  input: UpdateNoteInput,
): Promise<NoteDetail> {
  const atual = await prisma.note.findFirst({ where: { id, userId } });
  if (!atual) throw notFound("Nota não encontrada");

  const novoTitulo = input.title?.trim();
  const renomeou = novoTitulo !== undefined && novoTitulo !== atual.title;

  try {
    await prisma.$transaction(async (tx) => {
      // RN-03: renomear reescreve [[antigo]] nas notas que apontam para esta,
      // senão os links quebram silenciosamente. Restrito ao padrão exato entre
      // colchetes — nunca o título solto no texto.
      if (renomeou) {
        const referenciadoras = await tx.noteLink.findMany({
          where: { toNoteId: id },
          select: { from: { select: { id: true, contentMd: true } } },
        });

        for (const { from } of referenciadoras) {
          const novoConteudo = renomearWikilinks(from.contentMd, atual.title, novoTitulo);
          if (novoConteudo !== from.contentMd) {
            await tx.note.update({ where: { id: from.id }, data: { contentMd: novoConteudo } });
          }
        }
      }

      if (input.tags !== undefined) {
        const tagIds = await resolverTags(tx, userId, input.tags);
        await tx.noteTag.deleteMany({ where: { noteId: id } });
        if (tagIds.length > 0) {
          await tx.noteTag.createMany({ data: tagIds.map((tagId) => ({ noteId: id, tagId })) });
        }
      }

      await tx.note.update({
        where: { id },
        data: {
          ...(novoTitulo !== undefined && { title: novoTitulo }),
          ...(input.contentMd !== undefined && { contentMd: input.contentMd }),
          ...(input.kind !== undefined && { kind: input.kind as NoteKind }),
          ...(input.workspaceId !== undefined && { workspaceId: input.workspaceId }),
          ...(input.meta !== undefined && { meta: input.meta as Prisma.InputJsonValue }),
          ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
          ...(input.occurredAt !== undefined && {
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          }),
          ...(input.isFavorite !== undefined && { isFavorite: input.isFavorite }),
        },
      });

      // O caminho quente: o autosave manda o corpo a cada pausa de digitação,
      // e quase nenhuma dessas pausas mexe em `[[…]]`. Recalcular link só
      // quando o conjunto de alvos mudou tira 3 consultas de cada salvamento.
      if (input.contentMd !== undefined && !mesmosLinks(atual.contentMd, input.contentMd)) {
        await recalcularLinks(tx, userId, id, input.contentMd);
      }

      // O título mudou: quem apontava para o título antigo agora resolve para
      // este, e quem apontava para o novo pode ter passado a resolver.
      if (renomeou) await reconstruirEntradas(tx, userId, novoTitulo);

      if (input.tags !== undefined) await limparTagsOrfas(tx, userId);
    });
  } catch (erro) {
    if (ehViolacaoDeTitulo(erro)) throw tituloDuplicado(novoTitulo ?? "");
    throw erro;
  }

  return buscarPorId(userId, id);
}

/** RF-05 / RN-04: some de tudo, mas continua recuperável. */
export async function excluir(userId: string, id: string): Promise<void> {
  const { count } = await prisma.note.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) throw notFound("Nota não encontrada");

  // Links de e para a nota somem junto: ela não deve aparecer em backlink de
  // ninguém, nem manter os seus.
  await prisma.noteLink.deleteMany({ where: { OR: [{ fromNoteId: id }, { toNoteId: id }] } });

  // RN-07: o card continua existindo, só perde o vínculo. Restaurar a nota
  // não o refaz — refazer é um clique, guardar o vínculo desfeito seria uma
  // coluna a mais só para isso.
  await prisma.card.updateMany({ where: { noteId: id }, data: { noteId: null } });
}

export async function restaurar(userId: string, id: string): Promise<NoteDetail> {
  const note = await prisma.note.findFirst({ where: { id, userId } });
  if (!note) throw notFound("Nota não encontrada");
  if (!note.deletedAt) return buscarPorId(userId, id);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.note.update({ where: { id }, data: { deletedAt: null } });
      await recalcularLinks(tx, userId, id, note.contentMd);
      await reconstruirEntradas(tx, userId, note.title);
    });
  } catch (erro) {
    // O título pode ter sido reaproveitado enquanto ela estava na lixeira.
    if (ehViolacaoDeTitulo(erro)) throw tituloDuplicado(note.title);
    throw erro;
  }

  return buscarPorId(userId, id);
}

export async function excluirDefinitivo(userId: string, id: string): Promise<void> {
  const { count } = await prisma.note.deleteMany({
    where: { id, userId, deletedAt: { not: null } },
  });
  if (count === 0) throw notFound("Nota não encontrada na lixeira");
  await prisma.$transaction(async (tx) => limparTagsOrfas(tx, userId));
}

export async function listar(userId: string, query: ListNotesQuery): Promise<NoteListResponse> {
  const where: Prisma.NoteWhereInput = {
    userId,
    deletedAt: query.trash === "true" ? { not: null } : null,
    ...(query.kind && { kind: query.kind }),
    ...(query.workspaceId && { workspaceId: query.workspaceId }),
    ...(query.favorite === "true" && { isFavorite: true }),
    ...(query.q && {
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { contentMd: { contains: query.q, mode: "insensitive" } },
      ],
    }),
    ...(query.tags.length > 0 && {
      // AND lógico: a nota precisa ter TODAS as tags pedidas (RF-07).
      AND: query.tags.map((name) => ({ tags: { some: { tag: { name } } } })),
    }),
    ...((query.from || query.to) && {
      updatedAt: { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) },
    }),
  };

  const direcao = query.sort === "title" ? "asc" : "desc";
  const orderBy: Prisma.NoteOrderByWithRelationInput[] = [
    { [query.sort]: direcao } as Prisma.NoteOrderByWithRelationInput,
    { id: "desc" }, // desempate estável, senão o cursor pode pular itens
  ];

  const notes = await prisma.note.findMany({
    where,
    select: camposDaLista,
    orderBy,
    take: query.limit + 1, // +1 só para saber se existe próxima página
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });

  const temMais = notes.length > query.limit;
  const pagina = temMais ? notes.slice(0, query.limit) : notes;
  const resumos = await trechos(pagina.map((n) => n.id));
  const items = pagina.map((n) => toSummary(n, resumos.get(n.id) ?? ""));

  return { items, nextCursor: temMais ? (items.at(-1)?.id ?? null) : null };
}

/**
 * RF-02: os contadores da barra lateral seguem o workspace ativo.
 *
 * Uma varredura só, com `FILTER`, em vez de quatro `count` — a barra lateral
 * pede isto a cada troca de workspace e depois de cada operação em nota.
 */
export async function contar(userId: string, workspaceId?: string): Promise<NoteCounts> {
  const escopo = workspaceId
    ? Prisma.sql`AND workspace_id = ${workspaceId}::uuid`
    : Prisma.empty;

  const linhas = await prisma.$queryRaw<
    { kind: NoteKind; ativas: bigint; lixeira: bigint; favoritas: bigint }[]
  >`
    SELECT kind::text AS kind,
           count(*) FILTER (WHERE deleted_at IS NULL) AS ativas,
           count(*) FILTER (WHERE deleted_at IS NOT NULL) AS lixeira,
           count(*) FILTER (WHERE deleted_at IS NULL AND is_favorite) AS favoritas
    FROM note
    WHERE user_id = ${userId}::uuid
    ${escopo}
    GROUP BY kind
  `;

  const byKind = Object.fromEntries(NOTE_KINDS.map((k) => [k, 0])) as Record<NoteKind, number>;
  let total = 0;
  let trash = 0;
  let favorites = 0;

  for (const linha of linhas) {
    const ativas = Number(linha.ativas);
    byKind[linha.kind] = ativas;
    total += ativas;
    trash += Number(linha.lixeira);
    favorites += Number(linha.favoritas);
  }

  return { total, trash, favorites, byKind };
}

/**
 * Todos os títulos ativos do usuário.
 *
 * Serve a dois propósitos no front, e por isso é um endpoint só: filtrar o
 * autocomplete de `[[` (RF-22) sem uma requisição por tecla, e decidir quais
 * `[[…]]` estão resolvidos no preview (RF-24) com exatidão — sem esse conjunto,
 * um link recém-digitado apareceria como quebrado até o autosave.
 *
 * São ~40 bytes por nota: com o volume previsto (S-06, 1.000 notas) dá 40 KB,
 * cacheado pelo TanStack Query.
 */
/**
 * Catálogo de notas ativas: identifica e rotula, sem carregar conteúdo.
 * Serve ao autocomplete de `[[…]]` e ao resource `yubook://notas` do servidor
 * MCP. O custo por item é fixo — é isso que permite listar o acervo inteiro
 * numa requisição só enquanto listar o conteúdo nunca seria viável.
 */
export async function titulos(userId: string): Promise<NoteTitle[]> {
  const notas = await prisma.note.findMany({
    where: { userId, deletedAt: null },
    select: {
      id: true,
      title: true,
      kind: true,
      updatedAt: true,
      workspace: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 2000,
  });

  return notas.map((n) => ({
    id: n.id,
    title: n.title,
    kind: n.kind,
    workspaceName: n.workspace?.name ?? null,
    updatedAt: n.updatedAt.toISOString(),
  }));
}
