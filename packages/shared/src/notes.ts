import { z } from "zod";
import { NOTE_KINDS } from "./enums.js";
import type { NoteKind } from "./enums.js";
// Só de tipo, nos dois sentidos: some na compilação, então não há ciclo real.
import type { CardRef } from "./kanban.js";

export const MAX_TITULO = 200;
export const MAX_CONTEUDO = 1_000_000; // RNF-21: 1 MB

export const noteKindSchema = z.enum(NOTE_KINDS);

export const tituloSchema = z
  .string()
  .trim()
  .min(1, "O título é obrigatório")
  .max(MAX_TITULO, `O título passa de ${MAX_TITULO} caracteres`);

/**
 * `meta` é livre por design (RF-45): campos específicos de um tipo de nota
 * entram aqui sem migration. Só limitamos profundidade aceitando valores rasos.
 */
export const metaSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const createNoteSchema = z.object({
  title: tituloSchema,
  contentMd: z.string().max(MAX_CONTEUDO, "Nota grande demais").default(""),
  kind: noteKindSchema.default("livre"),
  workspaceId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  meta: metaSchema.default({}),
  sourceUrl: z.string().url("URL inválida").max(2000).nullable().default(null),
  occurredAt: z.coerce.date().nullable().default(null),
});

export const updateNoteSchema = createNoteSchema
  .extend({ isFavorite: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

export const NOTE_SORTS = ["updatedAt", "createdAt", "occurredAt", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

/** Filtros combináveis da listagem (RF-07). Todos opcionais e cumulativos. */
export const listNotesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: noteKindSchema.optional(),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((t) => t.trim()).filter(Boolean) : [])),
  workspaceId: z.string().uuid().optional(),
  favorite: z.enum(["true", "false"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(NOTE_SORTS).default("updatedAt"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** `true` lista só a lixeira (RF-06). */
  trash: z.enum(["true", "false"]).default("false"),
});

export type CreateNoteInput = z.input<typeof createNoteSchema>;
export type UpdateNoteInput = z.input<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

export interface NoteTagRef {
  id: string;
  name: string;
  color: string;
}

export interface NoteRef {
  id: string;
  title: string;
  kind: NoteKind;
}

/** O que a coluna do meio precisa — sem o corpo, que pode ter 1 MB. */
export interface NoteSummary {
  id: string;
  title: string;
  kind: NoteKind;
  excerpt: string;
  workspaceId: string | null;
  workspaceName: string | null;
  tags: NoteTagRef[];
  isFavorite: boolean;
  occurredAt: string | null;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface NoteDetail extends NoteSummary {
  contentMd: string;
  meta: Record<string, string | number | boolean>;
  sourceUrl: string | null;
  /** Notas que apontam para esta (RF-26). */
  backlinks: NoteRef[];
  /** Cards que referenciam esta nota (RF-38). */
  cards: CardRef[];
}

export interface NoteListResponse {
  items: NoteSummary[];
  nextCursor: string | null;
}

export interface NoteCounts {
  total: number;
  trash: number;
  favorites: number;
  byKind: Record<NoteKind, number>;
}
