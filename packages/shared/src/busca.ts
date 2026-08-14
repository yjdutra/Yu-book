import { z } from "zod";
import { NOTE_KINDS } from "./enums.js";
import type { NoteKind } from "./enums.js";

/**
 * Marcadores de destaque do `ts_headline`. São caracteres de controle: não
 * existem em texto digitado, então não há como uma nota forjar um destaque.
 */
export const HL_START = "\u0001";
export const HL_END = "\u0002";

export const searchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface SearchResult {
  id: string;
  title: string;
  kind: NoteKind;
  workspaceName: string | null;
  updatedAt: string;
  /** Trecho com HL_START/HL_END em volta dos termos encontrados. */
  snippet: string;
  /** true quando veio do fallback por similaridade de título (RF-34). */
  approximate: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Filtros que foram extraídos do texto digitado, para exibir como chips. */
  filtros: SearchFilters;
  approximate: boolean;
}

export interface SearchFilters {
  kind: NoteKind | null;
  tag: string | null;
  workspace: string | null;
}

export interface ParsedSearch extends SearchFilters {
  /** O que sobrou depois de retirar os filtros — vai para o full-text. */
  text: string;
}

const PREFIXO_TIPO = /(?:^|\s)tipo:(\S+)/i;
const PREFIXO_TAG = /(?:^|\s)tag:(\S+)/i;
const PREFIXO_WS = /(?:^|\s)#(\S+)/;

/**
 * Extrai `tipo:aula`, `tag:jwt` e `#coders` do texto digitado (RF-35).
 * Usado pela API para filtrar e pela paleta para mostrar os chips — mesma
 * função nos dois lados, então não há como divergirem.
 */
export function parseSearchQuery(input: string): ParsedSearch {
  let text = input;
  let kind: NoteKind | null = null;
  let tag: string | null = null;
  let workspace: string | null = null;

  const tipoMatch = text.match(PREFIXO_TIPO);
  if (tipoMatch?.[1]) {
    const candidato = tipoMatch[1].toLowerCase();
    // `tipo:xpto` não é filtro válido: deixa o termo na busca textual.
    if ((NOTE_KINDS as readonly string[]).includes(candidato)) {
      kind = candidato as NoteKind;
      text = text.replace(PREFIXO_TIPO, " ");
    }
  }

  const tagMatch = text.match(PREFIXO_TAG);
  if (tagMatch?.[1]) {
    tag = tagMatch[1].toLowerCase();
    text = text.replace(PREFIXO_TAG, " ");
  }

  const wsMatch = text.match(PREFIXO_WS);
  if (wsMatch?.[1]) {
    workspace = wsMatch[1];
    text = text.replace(PREFIXO_WS, " ");
  }

  return { text: text.trim().replace(/\s+/g, " "), kind, tag, workspace };
}

/** Quebra o snippet nos marcadores, para o front renderizar sem usar HTML cru. */
export function splitHighlight(snippet: string): { text: string; hl: boolean }[] {
  const partes: { text: string; hl: boolean }[] = [];
  const regex = new RegExp(`${HL_START}(.*?)${HL_END}`, "gs");
  let ultimo = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(snippet)) !== null) {
    if (match.index > ultimo) {
      partes.push({ text: snippet.slice(ultimo, match.index), hl: false });
    }
    partes.push({ text: match[1] ?? "", hl: true });
    ultimo = match.index + match[0].length;
  }

  if (ultimo < snippet.length) partes.push({ text: snippet.slice(ultimo), hl: false });
  return partes;
}
