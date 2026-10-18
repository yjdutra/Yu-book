// Valor de `shared` (`quantoConta`, `tetoDiario`), contra a regra do pacote, e
// de propósito, como em `hoje.ts`: a conta do teto é uma só no projeto (RN-16
// de `docs/prd-ritmo.md`), e uma cópia aqui divergiria do servidor calada. Só o
// móvel importa este módulo; o web não lê hábitos.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { quantoConta } from "@yu-book/shared";
import type {
  AgendaRange,
  EventItem,
  HabitEntryInput,
  HabitEntryItem,
  HabitItem,
  HabitsStreaks,
  HabitsSummary,
} from "@yu-book/shared";
import { api } from "./api";
import { CHAVE_AGENDA, CHAVE_HABITOS, invalidarAgenda } from "./agenda";

/**
 * Hábitos nos fronts (frente Ritmo, Ritmo 2 — `docs/prd-ritmo.md`, §5): a
 * lista com a semana, o resumo de XP, o histórico de um hábito, o registro
 * fora do plano e o check-in de evento.
 *
 * **Toda query daqui começa por `CHAVE_HABITOS`**, e quem escreve invalida o
 * prefixo — a mesma convenção de `agenda.ts`. `invalidarAgenda` também o
 * invalida, porque concluir tarefa ligada pontua.
 *
 * **O hoje é o do usuário** (INV-66): `HabitsSummary.today`, nunca o aparelho.
 */

export { CHAVE_HABITOS };

/* --------------------------------------------------------------- leitura */

/** RF-04: os hábitos ativos com a semana corrente. */
export function useHabitos() {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "lista"],
    queryFn: () => api.get<HabitItem[]>("/habits"),
    // O registro chega de outro lugar — o MCP, o chat, o outro aparelho.
    refetchOnWindowFocus: true,
  });
}

/** Um hábito. Enquanto a leitura própria não chega, o da lista serve de prévia. */
export function useHabito(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "um", id],
    queryFn: () => api.get<HabitItem>(`/habits/${id}`),
    enabled: Boolean(id),
    placeholderData: () =>
      qc.getQueryData<HabitItem[]>([...CHAVE_HABITOS, "lista"])?.find((h) => h.id === id),
    refetchOnWindowFocus: true,
  });
}

/** RF-31: XP, nível e o hoje do usuário. */
export function useResumoRitmo() {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "resumo"],
    queryFn: () => api.get<HabitsSummary>("/habits/summary"),
    refetchOnWindowFocus: true,
  });
}

/** RF-35 (Ritmo 3): ofensivas, a de cada hábito e os recordes. */
export function useOfensivas() {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "ofensivas"],
    queryFn: () => api.get<HabitsStreaks>("/habits/streaks"),
    refetchOnWindowFocus: true,
  });
}

/** RF-11: os registros de `de` a `ate`, os dois inclusive. */
export function useRegistros(id: string | undefined, de: string | null, ate: string | null) {
  return useQuery({
    queryKey: [...CHAVE_HABITOS, "registros", id, de, ate],
    queryFn: () => api.get<HabitEntryItem[]>(`/habits/${id}/entries?from=${de}&to=${ate}`),
    enabled: Boolean(id && de && ate),
  });
}

/* ---------------------------------------------------------------- escrita */

/// `origin` fica de fora: a marca de IA é do MCP, nunca da tela (RN-12).
export type NovoRegistro = Omit<HabitEntryInput, "origin">;

/** RF-09 e RF-25: registrar fora do plano. */
export function useRegistrarAvulso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ habitId, ...corpo }: NovoRegistro & { habitId: string }) =>
      api.post<HabitEntryItem>(`/habits/${habitId}/entries`, corpo),
    onSettled: () => void qc.invalidateQueries({ queryKey: CHAVE_HABITOS }),
  });
}

const CHAVE_CHECK_IN = ["checkIn"] as const;

/// Marca `checkedIn` na ocorrência em todo cache de agenda.
function marcarNaAgenda(qc: QueryClient, id: string, dia: string, marcado: boolean): void {
  const mudar = (e: EventItem) =>
    e.id === id && e.occurrenceDate === dia ? { ...e, checkedIn: marcado } : e;
  qc.setQueriesData<AgendaRange>({ queryKey: CHAVE_AGENDA }, (agenda) =>
    agenda ? { ...agenda, events: agenda.events.map(mudar) } : agenda,
  );
}

/**
 * RF-08 e RF-29: o check-in na ocorrência `dia`, e desfazê-lo. A caixa marca
 * na hora em todo recorte da agenda e volta se a API recusar — o mesmo
 * otimismo de `useConcluirTarefa`, com a mesma espera da última mutação antes
 * de invalidar.
 */
export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: CHAVE_CHECK_IN,
    mutationFn: async ({ id, dia, fazer }: { id: string; dia: string; fazer: boolean }) => {
      if (fazer) await api.post<HabitEntryItem>(`/events/${id}/check-in`, { day: dia });
      else await api.delete<void>(`/events/${id}/check-in?day=${dia}`);
    },
    onMutate: async ({ id, dia, fazer }) => {
      await qc.cancelQueries({ queryKey: CHAVE_AGENDA });
      marcarNaAgenda(qc, id, dia, fazer);
    },
    onError: (_erro, { id, dia, fazer }) => marcarNaAgenda(qc, id, dia, !fazer),
    onSettled: () => {
      if (qc.isMutating({ mutationKey: CHAVE_CHECK_IN }) <= 1) invalidarAgenda(qc);
    },
  });
}

/* ------------------------------------------------------------------ contas */

/** O que o dia `dia` já tem no hábito, pela semana corrente dele. */
export function pontosDoDia(habito: HabitItem, dia: string): number {
  return habito.week.days.find((d) => d.day === dia)?.points ?? 0;
}

/** RF-27: o que o toast diz depois de `pontos` entrarem hoje. */
export interface Ganho {
  pontos: number;
  conta: number;
  extra: number;
  /** A semana depois do ganho. */
  progresso: number;
  meta: number;
  /** O próximo passo, em uma frase. */
  frase: string;
}

/**
 * A semana de `habito` depois de `pontos` entrarem em `hoje`, calculada antes
 * de a API responder — pela mesma conta dela (`quantoConta`). O toast mostra
 * isto; a releitura que vem depois corrige qualquer diferença.
 */
export function ganhoNaSemana(habito: HabitItem, pontos: number, hoje: string): Ganho {
  const { cap, progress } = habito.week;
  const { conta, extra } = quantoConta(pontos, cap, pontosDoDia(habito, hoje));
  const progresso = progress + conta;
  const meta = habito.weeklyGoal;
  const falta = meta - progresso;
  const frase =
    progress >= meta
      ? `Meta já batida — +${pontos} de XP`
      : falta <= 0
        ? "Meta da semana batida"
        : extra > 0
          ? `${extra} ${extra === 1 ? "virou" : "viraram"} XP extra · faltam ${falta} pts`
          : `Faltam ${falta} pts para a meta`;
  return { pontos, conta, extra, progresso, meta, frase };
}

/**
 * RF-21: a frase do que falta na semana. Conta com o que ainda cabe em cada
 * dia de hoje até domingo — hoje, o teto menos o que já entrou; os seguintes,
 * o teto inteiro.
 */
export function oQueFalta(habito: HabitItem, hoje: string): string {
  const { cap, progress, days } = habito.week;
  const falta = habito.weeklyGoal - progress;
  if (falta <= 0) return "Meta da semana batida";
  const restantes = days.filter((d) => d.day >= hoje);
  const hojeCabe = Math.max(0, cap - (restantes[0]?.day === hoje ? restantes[0].counted : 0));
  const cabe = restantes.reduce((soma, d) => soma + (d.day === hoje ? hojeCabe : cap), 0);
  if (cabe < falta) return `Faltam ${falta} pts — não fecha mais nesta semana`;
  const dias = falta <= hojeCabe ? 1 : (hojeCabe > 0 ? 1 : 0) + Math.ceil((falta - hojeCabe) / cap);
  return `Faltam ${falta} pts — em pelo menos ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
