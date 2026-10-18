import type { Prisma } from "@prisma/client";
import type { HabitColor, MoodDayItem, MoodInput, MoodsInsights } from "@yu-book/shared";
import {
  DIAS_DO_INSIGHT,
  MAX_DIAS_DO_HISTORICO,
  MAX_DIAS_RETROATIVOS,
  diasEntre,
  ehDiaCivil,
  humorComESem,
  somarDias,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError } from "../../lib/errors.js";
import type { OrigemIA } from "../../lib/marca.js";
import { camposDoRegistro, hojeDoUsuario, paraColunaDia } from "../habitos/vinculo.service.js";

/**
 * Humor — frente Ritmo, Ritmo 4 (docs/prd-ritmo.md, §7).
 *
 * Uma linha por usuário e dia (`@@unique([userId, day])`), com posse direta
 * por `user_id` (INV-01). Nunca dá pontos (RN-26): não toca em `habit_entry`.
 */

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);
const paraDia = (data: Date) => data.toISOString().slice(0, 10);

const CAMPOS = {
  day: true,
  morning: true,
  midday: true,
  evening: true,
  note: true,
  aiVia: true,
  aiAuthor: true,
  aiAgentName: true,
  updatedAt: true,
} satisfies Prisma.MoodDaySelect;

type Linha = Prisma.MoodDayGetPayload<{ select: typeof CAMPOS }>;

function paraHumor(linha: Linha): MoodDayItem {
  return {
    day: paraDia(linha.day),
    morning: linha.morning,
    midday: linha.midday,
    evening: linha.evening,
    note: linha.note,
    ai: linha.aiVia
      ? { via: linha.aiVia, author: linha.aiAuthor, agentName: linha.aiAgentName }
      : null,
    updatedAt: linha.updatedAt.toISOString(),
  };
}

/**
 * RF-40: grava o humor do dia, mesclando no que já existe (o omitido fica,
 * o `null` apaga). O dia vai de 30 dias atrás até hoje (RN-27), conferido aqui
 * porque só o servidor sabe o hoje do usuário. Se o resultado ficar vazio, a
 * linha some (RN-28) e a resposta é `null`.
 */
export async function gravarHumor(
  userId: string,
  input: Omit<MoodInput, "origin">,
  origem?: OrigemIA,
): Promise<MoodDayItem | null> {
  const hoje = await hojeDoUsuario(userId);
  const dia = input.day ?? hoje;
  if (!ehDiaCivil(dia)) throw invalido("Use uma data que exista, no formato AAAA-MM-DD");
  const atras = diasEntre(dia, hoje);
  if (atras < 0) throw invalido("Humor no futuro não vale");
  if (atras > MAX_DIAS_RETROATIVOS) {
    throw invalido(`Humor de no máximo ${MAX_DIAS_RETROATIVOS} dias atrás`);
  }

  const mudanca = {
    ...(input.morning !== undefined && { morning: input.morning }),
    ...(input.midday !== undefined && { midday: input.midday }),
    ...(input.evening !== undefined && { evening: input.evening }),
    ...(input.note !== undefined && { note: input.note?.trim() || null }),
    ...camposDoRegistro(origem),
  };
  const chave = { userId_day: { userId, day: paraColunaDia(dia) } };
  const linha = await prisma.moodDay.upsert({
    where: chave,
    create: { userId, day: paraColunaDia(dia), ...mudanca },
    update: mudanca,
    select: CAMPOS,
  });
  const vazio =
    linha.morning === null && linha.midday === null && linha.evening === null && !linha.note;
  if (vazio) {
    await prisma.moodDay.deleteMany({ where: { userId, day: paraColunaDia(dia) } });
    return null;
  }
  return paraHumor(linha);
}

/** RF-41. Sem período, os últimos 30 dias até hoje. Mais recentes primeiro. */
export async function listarHumor(
  userId: string,
  periodo: { from?: string; to?: string },
): Promise<MoodDayItem[]> {
  const hoje = await hojeDoUsuario(userId);
  const ate = periodo.to ?? hoje;
  const de = periodo.from ?? somarDias(ate, -MAX_DIAS_RETROATIVOS);
  const dias = diasEntre(de, ate);
  if (dias < 0) throw invalido("O fim do período não pode ser antes do início");
  if (dias + 1 > MAX_DIAS_DO_HISTORICO) {
    throw invalido(`No máximo ${MAX_DIAS_DO_HISTORICO} dias por consulta`);
  }
  const linhas = await prisma.moodDay.findMany({
    where: { userId, day: { gte: paraColunaDia(de), lte: paraColunaDia(ate) } },
    select: CAMPOS,
    orderBy: { day: "desc" },
  });
  return linhas.map(paraHumor);
}

/**
 * RF-42: para cada hábito ativo, o humor nos dias com registro dele e nos
 * dias sem, nos últimos 30 dias. Duas consultas: o humor da janela e os dias
 * com registro por hábito. O cartão sem amostra nos dois lados não sai.
 */
export async function cruzarHumor(userId: string): Promise<MoodsInsights> {
  const hoje = await hojeDoUsuario(userId);
  const de = somarDias(hoje, -(DIAS_DO_INSIGHT - 1));
  const janela = { gte: paraColunaDia(de), lte: paraColunaDia(hoje) };
  const [humor, registros, habitos] = await Promise.all([
    prisma.moodDay.findMany({ where: { userId, day: janela }, select: CAMPOS }),
    prisma.habitEntry.groupBy({
      by: ["habitId", "day"],
      where: { userId, day: janela },
      _sum: { points: true },
    }),
    prisma.habit.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const dias = humor.map(paraHumor);
  const diasDoHabito = new Map<string, Set<string>>();
  const pontosDoDia = new Map<string, number>();
  for (const r of registros) {
    const dia = paraDia(r.day);
    pontosDoDia.set(dia, (pontosDoDia.get(dia) ?? 0) + (r._sum.points ?? 0));
    const conjunto = diasDoHabito.get(r.habitId) ?? new Set<string>();
    conjunto.add(paraDia(r.day));
    diasDoHabito.set(r.habitId, conjunto);
  }
  const cartoes = habitos.flatMap((h) => {
    const cruzado = humorComESem(dias, diasDoHabito.get(h.id) ?? new Set());
    return cruzado
      ? [{ habitId: h.id, habitName: h.name, color: h.color as HabitColor, ...cruzado }]
      : [];
  });
  const points = [...pontosDoDia]
    .map(([day, pontos]) => ({ day, points: pontos }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return { from: de, to: hoje, habits: cartoes, points };
}

/** RF-43: os dias com humor, para a ofensiva geral. */
export async function diasComHumor(userId: string): Promise<string[]> {
  const linhas = await prisma.moodDay.findMany({ where: { userId }, select: { day: true } });
  return linhas.map((l) => paraDia(l.day));
}
