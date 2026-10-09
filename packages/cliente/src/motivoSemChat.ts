import type { AgentSummary, AiHealth, AiSettings } from "@yu-book/shared";

/**
 * Por que o chat não pode enviar agora, ou `null` (RNF-03 da IA). Sem
 * provedor, ou sem modelo para o chat, o campo fica bloqueado e diz por quê.
 * Agente com modelo próprio (Etapa D) não passa pelo modelo do chat — exigir a
 * escolha da tarefa `chat` bloquearia uma conversa que o servidor aceita —,
 * mas o modelo dele pode ter saído dos favoritos (`modelo-do-agente`).
 *
 * O `tipo` existe porque cada tela leva a uma saída diferente: o web manda o
 * modelo do agente ao editor do agente, e os outros a Ajustes; o móvel diz que
 * tudo se ajusta no computador. O servidor continua sendo quem decide: o erro
 * do envio cobre o que esta leitura do cache não viu.
 */
export type MotivoSemChat = {
  tipo: "sem-provedor" | "modelo-do-agente" | "sem-modelo-do-chat";
  texto: string;
};

export function motivoSemChat(
  saude: AiHealth | undefined,
  ajustes: AiSettings | undefined,
  agente: AgentSummary | null,
): MotivoSemChat | null {
  if (saude && !saude.configured) {
    return { tipo: "sem-provedor", texto: "Nenhum provedor de IA configurado no servidor." };
  }
  if (agente?.modelMissing) {
    return {
      tipo: "modelo-do-agente",
      texto: `O modelo de «${agente.name}» saiu dos favoritos.`,
    };
  }
  if (agente?.modelId) return null;
  if (ajustes && !ajustes.taskModels.chat) {
    return { tipo: "sem-modelo-do-chat", texto: "Nenhum modelo escolhido para o chat." };
  }
  return null;
}
