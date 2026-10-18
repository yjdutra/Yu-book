import { z } from "zod";
import { diaCivilSchema } from "./eventos.js";
import type { HabitEntryItem } from "./habitos.js";

/* ---------------------------------------------------------------
   Foco (frente Ritmo, Ritmo 6 — docs/prd-ritmo.md, §9)

   O timer roda no aparelho, guardando o instante final (RF-54); só o
   pomodoro concluído vira sessão (RN-35).
   --------------------------------------------------------------- */

/** RF-55: os três modos, em minutos. */
export const MODOS_DO_FOCO = [
  { key: "foco", name: "Foco 25", minutes: 25 },
  { key: "pausa", name: "Pausa 5", minutes: 5 },
  { key: "pausaLonga", name: "Pausa 15", minutes: 15 },
] as const;
export type ModoDoFoco = (typeof MODOS_DO_FOCO)[number]["key"];

/** RF-55: o ciclo de pomodoros antes da pausa longa. */
export const POMODOROS_DO_CICLO = 4;
export const MAX_MINUTOS_DO_FOCO = 120;
/** RN-36: a folga para o relógio do aparelho, e o mais antigo que se aceita. */
export const FOLGA_DO_FOCO = 0.9;
export const MAX_HORAS_DO_FOCO = 6;

/** RF-56: o corpo de `POST /focus-sessions`. */
export const focusSessionInputSchema = z.object({
  clientId: z.string().uuid("Id do aparelho inválido"),
  activityId: z.string().uuid("Atividade inválida").nullable().optional(),
  minutes: z
    .number()
    .int()
    .min(1, "De 1 minuto")
    .max(MAX_MINUTOS_DO_FOCO, `Até ${MAX_MINUTOS_DO_FOCO} minutos`),
  startedAt: z.string().datetime({ offset: true, message: "Início inválido" }),
});
export type FocusSessionInput = z.input<typeof focusSessionInputSchema>;

/** RF-57. Sem período, hoje. */
export const focusSessionsQuerySchema = z.object({
  from: diaCivilSchema.optional(),
  to: diaCivilSchema.optional(),
});

export interface FocusSessionItem {
  id: string;
  clientId: string;
  activity: { id: string; name: string; habitId: string } | null;
  minutes: number;
  startedAt: string;
  endedAt: string;
  day: string;
  /** Os pontos que a sessão rendeu, ou 0. */
  points: number;
}

/** RF-56: a sessão gravada e o registro que ela rendeu, se houver. */
export interface FocusSessionResult {
  session: FocusSessionItem;
  entry: HabitEntryItem | null;
}
