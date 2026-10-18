import { z } from "zod";
import { diasEntre } from "./eventos.js";
import { HABIT_COLORS } from "./habitos.js";
import type { HabitColor } from "./habitos.js";
import type { AiCompletion } from "./marca.js";
import { origemMcpSchema } from "./marca.js";

/* ---------------------------------------------------------------
   Skills (frente Ritmo, Ritmo 5 — docs/prd-ritmo.md, §8)

   Modos de agir que o usuário quer internalizar. "Usei agora" grava um uso;
   o nível sai do número de usos (RF-50). Não dão pontos de hábito (P4).
   --------------------------------------------------------------- */

export const MAX_SKILL_NOME = 60;
export const MAX_SKILL_TEXTO = 500;

/**
 * O catálogo dos emblemas de skill, separado do de hábitos: o desenho de
 * cada um mora em `packages/cliente/src/Icones.tsx` (`ICONE_EMBLEMA_SKILL`).
 */
export const EMBLEMAS_DA_SKILL = [
  "raio",
  "ampulheta",
  "foguete",
  "alvo",
  "lapis",
  "escudo",
  "bussola",
  "coracao",
  "chave",
  "balanca",
] as const;
export type EmblemaDaSkill = (typeof EMBLEMAS_DA_SKILL)[number];

/** RF-50: o primeiro uso de cada nível. */
export const NIVEIS_DA_SKILL = [
  { key: "bronze", name: "Bronze", from: 1 },
  { key: "prata", name: "Prata", from: 15 },
  { key: "ouro", name: "Ouro", from: 50 },
  { key: "mestre", name: "Mestre", from: 150 },
] as const;
export type ChaveDoNivelDaSkill = "nova" | (typeof NIVEIS_DA_SKILL)[number]["key"];

export interface NivelDaSkill {
  key: ChaveDoNivelDaSkill;
  name: string;
  /** Os usos em que este nível começou. */
  from: number;
  /** Os usos do próximo nível, ou `null` no Mestre. */
  next: number | null;
  nextName: string | null;
}

/** RF-50: o nível de `usos`. Sem uso, "Nova". */
export function nivelDaSkill(usos: number): NivelDaSkill {
  let i = -1;
  for (const [j, n] of NIVEIS_DA_SKILL.entries()) if (usos >= n.from) i = j;
  const proximo = NIVEIS_DA_SKILL[i + 1] ?? null;
  const atual = NIVEIS_DA_SKILL[i];
  return {
    key: atual?.key ?? "nova",
    name: atual?.name ?? "Nova",
    from: atual?.from ?? 0,
    next: proximo?.from ?? null,
    nextName: proximo?.name ?? null,
  };
}

/**
 * RF-51 e RN-34: a skill do dia. As ativas, na ordem de posição e criação, e
 * a escolha pelo número do dia civil — o mesmo em todo aparelho no mesmo dia.
 */
export function skillDoDia<T extends { archived: boolean }>(
  skills: readonly T[],
  hoje: string,
): T | null {
  const ativas = skills.filter((s) => !s.archived);
  if (ativas.length === 0) return null;
  const numero = diasEntre("1970-01-01", hoje);
  return ativas[((numero % ativas.length) + ativas.length) % ativas.length] ?? null;
}

/* ------------------------------------------------------------- schemas */

const nome = z.string().trim().min(1, "Informe um nome").max(MAX_SKILL_NOME, "Nome grande demais");
const texto = z.string().trim().max(MAX_SKILL_TEXTO, "Texto grande demais");

/** RF-48. */
export const skillInputSchema = z.object({
  name: nome,
  description: texto.default(""),
  whenToUse: texto.default(""),
  emblem: z.enum(EMBLEMAS_DA_SKILL).default("raio"),
  color: z.enum(HABIT_COLORS).default("violeta"),
});

export const skillUpdateSchema = z
  .object({
    name: nome,
    description: texto,
    whenToUse: texto,
    emblem: z.enum(EMBLEMAS_DA_SKILL),
    color: z.enum(HABIT_COLORS),
    archived: z.boolean(),
    position: z.number().int().min(0),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/** RF-49: o corpo de `POST /skills/:id/uses`. Só o MCP manda `origin`. */
export const skillUseInputSchema = z.object({ origin: origemMcpSchema.optional() });

export const skillsQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type SkillInput = z.input<typeof skillInputSchema>;
export type SkillUpdateInput = z.input<typeof skillUpdateSchema>;

/* ------------------------------------------------------------- respostas */

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  emblem: EmblemaDaSkill;
  color: HabitColor;
  position: number;
  archived: boolean;
  uses: number;
  usesToday: number;
  lastUsedAt: string | null;
  level: NivelDaSkill;
  createdAt: string;
}

export interface SkillUseItem {
  id: string;
  skillId: string;
  usedAt: string;
  day: string;
  ai: AiCompletion | null;
}

/** RF-49: a resposta do uso. `levelUp` traz o nível novo quando subiu. */
export interface SkillUseResult {
  use: SkillUseItem;
  skill: SkillItem;
  levelUp: NivelDaSkill | null;
}
