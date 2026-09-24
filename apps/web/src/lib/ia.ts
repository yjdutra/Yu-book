import type {
  AiFavorite,
  AiHealth,
  AiModelList,
  AiModelSort,
  AiSettings,
  AiSettingsPatch,
  FormatNoteResult,
  TarefaComModelo,
} from "@yu-book/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

/**
 * A frente de IA no front.
 *
 * Nenhuma chave de provedor passa por aqui: toda chamada de modelo sai do
 * servidor (RNF-02). O que o navegador conhece, o bundle publica.
 */

const AJUSTES = ["ia", "ajustes"] as const;
const TAREFA = ["ia", "tarefa"] as const;

export function useAiSaude() {
  return useQuery({
    queryKey: ["ia", "saude"],
    queryFn: () => api.get<AiHealth>("/ai/health"),
    staleTime: 60_000,
  });
}

/** Os três blocos da tela vêm juntos, numa requisição só. */
export function useAiAjustes() {
  return useQuery({
    queryKey: AJUSTES,
    queryFn: () => api.get<AiSettings>("/ai/settings"),
    staleTime: 30_000,
  });
}

/** O que a tela pergunta ao catálogo. `maxPrice` em µUSD por milhão; `null` = sem teto. */
export interface FiltrosDeModelo {
  q: string;
  tools: boolean;
  reasoning: boolean;
  maxPrice: number | null;
  sort: AiModelSort;
}

export function useAiModelos(filtros: FiltrosDeModelo) {
  const busca = new URLSearchParams({ limit: "20", sort: filtros.sort });
  if (filtros.q) busca.set("q", filtros.q);
  if (filtros.tools) busca.set("tools", "true");
  if (filtros.reasoning) busca.set("reasoning", "true");
  // `0` é o filtro de gratuitos, então a checagem é contra `null`, não falsy.
  if (filtros.maxPrice !== null) busca.set("maxPrice", String(filtros.maxPrice));

  return useQuery({
    queryKey: ["ia", "modelos", filtros],
    queryFn: () => api.get<AiModelList>(`/ai/models?${busca.toString()}`),
    // O catálogo muda em dias; o servidor ainda tem cache próprio de uma hora.
    staleTime: 300_000,
  });
}

export function useAtualizarAjustes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsPatch) => api.patch<AiSettings>("/ai/settings", patch),
    // O servidor devolve o objeto inteiro: costura em vez de invalidar.
    onSuccess: (ajustes) => qc.setQueryData(AJUSTES, ajustes),
  });
}

export function useFavoritar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => api.post<AiFavorite>("/ai/favorites", { modelId }),
    // A resposta é só o favorito, não a tela inteira — aqui invalidar é honesto.
    onSuccess: () => qc.invalidateQueries({ queryKey: AJUSTES }),
  });
}

export function useDesfavoritar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (favoriteId: string) => api.delete<void>(`/ai/favorites/${favoriteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: AJUSTES }),
  });
}

/**
 * Otimista (redesenho de UI, Etapa 4): no quadro de modelos o card vai para a
 * coluna na hora em que é solto. Esperar a rede faria o card voltar para a
 * origem e só então pular para o destino. Se o servidor recusar, o cache
 * volta ao que era, e quem chamou mostra o erro.
 */
export function useDefinirModeloDaTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TAREFA,
    mutationFn: ({ task, modelId }: { task: TarefaComModelo; modelId: string | null }) =>
      api.patch<AiSettings["taskModels"]>(`/ai/tasks/${task}`, { modelId }),
    onMutate: async ({ task, modelId }) => {
      await qc.cancelQueries({ queryKey: AJUSTES });
      const antes = qc.getQueryData<AiSettings>(AJUSTES);
      if (antes) {
        const taskModels = { ...antes.taskModels };
        if (modelId) taskModels[task] = modelId;
        else delete taskModels[task];
        qc.setQueryData<AiSettings>(AJUSTES, { ...antes, taskModels });
      }
      return { antes };
    },
    onError: (_erro, _vars, contexto) => {
      if (contexto?.antes) qc.setQueryData(AJUSTES, contexto.antes);
    },
    onSuccess: (taskModels) => {
      const atual = qc.getQueryData<AiSettings>(AJUSTES);
      if (atual) qc.setQueryData(AJUSTES, { ...atual, taskModels });
    },
    /// Dois arrastes seguidos, antes de a rede responder: as respostas podem
    /// chegar fora de ordem, e o rollback de uma pode restaurar a mudança
    /// otimista da outra. Quando a última termina, o servidor decide.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: TAREFA }) <= 1) {
        void qc.invalidateQueries({ queryKey: AJUSTES });
      }
    },
  });
}

/**
 * Formatar devolve o texto; **não grava**. Quem grava é o autosave que já
 * existe — é o que faz a formatação custar uma requisição em vez das seis que
 * uma escrita pelo servidor invalidaria (INV-23).
 */
export function useFormatarNota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contentMd }: { id: string; contentMd: string }) =>
      api.post<FormatNoteResult>(`/ai/notes/${id}/format`, { contentMd }),
    // Não toca no cache de notas — quem grava a nota é o autosave (INV-23). Mas
    // acabou de gastar dinheiro, e o gasto do dia tem `staleTime` de 30 s: sem
    // isto a tela de ajustes mostraria um número velho logo depois da ação que
    // o mudou.
    onSuccess: () => qc.invalidateQueries({ queryKey: AJUSTES }),
  });
}
