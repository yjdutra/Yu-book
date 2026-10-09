import { useQuery } from "@tanstack/react-query";
import { api } from "@yu-book/cliente/api";
import { CHAVE_AGENTES, CHAVE_AJUSTES, CHAVE_SAUDE_IA } from "@yu-book/cliente/ia";
import { motivoSemChat } from "@yu-book/cliente/motivoSemChat";
import type { AgentSummary, AiHealth, AiSettings } from "@yu-book/shared";

/**
 * O que o chat do móvel precisa saber da IA antes de enviar (Fase 5 da frente
 * de agenda). Só leitura: modelo, teto e chave se configuram no Yu-book do
 * computador, em `/ajustes`. As chaves de cache são as do web, numa definição
 * só (`@yu-book/cliente/ia`), para quem invalida lá dizer o mesmo aqui.
 */

export function useAiSaude() {
  return useQuery({
    queryKey: CHAVE_SAUDE_IA,
    queryFn: () => api.get<AiHealth>("/ai/health"),
    staleTime: 60_000,
  });
}

export function useAiAjustes() {
  return useQuery({
    queryKey: CHAVE_AJUSTES,
    queryFn: () => api.get<AiSettings>("/ai/settings"),
    staleTime: 30_000,
  });
}

export function useAgentes() {
  return useQuery({
    queryKey: CHAVE_AGENTES,
    queryFn: () => api.get<AgentSummary[]>("/ai/agents"),
  });
}

/** Onde a configuração mora — o móvel não tem a tela, e diz onde ela está. */
export const NO_COMPUTADOR = "Isso se ajusta no Yu-book do computador, em Ajustes.";

/**
 * O campo bloqueado e o porquê (`motivoSemChat`, a mesma regra do web). O
 * móvel não distingue os motivos: todos se resolvem no computador
 * (`NO_COMPUTADOR`).
 */
export function useMotivoSemChat(agente: AgentSummary | null): string | null {
  const { data: saude } = useAiSaude();
  const { data: ajustes } = useAiAjustes();
  return motivoSemChat(saude, ajustes, agente)?.texto ?? null;
}
