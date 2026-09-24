import type { AgentSummary, ConversationAgent } from "@yu-book/shared";
import { useAgentes } from "../../lib/agentes";
import { useConversa } from "../../lib/chat";
import { useSessaoChat } from "../../lib/sessaoChat";

export interface AgenteDaConversa {
  /** Quem responde: nome e cor. `null` é o Assistente de sempre. */
  identidade: ConversationAgent | null;
  /** O resumo atual do agente — modelo, premissas. `null` sem agente ou excluído. */
  resumo: AgentSummary | null;
  /** A conversa já existe: o agente é o dela, e não se troca (Etapa D). */
  fixo: boolean;
  /** O agente saiu depois da conversa: ela fica legível e não aceita mensagem. */
  excluido: boolean;
}

/**
 * O agente da conversa na tela, venha de onde vier.
 *
 * Conversa criada: o agente é o que o servidor gravou nela
 * (`Conversation.agent`). Conversa ainda vazia: é o escolhido na sessão
 * (`agenteId`), resolvido pela lista. Enquanto a conversa recém-criada carrega,
 * a sessão ainda guarda a escolha, e é ela que responde — sem isso a primeira
 * fala sairia com o avatar do Assistente e trocaria no meio.
 */
export function useAgenteDaConversa(): AgenteDaConversa {
  const { conversaId, agenteId } = useSessaoChat();
  const { data: conversa } = useConversa(conversaId);
  const { data: agentes } = useAgentes();

  const escolhido = agenteId ? (agentes?.find((a) => a.id === agenteId) ?? null) : null;

  if (conversaId && conversa) {
    const identidade = conversa.agent;
    const resumo = identidade?.id
      ? (agentes?.find((a) => a.id === identidade.id) ?? null)
      : null;
    return {
      identidade,
      resumo,
      fixo: true,
      excluido: Boolean(identidade && identidade.id === null),
    };
  }

  const identidade = escolhido
    ? { id: escolhido.id, name: escolhido.name, color: escolhido.color }
    : null;
  return { identidade, resumo: escolhido, fixo: Boolean(conversaId), excluido: false };
}
