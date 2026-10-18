import { somarDias } from "./agenda.js";
import { inicioDaSemana, tetoDiario } from "./habitos.js";

/* ---------------------------------------------------------------
   Ofensivas e recordes (frente Ritmo, Ritmo 3 — docs/prd-ritmo.md, §6)

   Tudo calculado na leitura, a partir dos dias que tiveram registro (P3).
   Funções puras, sem fuso: recebem dias civis já resolvidos pelo servidor
   (INV-66) e o "hoje" do usuário (RNF-12).
   --------------------------------------------------------------- */

/** Uma sequência de dias ou de semanas seguidas. */
export interface Sequencia {
  /** O primeiro dia (na de semanas, a segunda-feira da primeira). */
  start: string;
  /** O último dia (na de semanas, o domingo da última). */
  end: string;
  /** Em dias ou em semanas, conforme a sequência. */
  length: number;
  /** Ainda pode crescer: termina hoje ou ontem (na de semanas, nesta ou na passada). */
  alive: boolean;
}

/** RN-22: maior primeiro; no empate, a mais recente. */
function compararSequencias(a: Sequencia, b: Sequencia): number {
  return b.length - a.length || (a.end < b.end ? 1 : a.end > b.end ? -1 : 0);
}

/** As `n` maiores, na ordem de RN-22. */
export function maiores<T extends Sequencia>(sequencias: readonly T[], n = 5): T[] {
  return [...sequencias].sort(compararSequencias).slice(0, n);
}

/**
 * RF-32: as sequências de dias seguidos. Uma termina viva se o último dia é
 * hoje ou ontem — sem o registro de hoje, a ofensiva ainda vale até a
 * meia-noite.
 */
export function sequenciasDeDias(dias: Iterable<string>, hoje: string): Sequencia[] {
  const ordenados = [...new Set(dias)].filter((d) => d <= hoje).sort();
  const ontem = somarDias(hoje, -1);
  const sequencias: Sequencia[] = [];
  let atual: Sequencia | null = null;
  for (const dia of ordenados) {
    if (atual && somarDias(atual.end, 1) === dia) {
      atual.end = dia;
      atual.length += 1;
    } else {
      if (atual) sequencias.push(atual);
      atual = { start: dia, end: dia, length: 1, alive: false };
    }
  }
  if (atual) sequencias.push(atual);
  for (const s of sequencias) s.alive = s.end === hoje || s.end === ontem;
  return sequencias;
}

/**
 * RF-33: as sequências de semanas seguidas, a partir das segundas-feiras das
 * semanas que contam. Viva se a última é esta ou a passada — a semana corrente
 * só entra quando já contou, e até lá a da semana passada segue de pé.
 */
export function sequenciasDeSemanas(segundas: Iterable<string>, hoje: string): Sequencia[] {
  const estaSemana = inicioDaSemana(hoje);
  const passada = somarDias(estaSemana, -7);
  const ordenadas = [...new Set(segundas)].filter((d) => d <= estaSemana).sort();
  const sequencias: { start: string; ultima: string; length: number }[] = [];
  for (const segunda of ordenadas) {
    const atual = sequencias[sequencias.length - 1];
    if (atual && somarDias(atual.ultima, 7) === segunda) {
      atual.ultima = segunda;
      atual.length += 1;
    } else {
      sequencias.push({ start: segunda, ultima: segunda, length: 1 });
    }
  }
  return sequencias.map((s) => ({
    start: s.start,
    end: somarDias(s.ultima, 6),
    length: s.length,
    alive: s.ultima === estaSemana || s.ultima === passada,
  }));
}

/** O tamanho da sequência viva, ou zero. */
export function ofensivaViva(sequencias: readonly Sequencia[]): number {
  return sequencias.find((s) => s.alive)?.length ?? 0;
}

/**
 * As segundas-feiras das semanas em que o hábito bateu a meta, pela conta de
 * RF-10 — o teto por dia sobre a soma do dia —, com a meta **atual** (RN-23).
 */
export function semanasComMeta(
  habito: { weeklyGoal: number; targetDays: number },
  pontosPorDia: ReadonlyMap<string, number>,
): string[] {
  const cap = tetoDiario(habito.weeklyGoal, habito.targetDays);
  const porSemana = new Map<string, number>();
  for (const [dia, pontos] of pontosPorDia) {
    const segunda = inicioDaSemana(dia);
    porSemana.set(segunda, (porSemana.get(segunda) ?? 0) + Math.min(pontos, cap));
  }
  return [...porSemana].filter(([, conta]) => conta >= habito.weeklyGoal).map(([s]) => s);
}

/** Uma semana com os pontos dela (RF-34). */
export interface SemanaDePontos {
  start: string;
  end: string;
  points: number;
}

/** RN-24: as `n` semanas com mais pontos, somando acima do teto. Empate: a mais recente. */
export function melhoresSemanas(
  pontosPorDia: ReadonlyMap<string, number>,
  n = 5,
): SemanaDePontos[] {
  const porSemana = new Map<string, number>();
  for (const [dia, pontos] of pontosPorDia) {
    const segunda = inicioDaSemana(dia);
    porSemana.set(segunda, (porSemana.get(segunda) ?? 0) + pontos);
  }
  return [...porSemana]
    .filter(([, pontos]) => pontos > 0)
    .map(([start, points]) => ({ start, end: somarDias(start, 6), points }))
    .sort((a, b) => b.points - a.points || (a.start < b.start ? 1 : -1))
    .slice(0, n);
}

/* ------------------------------------------------------------- respostas */

/** RF-35: a ofensiva geral, como `GET /habits/summary` a mostra. */
export interface StreakSummary {
  current: number;
  best: number;
  /** Hoje já tem registro: a ofensiva de hoje está garantida. */
  todayDone: boolean;
}

export interface HabitStreak {
  habitId: string;
  name: string;
  archived: boolean;
  /** Semanas seguidas com a meta batida, vivas. */
  current: number;
  best: number;
  bestWeek: SemanaDePontos | null;
}

/** RF-35: `GET /habits/streaks`. */
export interface HabitsStreaks {
  today: string;
  general: StreakSummary;
  /** Os dias com registro nos últimos `MAX_DIAS_DO_HISTORICO` dias (RN-25). */
  activeDays: string[];
  habits: HabitStreak[];
  records: {
    days: Sequencia[];
    habitWeeks: (Sequencia & { habitId: string; habitName: string })[];
    weeks: SemanaDePontos[];
  };
}

/** A ofensiva geral a partir dos dias ativos. */
export function resumoDaOfensiva(dias: Iterable<string>, hoje: string): StreakSummary {
  const lista = [...dias];
  const sequencias = sequenciasDeDias(lista, hoje);
  return {
    current: ofensivaViva(sequencias),
    best: sequencias.reduce((m, s) => Math.max(m, s.length), 0),
    todayDone: lista.includes(hoje),
  };
}
