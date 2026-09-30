import { z } from "zod";
import { CARD_PRIORITIES } from "./enums.js";
import type { CardPriority } from "./enums.js";
import { origemMcpSchema } from "./marca.js";
import type { AiCompletion, AiMark } from "./marca.js";
import type { NoteRef } from "./notes.js";

// RNF-18: limites explícitos, iguais na API e no front.
export const MAX_CARD_TITULO = 200;
export const MAX_CARD_DESCRICAO = 100_000;
export const MAX_CHECKLIST_ITENS = 50;
export const MAX_CHECKLIST_TEXTO = 200;
export const MAX_COLUNAS = 20;
export const MAX_NOME = 60;
export const MAX_TAGS_CARD = 8;
export const MAX_TAG_TEXTO = 24;

export const cardPrioritySchema = z.enum(CARD_PRIORITIES);

const nomeSchema = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(MAX_NOME, `O nome passa de ${MAX_NOME} caracteres`);

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(MAX_CHECKLIST_TEXTO),
  done: z.boolean(),
});

export const checklistSchema = z
  .array(checklistItemSchema)
  .max(MAX_CHECKLIST_ITENS, `No máximo ${MAX_CHECKLIST_ITENS} itens`);

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/* ------------------------------------------------------------------ tags */

/**
 * Forma canônica de uma etiqueta de card (RF-01, RN-01).
 *
 * **Não remove acento**: `revisão` é gravada `revisão`. Quem precisa casar
 * `revisao` com `revisão` usa `normalizarTitulo` como chave de comparação —
 * é a mesma função que espelha `immutable_unaccent` no banco, e uma terceira
 * definição de "mesmo texto" neste projeto seria dívida.
 *
 * Devolve string vazia para entrada que não sobra nada; quem chama filtra.
 */
export function normalizarTag(bruto: string): string {
  return bruto
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, MAX_TAG_TEXTO)
    .trim();
}

/**
 * Os dois limites são de naturezas diferentes, de propósito: **quantidade** é
 * recusa (como `checklistSchema` faz), porque passar de 8 é engano de quem
 * chama; **tamanho de uma tag** é cosmético e `normalizarTag` corta em silêncio
 * (RN-01) em vez de derrubar a requisição inteira por um caractere a mais.
 */
export const cardTagsSchema = z
  .array(z.string().max(200))
  .max(MAX_TAGS_CARD, `No máximo ${MAX_TAGS_CARD} tags por card`);

/* ---------------------------------------------------------------- boards */

export const boardInputSchema = z.object({
  name: nomeSchema,
  /** RN-03: board sempre pertence a um workspace. */
  workspaceId: z.string().uuid("Escolha um workspace"),
});

export const boardUpdateSchema = z.object({ name: nomeSchema });

export type BoardInput = z.input<typeof boardInputSchema>;

/* --------------------------------------------------------------- colunas */

export const columnInputSchema = z.object({
  boardId: z.string().uuid(),
  name: nomeSchema,
  wipLimit: z.number().int().min(1).max(99).nullable().default(null),
});

export const columnUpdateSchema = z
  .object({
    name: nomeSchema.optional(),
    wipLimit: z.number().int().min(1).max(99).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

export const columnMoveSchema = z.object({ position: z.number().int().min(0) });

/**
 * RF-16: excluir coluna com cards exige dizer o que fazer com eles — mover
 * para outra coluna ou excluir junto. Sem nenhum dos dois, a API recusa com
 * `COLUNA_COM_CARDS` em vez de decidir sozinha.
 */
export const columnDeleteQuerySchema = z.object({
  moveCardsTo: z.string().uuid().optional(),
  deleteCards: z.enum(["true", "false"]).optional(),
});

export type ColumnInput = z.input<typeof columnInputSchema>;

/* ----------------------------------------------------------------- cards */

export const cardInputSchema = z.object({
  columnId: z.string().uuid(),
  title: z.string().trim().min(1, "Informe um título").max(MAX_CARD_TITULO),
  descriptionMd: z.string().max(MAX_CARD_DESCRICAO, "Descrição grande demais").default(""),
  dueDate: z.coerce.date().nullable().default(null),
  priority: cardPrioritySchema.default("media"),
  checklist: checklistSchema.default([]),
  tags: cardTagsSchema.default([]),
  noteId: z.string().uuid().nullable().default(null),
  /// Só o servidor MCP envia — ver `createNoteSchema.origin`.
  origin: origemMcpSchema.optional(),
});

/// Sem `origin`: a marca nasce na criação e nenhuma rota a altera. `completed`
/// aqui é a conclusão **à mão** — a da IA passa por `cardCompleteSchema`.
export const cardUpdateSchema = cardInputSchema
  .omit({ columnId: true, origin: true })
  .extend({ archived: z.boolean(), completed: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * Concluir ou reabrir pela rota própria (frente de cards, Parte 1).
 *
 * Existe à parte de `cardUpdateSchema` só para aceitar `origin`: é por aqui que
 * o servidor MCP conclui e deixa a marca de quem concluiu. A atualização comum
 * continua recusando `origin`, e o front conclui por ela.
 */
export const cardCompleteSchema = z.object({
  completed: z.boolean(),
  origin: origemMcpSchema.optional(),
});

/**
 * RN-02: `position` é o índice desejado na coluna de destino, já sem o card
 * de origem. Fora do intervalo é ajustado, não recusado.
 */
export const cardMoveSchema = z.object({
  columnId: z.string().uuid(),
  position: z.number().int().min(0),
});

export type CardInput = z.input<typeof cardInputSchema>;
export type CardUpdateInput = z.input<typeof cardUpdateSchema>;
export type CardCompleteInput = z.infer<typeof cardCompleteSchema>;
export type CardMoveInput = z.infer<typeof cardMoveSchema>;

/* --------------------------------------------------------------- retorno */

export interface BoardSummary {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  columnCount: number;
  cardCount: number;
}

/** O que a face do card mostra (RF-31) — sem descrição nem checklist inteiro. */
export interface CardSummary {
  id: string;
  columnId: string;
  title: string;
  position: number;
  dueDate: string | null;
  priority: CardPriority;
  checklistDone: number;
  checklistTotal: number;
  /** RF-07: etiquetas livres, na ordem em que foram aplicadas (RN-03). */
  tags: string[];
  note: NoteRef | null;
  /**
   * Última alteração do card. Está na face porque "o que está parado" é uma
   * pergunta sobre o quadro inteiro: sem isto, responder exigiria uma
   * requisição por card.
   */
  updatedAt: string;
  /// Etapa C da frente de IA: `null` quando o card é humano.
  ai: AiMark | null;
  /// Frente de cards, Parte 1: concluir não move o card nem o tira do quadro.
  completedAt: string | null;
  /// Quem concluiu, quando foi o assistente. Ver `AiCompletion`.
  aiCompletion: AiCompletion | null;
}

export interface ColumnDetail {
  id: string;
  name: string;
  position: number;
  wipLimit: number | null;
  cards: CardSummary[];
}

export interface BoardDetail {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  columns: ColumnDetail[];
  archivedCount: number;
}

export interface CardDetail extends CardSummary {
  boardId: string;
  boardName: string;
  columnName: string;
  descriptionMd: string;
  checklist: ChecklistItem[];
  archived: boolean;
}

/** Um card visto do lado da nota (RF-38). */
export interface CardRef {
  id: string;
  title: string;
  boardId: string;
  boardName: string;
  columnName: string;
}

/**
 * Progresso do checklist a partir do JSONB cru.
 *
 * Fica aqui porque a API calcula para a face do card e o front recalcula
 * enquanto você marca itens, antes do autosave — mesma contagem nos dois lados.
 */
export function progressoChecklist(valor: unknown): { done: number; total: number } {
  const itens = checklistSchema.safeParse(valor);
  if (!itens.success) return { done: 0, total: 0 };
  return {
    done: itens.data.filter((i) => i.done).length,
    total: itens.data.length,
  };
}
