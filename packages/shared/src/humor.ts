import { z } from "zod";
import { diaCivilSchema, diasEntre, ehDiaCivil } from "./eventos.js";
import type { HabitColor } from "./habitos.js";
import { MAX_DIAS_DO_HISTORICO } from "./habitos.js";
import type { AiCompletion } from "./marca.js";
import { origemMcpSchema } from "./marca.js";

/* ---------------------------------------------------------------
   Humor (frente Ritmo, Ritmo 4 — docs/prd-ritmo.md, §7)

   Uma linha por dia, com três momentos de 1 a 5 e uma descrição. Nunca dá
   pontos (P4): só acende a ofensiva geral (RF-43).
   --------------------------------------------------------------- */

export const MOMENTOS_DO_HUMOR = ["morning", "midday", "evening"] as const;
export type MomentoDoHumor = (typeof MOMENTOS_DO_HUMOR)[number];

/** Os nomes de 1 a 5, na ordem. O índice é o valor menos um. */
export const NOMES_DO_HUMOR = ["Péssimo", "Mal", "Ok", "Bem", "Ótimo"] as const;
export const NOMES_DOS_MOMENTOS: Record<MomentoDoHumor, string> = {
  morning: "Manhã",
  midday: "Durante",
  evening: "Noite",
};

export const MAX_HUMOR_NOTA = 1000;
/** RF-42: os cartões olham para os últimos 30 dias. */
export const DIAS_DO_INSIGHT = 30;
/** RF-42: um lado com menos dias que isto não vira cartão. */
export const MINIMO_POR_LADO = 7;

const valor = z.number().int("Humor inteiro").min(1, "De 1 a 5").max(5, "De 1 a 5");

/**
 * RF-40: o humor de um dia. Mescla: o campo omitido fica como está, e o `null`
 * apaga. Sem `day`, vale hoje no fuso do usuário — quem resolve é o servidor
 * (RN-27), que também confere a janela de 30 dias.
 */
export const moodInputSchema = z
  .object({
    day: diaCivilSchema.optional(),
    morning: valor.nullable().optional(),
    midday: valor.nullable().optional(),
    evening: valor.nullable().optional(),
    note: z.string().trim().max(MAX_HUMOR_NOTA, "Descrição grande demais").nullable().optional(),
    /// Só o servidor MCP envia — a marca de quem gravou.
    origin: origemMcpSchema.optional(),
  })
  .refine(
    (v) =>
      v.morning !== undefined ||
      v.midday !== undefined ||
      v.evening !== undefined ||
      v.note !== undefined,
    "Mande pelo menos um momento ou a descrição",
  );
export type MoodInput = z.input<typeof moodInputSchema>;

/** RF-41. Sem `from`/`to`, os últimos 30 dias até hoje. */
export const moodsQuerySchema = z
  .object({ from: diaCivilSchema.optional(), to: diaCivilSchema.optional() })
  .superRefine(({ from, to }, ctx) => {
    if (!from || !to || !ehDiaCivil(from) || !ehDiaCivil(to)) return;
    const dias = diasEntre(from, to);
    if (dias < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "O fim do período não pode ser antes do início",
      });
    } else if (dias + 1 > MAX_DIAS_DO_HISTORICO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `No máximo ${MAX_DIAS_DO_HISTORICO} dias por consulta`,
      });
    }
  });

export interface MoodDayItem {
  day: string;
  morning: number | null;
  midday: number | null;
  evening: number | null;
  note: string | null;
  /** Quem gravou, quando foi o MCP. */
  ai: AiCompletion | null;
  updatedAt: string;
}

/** RN-29: a média dos momentos preenchidos, ou `null` sem nenhum. */
export function mediaDoDia(dia: Pick<MoodDayItem, MomentoDoHumor>): number | null {
  const valores = MOMENTOS_DO_HUMOR.map((m) => dia[m]).filter((v): v is number => v !== null);
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}

export interface LadoDoInsight {
  /** A média das médias dos dias, com uma casa. */
  average: number;
  n: number;
}

/**
 * RF-42 e RNF-16: a média do humor nos dias em `diasCom` e nos outros, entre
 * os dias com humor. `null` quando um lado tem menos de `MINIMO_POR_LADO` dias:
 * com pouca amostra, a diferença é ruído, e o cartão não sai.
 */
export function humorComESem(
  dias: ReadonlyArray<Pick<MoodDayItem, "day" | MomentoDoHumor>>,
  diasCom: ReadonlySet<string>,
): { with: LadoDoInsight; without: LadoDoInsight } | null {
  const com: number[] = [];
  const sem: number[] = [];
  for (const d of dias) {
    const media = mediaDoDia(d);
    if (media === null) continue;
    (diasCom.has(d.day) ? com : sem).push(media);
  }
  if (com.length < MINIMO_POR_LADO || sem.length < MINIMO_POR_LADO) return null;
  const lado = (v: number[]) => ({
    average: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10,
    n: v.length,
  });
  return { with: lado(com), without: lado(sem) };
}

export interface MoodInsight {
  habitId: string;
  habitName: string;
  color: HabitColor;
  with: LadoDoInsight;
  without: LadoDoInsight;
}

/** RF-42: `GET /moods/insights`. */
export interface MoodsInsights {
  from: string;
  to: string;
  habits: MoodInsight[];
  /** Os pontos de cada dia da janela com registro, somando os hábitos (RF-45). */
  points: { day: string; points: number }[];
}
