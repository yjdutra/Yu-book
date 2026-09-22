import type {
  AiFavorite,
  AiHealth,
  AiModelList,
  AiSettings,
  AiSettingsPatch,
  AiTask,
  FormatNoteResult,
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

export function useAiModelos(termo: string, soComFerramentas: boolean) {
  const busca = new URLSearchParams({ limit: "20" });
  if (termo) busca.set("q", termo);
  if (soComFerramentas) busca.set("tools", "true");

  return useQuery({
    queryKey: ["ia", "modelos", termo, soComFerramentas],
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

export function useDefinirModeloDaTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, modelId }: { task: AiTask; modelId: string | null }) =>
      api.patch<AiSettings["taskModels"]>(`/ai/tasks/${task}`, { modelId }),
    onSuccess: (taskModels) => {
      const atual = qc.getQueryData<AiSettings>(AJUSTES);
      if (atual) qc.setQueryData(AJUSTES, { ...atual, taskModels });
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
