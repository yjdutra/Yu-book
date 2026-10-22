import type { AgentSummary, AiHealth, AiProvider, AiSettings } from "@yu-book/shared";

/**
 * Por que o chat não pode enviar agora, ou `null` (RNF-03 da IA). Sem
 * provedor, ou sem modelo para o chat, o campo fica bloqueado e diz por quê.
 * Agente com modelo próprio (Etapa D) não passa pelo modelo do chat — exigir a
 * escolha da tarefa `chat` bloquearia uma conversa que o servidor aceita —,
 * mas o modelo dele pode ter saído dos favoritos (`modelo-do-agente`).
 *
 * **O provedor segue o modelo** (docs/plano-provedor-anthropic.md): a chave
 * que importa é a do provedor do modelo que vai responder — o do agente ou o
 * do chat —, não a do OpenRouter sempre. Quem usa só a chave da Anthropic não
 * pode ver o chat bloqueado por falta da outra. Modelo que não está nos
 * favoritos (ainda carregando, ou já saiu) conta como OpenRouter, o padrão.
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

/// Com o artigo: "da Anthropic", "do OpenRouter".
const DO_PROVEDOR: Record<AiProvider, string> = {
  anthropic: "da Anthropic",
  openrouter: "do OpenRouter",
};

/** O provedor que vai responder: o do modelo do agente, ou o do modelo do chat. */
export function provedorDoChat(
  ajustes: AiSettings | undefined,
  agente: AgentSummary | null,
): AiProvider {
  const modelId = agente?.modelId ?? ajustes?.taskModels.chat;
  return ajustes?.favorites.find((f) => f.id === modelId)?.provider ?? "openrouter";
}

export function motivoSemChat(
  saudeDe: (provider: AiProvider) => AiHealth | undefined,
  ajustes: AiSettings | undefined,
  agente: AgentSummary | null,
): MotivoSemChat | null {
  const provider = provedorDoChat(ajustes, agente);
  const saude = saudeDe(provider);
  if (saude && !saude.configured) {
    return {
      tipo: "sem-provedor",
      texto: `Nenhuma chave ${DO_PROVEDOR[provider]} configurada no servidor.`,
    };
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
