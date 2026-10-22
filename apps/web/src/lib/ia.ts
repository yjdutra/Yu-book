import type {
  AiFavorite,
  AiHealth,
  AiModelList,
  AiModelSort,
  AiProvider,
  AiSettings,
  AiSettingsPatch,
  AiUsageReport,
  ClaudeUsageReport,
  FormatNoteResult,
  OpenRouterAccount,
  OpenRouterKeyReport,
  OpenRouterMetrics,
  PeriodoDeUso,
  TarefaComModelo,
} from "@yu-book/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@yu-book/cliente/api";
import { CHAVE_AJUSTES, CHAVE_SAUDE_IA } from "@yu-book/cliente/ia";
import { CHAVE_USO } from "./chat";

/**
 * A frente de IA no front.
 *
 * Nenhuma chave de provedor passa por aqui: toda chamada de modelo sai do
 * servidor (RNF-02). O que o navegador conhece, o bundle publica.
 */

const TAREFA = ["ia", "tarefa"] as const;

/**
 * A saúde de um provedor. Cada um tem chave própria, e a chave de cache leva o
 * provedor debaixo de `CHAVE_SAUDE_IA` — quem invalida o prefixo alcança os dois.
 */
export function useAiSaude(provider: AiProvider) {
  return useQuery({
    queryKey: [...CHAVE_SAUDE_IA, provider],
    queryFn: () => api.get<AiHealth>(`/ai/health?provider=${provider}`),
    staleTime: 60_000,
  });
}

/** As duas saúdes, para quem decide pelo provedor do modelo (`motivoSemChat`). */
export function useAiSaudes(): (provider: AiProvider) => AiHealth | undefined {
  const anthropic = useAiSaude("anthropic").data;
  const openrouter = useAiSaude("openrouter").data;
  return (provider) => (provider === "anthropic" ? anthropic : openrouter);
}

/** Os três blocos da tela vêm juntos, numa requisição só. */
export function useAiAjustes() {
  return useQuery({
    queryKey: CHAVE_AJUSTES,
    queryFn: () => api.get<AiSettings>("/ai/settings"),
    staleTime: 30_000,
  });
}

/**
 * O painel do OpenRouter (`/ajustes/openrouter`). Três consultas, e não uma,
 * para cada bloco carregar e falhar sozinho: sem a management key, o bloco da
 * chave continua de pé. O botão Atualizar invalida as três por este prefixo.
 *
 * `retry: false` de propósito: o erro aqui é resposta do provedor, e aparece na
 * hora. Tentar de novo só gastaria o rate limit das rotas (10 por minuto).
 */
export const CHAVE_OPENROUTER = ["ia", "openrouter"] as const;

export function useOpenRouterChave() {
  return useQuery({
    queryKey: [...CHAVE_OPENROUTER, "chave"],
    queryFn: () => api.get<OpenRouterKeyReport>("/ai/openrouter/key"),
    staleTime: 60_000,
    retry: false,
  });
}

/// `habilitada` vem do `managementConfigured` da resposta da chave: sem a
/// management key, a consulta nem sai — a resposta já se sabe qual é.
export function useOpenRouterConta(habilitada: boolean) {
  return useQuery({
    queryKey: [...CHAVE_OPENROUTER, "conta"],
    queryFn: () => api.get<OpenRouterAccount>("/ai/openrouter/account"),
    enabled: habilitada,
    staleTime: 60_000,
    retry: false,
  });
}

export function useOpenRouterMetricas(habilitada: boolean) {
  return useQuery({
    queryKey: [...CHAVE_OPENROUTER, "metricas"],
    queryFn: () => api.get<OpenRouterMetrics>("/ai/openrouter/metrics"),
    enabled: habilitada,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * O AI usage dash (`/ajustes/uso`): o que o Yu-book gravou em `ai_usage` no
 * período. Só lê o banco — nada vai ao provedor, e por isso aqui não há o
 * `retry: false` do painel do OpenRouter.
 *
 * `keepPreviousData` segura o período anterior na tela enquanto o novo chega:
 * trocar de 30 para 90 dias não pisca o esqueleto. A chave é a mesma que o
 * chat, a rotina e o formatar invalidam — gasto novo aparece sem esperar os
 * 30 s.
 */
export function useUsoIa(dias: PeriodoDeUso) {
  return useQuery({
    queryKey: [...CHAVE_USO, dias],
    queryFn: () => api.get<AiUsageReport>(`/ai/usage?days=${dias}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * A tela de custo do Claude (`/ajustes/claude`). Debaixo de `CHAVE_USO`: uma
 * mensagem do chat invalida o prefixo, e esta tela acompanha como a do dash.
 */
export function useUsoClaude(dias: PeriodoDeUso) {
  return useQuery({
    queryKey: [...CHAVE_USO, "claude", dias],
    queryFn: () => api.get<ClaudeUsageReport>(`/ai/claude/usage?days=${dias}`),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** O que a tela pergunta ao catálogo. `maxPrice` em µUSD por milhão; `null` = sem teto. */
export interface FiltrosDeModelo {
  provider: AiProvider;
  q: string;
  tools: boolean;
  reasoning: boolean;
  maxPrice: number | null;
  sort: AiModelSort;
}

export function useAiModelos(filtros: FiltrosDeModelo) {
  const busca = new URLSearchParams({
    provider: filtros.provider,
    limit: "20",
    sort: filtros.sort,
  });
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
    // O servidor devolve o objeto inteiro: costura em vez de invalidar. O AI
    // usage dash, não: trocar o fuso muda o `to` e o nome do fuso que ele
    // mostra, e só o servidor recalcula o período.
    onSuccess: (ajustes) => {
      qc.setQueryData(CHAVE_AJUSTES, ajustes);
      void qc.invalidateQueries({ queryKey: CHAVE_USO });
    },
  });
}

export function useFavoritar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelo: { modelId: string; provider: AiProvider }) =>
      api.post<AiFavorite>("/ai/favorites", modelo),
    // A resposta é só o favorito, não a tela inteira — aqui invalidar é honesto.
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_AJUSTES }),
  });
}

export function useDesfavoritar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (favoriteId: string) => api.delete<void>(`/ai/favorites/${favoriteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_AJUSTES }),
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
      await qc.cancelQueries({ queryKey: CHAVE_AJUSTES });
      const antes = qc.getQueryData<AiSettings>(CHAVE_AJUSTES);
      if (antes) {
        const taskModels = { ...antes.taskModels };
        if (modelId) taskModels[task] = modelId;
        else delete taskModels[task];
        qc.setQueryData<AiSettings>(CHAVE_AJUSTES, { ...antes, taskModels });
      }
      return { antes };
    },
    onError: (_erro, _vars, contexto) => {
      if (contexto?.antes) qc.setQueryData(CHAVE_AJUSTES, contexto.antes);
    },
    onSuccess: (taskModels) => {
      const atual = qc.getQueryData<AiSettings>(CHAVE_AJUSTES);
      if (atual) qc.setQueryData(CHAVE_AJUSTES, { ...atual, taskModels });
    },
    /// Dois arrastes seguidos, antes de a rede responder: as respostas podem
    /// chegar fora de ordem, e o rollback de uma pode restaurar a mudança
    /// otimista da outra. Quando a última termina, o servidor decide.
    onSettled: () => {
      if (qc.isMutating({ mutationKey: TAREFA }) <= 1) {
        void qc.invalidateQueries({ queryKey: CHAVE_AJUSTES });
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
    // pode ter gastado dinheiro, e o gasto do dia tem `staleTime` de 30 s: sem
    // isto a tela de ajustes mostraria um número velho logo depois da ação que
    // o mudou. `onSettled`, e não `onSuccess`, nos dois: a falha também custa —
    // `RESPOSTA_INVALIDA` é gravada depois de o provedor responder
    // (`formatar.service.ts`), e toda chamada que falhou vira linha em
    // `ai_usage`. `void`: quem espera o `mutateAsync` não precisa esperar
    // estes refetches.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_AJUSTES });
      void qc.invalidateQueries({ queryKey: CHAVE_USO });
    },
  });
}
