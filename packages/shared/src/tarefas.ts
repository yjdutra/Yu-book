import { z } from "zod";
import { diaCivilSchema, horaCivilSchema } from "./eventos.js";
import type { BoardRef } from "./kanban.js";
import type { AiCompletion, AiMark } from "./marca.js";
import { origemMcpSchema } from "./marca.js";

/**
 * Tarefas — frente de agenda, Fase 1.
 *
 * O to-do solto, que **não é card**: não tem coluna, posição nem quadro
 * obrigatório. O quadro, quando há, faz as vezes de projeto.
 *
 * Nome de fronteira em inglês (`TaskItem`) e de arquivo em português, como o
 * resto; e nada de `Tarefa*` em tipo exportado — `TarefaComModelo` já nomeia a
 * tarefa **de IA** (`AiTask`), que é outra coisa.
 *
 * `date` é data **civil** (`AAAA-MM-DD`), guardada como `DATE`: "para 12/10" é
 * do dia 12 onde quer que se olhe, e não passa por fuso — ao contrário do prazo
 * do card, que é um instante às 23:59:59 e por isso depende do fuso para virar
 * dia (§4.5 do contrato). O fuso só entra para dizer o que é **hoje**, e daí
 * `overdue`.
 */

export const MAX_TAREFA_TITULO = 200;
export const MAX_TAREFA_DESCRICAO = 5000;

/// As concluídas mais recentes que `GET /tasks?status=concluidas` devolve.
export const LIMITE_TAREFAS_CONCLUIDAS = 100;

/// As abertas sem data que `GET /agenda` traz em `undatedTasks`, as mais
/// recentes primeiro — a que o chat quer concluir é quase sempre a recém-anotada.
/// Sem data elas não têm período, e o agregado é lido em todo `list_agenda` do
/// chat: um teto, declarado no texto quando é atingido.
export const LIMITE_TAREFAS_SEM_DATA = 50;

export const TASK_STATUSES = ["abertas", "concluidas", "todas"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const camposDaTarefa = z.object({
  title: z.string().trim().min(1, "Informe um título").max(MAX_TAREFA_TITULO),
  descriptionMd: z.string().max(MAX_TAREFA_DESCRICAO, "Descrição grande demais").default(""),
  date: diaCivilSchema.nullable().default(null),
  /// `HH:MM` local, só com `date`.
  time: horaCivilSchema.nullable().default(null),
  /// O projeto. Quadro de outra conta é 404, como inexistente.
  boardId: z.string().uuid("Quadro inválido").nullable().default(null),
  /// Só o servidor MCP envia — ver `createNoteSchema.origin`.
  origin: origemMcpSchema.optional(),
});

export const taskInputSchema = camposDaTarefa.refine((v) => v.time === null || v.date !== null, {
  path: ["time"],
  message: "Hora só com data: informe o dia",
});

/// Sem `origin` (INV-58), e sem conclusão: concluir tem rota própria, a que
/// grava quem concluiu. "Hora só com data" roda no servidor, sobre o mesclado.
export const taskUpdateSchema = camposDaTarefa
  .omit({ origin: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * Concluir ou reabrir, com a marca de quem pediu — o par de
 * `cardCompleteSchema` (INV-63). Sem `completed`, conclui.
 */
export const taskCompleteSchema = z.object({
  completed: z.boolean().default(true),
  origin: origemMcpSchema.optional(),
});

export const tasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).default("abertas"),
  boardId: z.string().uuid("Quadro inválido").optional(),
});

export type TaskInput = z.input<typeof taskInputSchema>;
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;
export type TaskCompleteInput = z.input<typeof taskCompleteSchema>;
export type TasksQuery = z.infer<typeof tasksQuerySchema>;

export interface TaskItem {
  id: string;
  title: string;
  descriptionMd: string;
  date: string | null;
  time: string | null;
  /// Aberta e com `date` antes de hoje **no fuso do usuário**.
  overdue: boolean;
  completedAt: string | null;
  /// Quem concluiu, quando foi o assistente; segue o estado (INV-63).
  completion: AiCompletion | null;
  board: BoardRef | null;
  ai: AiMark | null;
  createdAt: string;
  updatedAt: string;
}
