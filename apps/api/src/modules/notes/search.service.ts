import { Prisma } from "@prisma/client";
import type { NoteKind, SearchResponse, SearchResult } from "@yu-book/shared";
import { HL_END, HL_START, parseSearchQuery } from "@yu-book/shared";
import { prisma } from "../../db.js";

/**
 * Opções do `ts_headline`. Vai como parâmetro (não concatenado) e usa os
 * marcadores de controle definidos em @yu-book/shared.
 */
const HEADLINE_OPTS = [
  `StartSel="${HL_START}"`,
  `StopSel="${HL_END}"`,
  "MaxWords=24",
  "MinWords=10",
  "ShortWord=2",
  "MaxFragments=1",
  "FragmentDelimiter= … ",
].join(", ");

const CONFIG = "pt_unaccent";

interface LinhaBruta {
  id: string;
  title: string;
  kind: NoteKind;
  updated_at: Date;
  workspace_name: string | null;
  snippet: string;
}

function toResult(linha: LinhaBruta, approximate: boolean): SearchResult {
  return {
    id: linha.id,
    title: linha.title,
    kind: linha.kind,
    workspaceName: linha.workspace_name,
    updatedAt: linha.updated_at.toISOString(),
    snippet: linha.snippet ?? "",
    approximate,
  };
}

/** Últimas notas editadas — o que a paleta mostra de campo vazio (RF-37). */
async function recentes(userId: string, limit: number): Promise<LinhaBruta[]> {
  return prisma.$queryRaw<LinhaBruta[]>`
    SELECT n.id, n.title, n.kind, n.updated_at, w.name AS workspace_name,
           left(regexp_replace(n.content_md, '\s+', ' ', 'g'), 160) AS snippet
    FROM note n
    LEFT JOIN workspace w ON w.id = n.workspace_id
    WHERE n.user_id = ${userId}::uuid AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC
    LIMIT ${limit}
  `;
}

export async function buscar(
  userId: string,
  entrada: string,
  limit: number,
): Promise<SearchResponse> {
  const { text, kind, tag, workspace } = parseSearchQuery(entrada);
  const filtros = { kind, tag, workspace };

  // Só filtro, sem termo: cai na listagem recente já filtrada.
  if (!text) {
    const linhas = await comFiltros(userId, limit, filtros, Prisma.empty, Prisma.empty);
    return { results: linhas.map((l) => toResult(l, false)), filtros, approximate: false };
  }

  const ordem = Prisma.sql`ORDER BY ts_rank_cd(n.search_vector, q.query) DESC, n.updated_at DESC`;
  const condicao = Prisma.sql`AND n.search_vector @@ q.query`;
  const linhas = await comFiltros(userId, limit, filtros, condicao, ordem, text);

  if (linhas.length > 0) {
    return { results: linhas.map((l) => toResult(l, false)), filtros, approximate: false };
  }

  // RF-34: full-text não achou nada — tenta por semelhança de título.
  const aproximadas = await porSimilaridade(userId, text, limit, filtros);
  return {
    results: aproximadas.map((l) => toResult(l, true)),
    filtros,
    approximate: aproximadas.length > 0,
  };
}

function fragmentosDeFiltro(filtros: {
  kind: NoteKind | null;
  tag: string | null;
  workspace: string | null;
}): Prisma.Sql {
  const partes: Prisma.Sql[] = [];

  if (filtros.kind) partes.push(Prisma.sql`AND n.kind::text = ${filtros.kind}`);

  if (filtros.tag) {
    partes.push(Prisma.sql`
      AND EXISTS (
        SELECT 1 FROM note_tag nt JOIN tag t ON t.id = nt.tag_id
        WHERE nt.note_id = n.id AND t.name = ${filtros.tag}
      )`);
  }

  if (filtros.workspace) {
    partes.push(Prisma.sql`
      AND lower(public.immutable_unaccent(w.name))
          = lower(public.immutable_unaccent(${filtros.workspace}))`);
  }

  return partes.length > 0 ? Prisma.join(partes, " ") : Prisma.empty;
}

async function comFiltros(
  userId: string,
  limit: number,
  filtros: { kind: NoteKind | null; tag: string | null; workspace: string | null },
  condicaoBusca: Prisma.Sql,
  ordem: Prisma.Sql,
  texto?: string,
): Promise<LinhaBruta[]> {
  const filtroSql = fragmentosDeFiltro(filtros);

  // Sem termo textual: nem tsquery nem headline, só filtro + recentes.
  if (texto === undefined) {
    return prisma.$queryRaw<LinhaBruta[]>`
      SELECT n.id, n.title, n.kind, n.updated_at, w.name AS workspace_name,
             left(regexp_replace(n.content_md, '\s+', ' ', 'g'), 160) AS snippet
      FROM note n
      LEFT JOIN workspace w ON w.id = n.workspace_id
      WHERE n.user_id = ${userId}::uuid AND n.deleted_at IS NULL
      ${filtroSql}
      ORDER BY n.updated_at DESC
      LIMIT ${limit}
    `;
  }

  // `websearch_to_tsquery` aceita a entrada do usuário sem sanitização: aspas,
  // OR e - já são a sintaxe dele. Vai como parâmetro, nunca concatenado.
  return prisma.$queryRaw<LinhaBruta[]>`
    WITH q AS (SELECT websearch_to_tsquery(${CONFIG}::regconfig, ${texto}) AS query)
    SELECT n.id, n.title, n.kind, n.updated_at, w.name AS workspace_name,
           ts_headline(${CONFIG}::regconfig, n.content_md, q.query, ${HEADLINE_OPTS}) AS snippet
    FROM note n
    CROSS JOIN q
    LEFT JOIN workspace w ON w.id = n.workspace_id
    WHERE n.user_id = ${userId}::uuid AND n.deleted_at IS NULL
    ${condicaoBusca}
    ${filtroSql}
    ${ordem}
    LIMIT ${limit}
  `;
}

/**
 * Fallback por trigrama (RF-34).
 *
 * A comparação é feita SEM ACENTO dos dois lados: `Autenticação` vs
 * `autentcacao` dá 0,22 com o texto cru (abaixo do limite de 0,3) e 0,43 sem
 * acento — ou seja, comparar cru simplesmente não encontraria o erro de
 * digitação que este fallback existe para cobrir.
 *
 * Os dois operadores são indexáveis por `note_title_trgm_unaccent_idx`:
 *   `<%` — alguma palavra do título casa bem com o termo (limite 0,6)
 *   `%`  — o título inteiro parece com o termo (limite 0,3)
 */
async function porSimilaridade(
  userId: string,
  texto: string,
  limit: number,
  filtros: { kind: NoteKind | null; tag: string | null; workspace: string | null },
): Promise<LinhaBruta[]> {
  const filtroSql = fragmentosDeFiltro(filtros);

  // O termo aparece repetido de propósito: colocá-lo num CTE (`WITH termo AS …`)
  // faz o planner perder o índice e cair em varredura sequencial. Verificado
  // por EXPLAIN — com a expressão inline ele usa note_title_trgm_unaccent_idx.
  return prisma.$queryRaw<LinhaBruta[]>`
    SELECT n.id, n.title, n.kind, n.updated_at, w.name AS workspace_name,
           left(regexp_replace(n.content_md, '\s+', ' ', 'g'), 160) AS snippet
    FROM note n
    LEFT JOIN workspace w ON w.id = n.workspace_id
    WHERE n.user_id = ${userId}::uuid
      AND n.deleted_at IS NULL
      AND (lower(public.immutable_unaccent(${texto})) <% lower(public.immutable_unaccent(n.title))
           OR lower(public.immutable_unaccent(${texto})) % lower(public.immutable_unaccent(n.title)))
    ${filtroSql}
    ORDER BY greatest(
      word_similarity(lower(public.immutable_unaccent(${texto})),
                      lower(public.immutable_unaccent(n.title))),
      similarity(lower(public.immutable_unaccent(${texto})),
                 lower(public.immutable_unaccent(n.title)))
    ) DESC
    LIMIT ${limit}
  `;
}

export { recentes };
