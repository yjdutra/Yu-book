import type { DiaDaBarra } from "@yu-book/cliente/ritmo/BarrasPonderadas";
import type { HabitItem } from "@yu-book/shared";
import { DIAS_LONGOS, diaDaSemana, diaMesCurto } from "../../lib/datas";

/// A letra do eixo, por `diaDaSemana` (0 = domingo).
const LETRAS = ["D", "S", "T", "Q", "Q", "S", "S"] as const;

/** Os sete dias de uma semana para `BarrasPonderadas`, com hoje e o que não chegou. */
export function diasDaBarra(
  dias: ReadonlyArray<{ day: string; points: number }>,
  hoje: string,
): DiaDaBarra[] {
  return dias.map((d) => {
    const n = diaDaSemana(d.day);
    return {
      dia: d.day,
      letra: LETRAS[n] ?? "",
      nome: DIAS_LONGOS[n] ?? d.day,
      pontos: d.points,
      hoje: d.day === hoje,
      futuro: d.day > hoje,
    };
  });
}

/**
 * A semana de todos os hábitos ativos: os pontos por dia somados, e o que
 * conta sobre a soma das metas (RF-19). Todos têm a mesma semana — o servidor
 * a calcula pelo mesmo hoje —, então os dias do primeiro servem de molde.
 */
export function semanaDeTodos(habitos: HabitItem[]) {
  const molde = habitos[0]?.week;
  const dias = (molde?.days ?? []).map((d) => ({
    day: d.day,
    points: habitos.reduce(
      (soma, h) => soma + (h.week.days.find((x) => x.day === d.day)?.points ?? 0),
      0,
    ),
  }));
  return {
    inicio: molde?.start ?? null,
    fim: molde?.end ?? null,
    dias,
    conta: habitos.reduce((soma, h) => soma + h.week.progress, 0),
    meta: habitos.reduce((soma, h) => soma + h.weeklyGoal, 0),
    diasAtivos: dias.filter((d) => d.points > 0).length,
  };
}

/** "13 – 19 de out", ou "29 de set – 5 de out" quando o mês vira. */
export function periodoCurto(inicio: string, fim: string): string {
  const mesmoMes = inicio.slice(0, 7) === fim.slice(0, 7);
  return mesmoMes
    ? `${Number(inicio.slice(8))} – ${diaMesCurto(fim)}`
    : `${diaMesCurto(inicio)} – ${diaMesCurto(fim)}`;
}

/** "1.265" — o separador de milhar do português. */
export const milhar = (n: number) => n.toLocaleString("pt-BR");
