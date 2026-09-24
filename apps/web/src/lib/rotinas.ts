import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type {
  RoutineDetail,
  RoutineInput,
  RoutineRunDetail,
  RoutineRunPage,
  RoutineRunStarted,
  RoutineSummary,
  RoutineUpdateInput,
  RotinaEvent,
} from "@yu-book/shared";
import { api, apiStream } from "./api";
import { CHAVE_AJUSTES, lerEventos } from "./chat";

/**
 * Rotinas (Etapa E da frente de IA).
 *
 * Só `import type` de `@yu-book/shared`, pela mesma razão de `agentes.ts`: o
 * painel contextual lê a lista daqui para o ponto de "em andamento", e ele está
 * no bundle inicial. `MODELO_DE_ROTINA` e os schemas ficam no chunk da área.
 */

export const CHAVE_ROTINAS = ["ia", "rotinas"] as const;
export const chaveDaRotina = (id: string) => ["ia", "rotina", id] as const;
export const chaveDoHistorico = (id: string) => ["ia", "rotina-historico", id] as const;
export const chaveDaExecucao = (runId: string) => ["ia", "execucao", runId] as const;

/** Alguma rotina com a última execução ainda rodando. */
export function execucaoEmAndamento(lista: RoutineSummary[] | undefined): RoutineSummary | null {
  return lista?.find((r) => r.lastRun?.status === "em_andamento") ?? null;
}

/**
 * A lista, com a última execução de cada uma. Enquanto alguma roda, ela se
 * refaz de 5 em 5 s: é o que acende e apaga o ponto de "em andamento" no
 * painel contextual sem a tela da execução estar aberta — a execução segue no
 * servidor com a aba fechada. Parada, não custa rede nenhuma.
 */
export function useRotinas() {
  return useQuery({
    queryKey: CHAVE_ROTINAS,
    queryFn: () => api.get<RoutineSummary[]>("/ai/routines"),
    staleTime: 30_000,
    refetchInterval: (q) => (execucaoEmAndamento(q.state.data) ? 5_000 : false),
  });
}

export function useRotina(id: string | null) {
  return useQuery({
    queryKey: chaveDaRotina(id ?? ""),
    queryFn: () => api.get<RoutineDetail>(`/ai/routines/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Criar e editar devolvem o detalhe inteiro: vai para o cache do detalhe, e a
 * lista — que traz a última execução, que o detalhe não tem — é refeita.
 */
function useCosturar() {
  const qc = useQueryClient();
  return (rotina: RoutineDetail) => {
    qc.setQueryData(chaveDaRotina(rotina.id), rotina);
    void qc.invalidateQueries({ queryKey: CHAVE_ROTINAS });
  };
}

export function useCriarRotina() {
  const costurar = useCosturar();
  return useMutation({
    mutationFn: (input: RoutineInput) => api.post<RoutineDetail>("/ai/routines", input),
    onSuccess: costurar,
  });
}

export function useAtualizarRotina() {
  const costurar = useCosturar();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: RoutineUpdateInput }) =>
      api.patch<RoutineDetail>(`/ai/routines/${id}`, patch),
    onSuccess: costurar,
  });
}

export function useExcluirRotina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ai/routines/${id}`),
    onSuccess: (_vazio, id) => {
      qc.setQueryData<RoutineSummary[]>(CHAVE_ROTINAS, (lista) =>
        lista?.filter((r) => r.id !== id),
      );
      qc.removeQueries({ queryKey: chaveDaRotina(id) });
      qc.removeQueries({ queryKey: chaveDoHistorico(id) });
    },
  });
}

/**
 * "Rodar agora". Responde 202 com o id da execução, e ela segue no servidor —
 * quem chamou navega para a tela que acompanha. A lista passa a ter uma
 * execução em andamento, e o detalhe, uma ideia a menos na fila.
 */
export function useRodarRotina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<RoutineRunStarted>(`/ai/routines/${id}/runs`),
    onSuccess: (_iniciada, id) => {
      void qc.invalidateQueries({ queryKey: CHAVE_ROTINAS });
      void qc.invalidateQueries({ queryKey: chaveDaRotina(id) });
      void qc.invalidateQueries({ queryKey: chaveDoHistorico(id) });
    },
  });
}

export function useHistorico(id: string | null) {
  return useInfiniteQuery({
    queryKey: chaveDoHistorico(id ?? ""),
    queryFn: ({ pageParam }) =>
      api.get<RoutineRunPage>(
        `/ai/routines/${id}/runs?limit=10${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (pagina) => pagina.nextCursor,
    enabled: Boolean(id),
  });
}

export function useExecucao(runId: string | null) {
  return useQuery({
    queryKey: chaveDaExecucao(runId ?? ""),
    queryFn: () => api.get<RoutineRunDetail>(`/ai/runs/${runId}`),
    enabled: Boolean(runId),
  });
}

/** Cancelar é idempotente no servidor; o status final chega pelo fluxo. */
export function useCancelarExecucao() {
  return useMutation({
    mutationFn: (runId: string) => api.post<void>(`/ai/runs/${runId}/cancel`),
  });
}

/**
 * A execução terminou: o que ela tocou no acervo ficou velho. O card de saída
 * nasceu num quadro, a ideia pode ter mudado de coluna ou ido para o arquivo,
 * e o gasto do dia andou. O evento não diz em qual quadro — e é raro o
 * bastante para invalidar todos.
 */
export function invalidarDepoisDaExecucao(qc: QueryClient, routineId: string | null): void {
  void qc.invalidateQueries({ queryKey: ["board"] });
  void qc.invalidateQueries({ queryKey: ["boards"] });
  void qc.invalidateQueries({ queryKey: ["arquivados"] });
  void qc.invalidateQueries({ queryKey: ["search"], refetchType: "none" });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
  void qc.invalidateQueries({ queryKey: CHAVE_AJUSTES });
  void qc.invalidateQueries({ queryKey: CHAVE_ROTINAS });
  if (routineId) {
    void qc.invalidateQueries({ queryKey: chaveDaRotina(routineId) });
    void qc.invalidateQueries({ queryKey: chaveDoHistorico(routineId) });
  }
}

/**
 * Assina o fluxo de uma execução. O primeiro evento é sempre o retrato — o que
 * está gravado mais o texto parcial do passo em curso —, e é isso que deixa a
 * tela fechar e voltar no meio: assinar de novo é recomeçar pelo retrato.
 *
 * Fechar a tela **não** para a execução; só solta esta conexão (`signal`).
 */
export async function acompanharExecucao(
  runId: string,
  aoEvento: (evento: RotinaEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const resposta = await apiStream(`/ai/runs/${runId}/events`, { signal });
  await lerEventos<RotinaEvent>(resposta, aoEvento);
}
