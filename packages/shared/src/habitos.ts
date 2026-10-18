import { z } from "zod";
import type { AgentColor } from "./agentes.js";
import { diaDaSemana, somarDias } from "./agenda.js";
import { diaCivilSchema, diasEntre, ehDiaCivil } from "./eventos.js";
import type { AiCompletion } from "./marca.js";
import { origemMcpSchema } from "./marca.js";

/* ---------------------------------------------------------------
   Hábitos (frente Ritmo, Ritmo 1 — docs/prd-ritmo.md)

   Hábito → atividades pontuadas → registros. A semana ponderada é calculada
   na leitura (P3), aqui, para API, web e móvel contarem igual (RNF-02).
   --------------------------------------------------------------- */

export const MAX_HABITO_NOME = 80;
export const MAX_ATIVIDADE_NOME = 80;
export const MAX_ATIVIDADES_NA_CRIACAO = 20;
export const MAX_REGISTRO_NOTA = 500;
/** RN-01. */
export const MAX_META_SEMANAL = 5000;
export const MAX_PONTOS = 500;
/** RN-06: registro avulso de até 30 dias atrás. */
export const MAX_DIAS_RETROATIVOS = 30;
/** A janela de `GET /habits/:id/entries`, os dois dias inclusive. */
export const MAX_DIAS_DO_HISTORICO = 400;

/**
 * A mesma paleta dos agentes (`AGENT_COLORS`): seis cores que já passam AA com
 * texto branco. Repetida, e não importada, porque `agentes.ts` importa
 * `ferramentas.ts`, que importa este arquivo — o ciclo entregaria a constante
 * ainda indefinida ao `z.enum`. O `satisfies` cobra que nenhuma saia da paleta.
 */
export const HABIT_COLORS = [
  "violeta",
  "azul",
  "verde",
  "ambar",
  "rosa",
  "cinza",
] as const satisfies readonly AgentColor[];
export type HabitColor = (typeof HABIT_COLORS)[number];

/**
 * O catálogo fechado dos emblemas. O desenho de cada um mora em
 * `packages/cliente/src/Icones.tsx` (Ritmo 2); aqui só a chave, para o servidor
 * recusar o que a tela não sabe desenhar.
 */
export const EMBLEMAS_DO_HABITO = [
  "estrela",
  "idioma",
  "casa",
  "livro",
  "corpo",
  "foco",
  "mente",
  "dinheiro",
  "agua",
  "sono",
  "codigo",
  "musica",
] as const;
export type EmblemaDoHabito = (typeof EMBLEMAS_DO_HABITO)[number];

export const HABIT_ENTRY_ORIGINS = ["task", "event", "manual"] as const;
export type HabitEntryOrigin = (typeof HABIT_ENTRY_ORIGINS)[number];

/* ------------------------------------------------------------- schemas */

const nomeDoHabito = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(MAX_HABITO_NOME, "Nome grande demais");
const nomeDaAtividade = z
  .string()
  .trim()
  .min(1, "Informe um nome")
  .max(MAX_ATIVIDADE_NOME, "Nome grande demais");
const pontos = z
  .number()
  .int("Pontos inteiros")
  .min(1, "No mínimo 1 ponto")
  .max(MAX_PONTOS, `No máximo ${MAX_PONTOS} pontos`);
const metaSemanal = z
  .number()
  .int("Meta inteira")
  .min(1, "Meta de pelo menos 1 ponto")
  .max(MAX_META_SEMANAL, `Meta de no máximo ${MAX_META_SEMANAL} pontos`);
const diasAlvo = z.number().int("Dias inteiros").min(1, "De 1 a 7 dias").max(7, "De 1 a 7 dias");
const posicao = z.number().int().min(0);

export const habitActivityInputSchema = z.object({
  name: nomeDaAtividade,
  points: pontos,
});

/** RF-01: o hábito nasce com as atividades, numa transação só. */
export const habitInputSchema = z.object({
  name: nomeDoHabito,
  color: z.enum(HABIT_COLORS).default("violeta"),
  emblem: z.enum(EMBLEMAS_DO_HABITO).default("estrela"),
  weeklyGoal: metaSemanal,
  targetDays: diasAlvo,
  activities: z
    .array(habitActivityInputSchema)
    .max(MAX_ATIVIDADES_NA_CRIACAO, `No máximo ${MAX_ATIVIDADES_NA_CRIACAO} atividades`)
    .refine(
      (lista) => new Set(lista.map((a) => a.name)).size === lista.length,
      "Atividade com nome repetido",
    )
    .default([]),
});

/** RF-02 e RF-05. `archived` arquiva e desarquiva (RN-07). */
export const habitUpdateSchema = z
  .object({
    name: nomeDoHabito,
    color: z.enum(HABIT_COLORS),
    emblem: z.enum(EMBLEMAS_DO_HABITO),
    weeklyGoal: metaSemanal,
    targetDays: diasAlvo,
    archived: z.boolean(),
    position: posicao,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/** RF-03 e RF-05. */
export const habitActivityUpdateSchema = z
  .object({
    name: nomeDaAtividade,
    points: pontos,
    archived: z.boolean(),
    position: posicao,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * RF-09: registro fora do plano. Com `activityId`, os pontos vêm da atividade,
 * a menos que `points` diga outro valor; sem ela, `points` é obrigatório. Sem
 * `day`, vale hoje no fuso do usuário — quem resolve é o servidor (RN-05), e a
 * janela de RN-06 também, porque só ele sabe que dia é hoje.
 */
export const habitEntryInputSchema = z
  .object({
    activityId: z.string().uuid("Atividade inválida").optional(),
    points: pontos.optional(),
    day: diaCivilSchema.optional(),
    note: z.string().trim().max(MAX_REGISTRO_NOTA, "Nota grande demais").optional(),
    /// Só o servidor MCP envia — ver `createNoteSchema.origin` (RN-12).
    origin: origemMcpSchema.optional(),
  })
  .refine((v) => v.activityId !== undefined || v.points !== undefined, {
    path: ["points"],
    message: "Informe a atividade ou os pontos",
  });

export const habitsQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

/** RF-11. Sem `from`/`to`, o servidor usa os últimos 30 dias até hoje. */
export const habitEntriesQuerySchema = z
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

/** RF-08: o corpo de `POST /events/:id/check-in`. */
export const eventCheckInSchema = z.object({
  day: diaCivilSchema,
  origin: origemMcpSchema.optional(),
});

/** RF-08: a query de `DELETE /events/:id/check-in`. */
export const eventCheckInQuerySchema = z.object({ day: diaCivilSchema });

export type HabitInput = z.input<typeof habitInputSchema>;
export type HabitUpdateInput = z.input<typeof habitUpdateSchema>;
export type HabitActivityInput = z.input<typeof habitActivityInputSchema>;
export type HabitActivityUpdateInput = z.input<typeof habitActivityUpdateSchema>;
export type HabitEntryInput = z.input<typeof habitEntryInputSchema>;

/* ------------------------------------------------------------- respostas */

/** O que tarefa, série e evento mostram do vínculo (RF-06). */
export interface HabitActivityRef {
  id: string;
  name: string;
  points: number;
  habitId: string;
  habitName: string;
}

export interface HabitActivityItem {
  id: string;
  habitId: string;
  name: string;
  points: number;
  position: number;
  archived: boolean;
}

export interface HabitWeekDay {
  /** `AAAA-MM-DD`, segunda a domingo. */
  day: string;
  /** Tudo o que entrou no dia. */
  points: number;
  /** O que conta para a meta: `min(points, cap)`. */
  counted: number;
}

/** RF-10. */
export interface HabitWeek {
  start: string;
  end: string;
  cap: number;
  progress: number;
  extra: number;
  activeDays: number;
  goalMet: boolean;
  days: HabitWeekDay[];
}

export interface HabitItem {
  id: string;
  name: string;
  color: HabitColor;
  emblem: EmblemaDoHabito;
  weeklyGoal: number;
  targetDays: number;
  position: number;
  archived: boolean;
  activities: HabitActivityItem[];
  week: HabitWeek;
  createdAt: string;
  updatedAt: string;
}

export interface HabitEntryItem {
  id: string;
  habitId: string;
  activity: { id: string; name: string } | null;
  points: number;
  day: string;
  origin: HabitEntryOrigin;
  note: string | null;
  taskId: string | null;
  eventId: string | null;
  /** Quem registrou, quando foi o assistente (RN-12). */
  ai: AiCompletion | null;
  createdAt: string;
}

/* ------------------------------------------------------------- semana */

/** RF-10: o teto diário que impede pagar a semana num dia só. */
export function tetoDiario(weeklyGoal: number, targetDays: number): number {
  return Math.ceil(weeklyGoal / Math.max(1, targetDays));
}

/** A segunda-feira da semana de `dia`. Calendário puro, sem fuso (INV-66). */
export function inicioDaSemana(dia: string): string {
  return somarDias(dia, -((diaDaSemana(dia) + 6) % 7));
}

/**
 * RF-10: a semana de `hoje` (o dia local do usuário, já resolvido), a partir
 * dos registros. Registro fora da semana é ignorado, então quem chama pode
 * passar uma janela maior.
 */
export function semanaPonderada(
  habito: { weeklyGoal: number; targetDays: number },
  registros: ReadonlyArray<{ day: string; points: number }>,
  hoje: string,
): HabitWeek {
  const start = inicioDaSemana(hoje);
  const cap = tetoDiario(habito.weeklyGoal, habito.targetDays);
  const porDia = new Map<string, number>();
  for (const r of registros) porDia.set(r.day, (porDia.get(r.day) ?? 0) + r.points);
  const days: HabitWeekDay[] = [];
  let progress = 0;
  let extra = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const day = somarDias(start, i);
    const points = porDia.get(day) ?? 0;
    const counted = Math.min(points, cap);
    progress += counted;
    extra += points - counted;
    if (points > 0) activeDays++;
    days.push({ day, points, counted });
  }
  return {
    start,
    end: somarDias(start, 6),
    cap,
    progress,
    extra,
    activeDays,
    goalMet: progress >= habito.weeklyGoal,
    days,
  };
}
