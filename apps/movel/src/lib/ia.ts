import { useQuery } from "@tanstack/react-query";
import { api } from "@yu-book/cliente/api";
import type { AgentSummary, AiHealth, AiSettings } from "@yu-book/shared";

/**
 * O que o chat do móvel precisa saber da IA antes de enviar (Fase 5 da frente
 * de agenda). Só leitura: modelo, teto e chave se configuram no Yu-book do
 * computador, em `/ajustes`. As chaves de cache são as do web
 * (`apps/web/src/lib/ia.ts`, `lib/agentes.ts`), para quem invalida lá dizer o
 * mesmo aqui.
 */

export function useAiSaude() {
  return useQuery({
    queryKey: ["ia", "saude"],
    queryFn: () => api.get<AiHealth>("/ai/health"),
    staleTime: 60_000,
  });
}

export function useAiAjustes() {
  return useQuery({
    queryKey: ["ia", "ajustes"],
    queryFn: () => api.get<AiSettings>("/ai/settings"),
    staleTime: 30_000,
  });
}

export function useAgentes() {
  return useQuery({
    queryKey: ["ia", "agentes"],
    queryFn: () => api.get<AgentSummary[]>("/ai/agents"),
  });
}

/** Onde a configuração mora — o móvel não tem a tela, e diz onde ela está. */
export const NO_COMPUTADOR = "Isso se ajusta no Yu-book do computador, em Ajustes.";

/**
 * Sem provedor, ou sem modelo para o chat, o campo fica bloqueado e diz por
 * quê, como no web (RNF-03 da IA). Agente com modelo próprio não passa pelo
 * modelo do chat. O servidor continua sendo quem decide: o erro do envio
 * cobre o que esta leitura do cache não viu.
 */
export function useMotivoSemChat(agente: AgentSummary | null): string | null {
  const { data: saude } = useAiSaude();
  const { data: ajustes } = useAiAjustes();
  if (saude && !saude.configured) return "Nenhum provedor de IA configurado no servidor.";
  if (agente?.modelMissing) return `O modelo de «${agente.name}» saiu dos favoritos.`;
  if (agente?.modelId) return null;
  if (ajustes && !ajustes.taskModels.chat) return "Nenhum modelo escolhido para o chat.";
  return null;
}
