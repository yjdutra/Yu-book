import type { Prisma } from "@prisma/client";
import type { AiMark } from "@yu-book/shared";

/**
 * A marca de conteúdo gerado por IA (Etapa C da frente de IA), do lado do
 * banco. Mora aqui e não num service porque nota e card a gravam e a leem
 * igual: pô-la em `kanban.service` faria `notes.service` depender do kanban
 * para ler a própria marca, e o contrário criaria uma dependência que hoje não
 * existe.
 */

/**
 * De onde veio um conteúdo gerado por IA.
 *
 * Chega ao service **por parâmetro**, nunca pelo corpo da nota: o chat o monta
 * a partir da própria conversa, e a rota do MCP o traduz de `origin`, que só
 * aceita `mcp`. É isso que faz a marca ser gravada só pelo servidor.
 */
export interface OrigemIA {
  via: "chat" | "mcp";
  author: string | null;
  conversationId?: string | null;
  /// O agente da conversa (Etapa D). Só o chat o conhece; o MCP não tem agente.
  agentName?: string | null;
}

/** Os campos `ai*` de uma criação, iguais em nota e card. */
export function camposDaOrigem(origem: OrigemIA | undefined) {
  if (!origem) return {};
  return {
    aiGeneratedAt: new Date(),
    aiVia: origem.via,
    aiAuthor: origem.author,
    aiConversationId: origem.conversationId ?? null,
    aiAgentName: origem.agentName ?? null,
  };
}

/** O mesmo recorte de colunas em `note` e em `card`. */
export const CAMPOS_DA_MARCA = {
  aiGeneratedAt: true,
  aiVia: true,
  aiAuthor: true,
  aiConversationId: true,
  aiAgentName: true,
  aiRevisedAt: true,
} satisfies Prisma.NoteSelect & Prisma.CardSelect;

interface LinhaDaMarca {
  aiGeneratedAt: Date | null;
  aiVia: "chat" | "mcp" | null;
  aiAuthor: string | null;
  aiConversationId: string | null;
  aiAgentName: string | null;
  aiRevisedAt: Date | null;
}

export function paraMarca(linha: LinhaDaMarca): AiMark | null {
  // `aiGeneratedAt` é a marca; `aiVia` nasce junto com ele e nunca sozinho.
  if (!linha.aiGeneratedAt || !linha.aiVia) return null;
  return {
    generatedAt: linha.aiGeneratedAt.toISOString(),
    via: linha.aiVia,
    author: linha.aiAuthor,
    conversationId: linha.aiConversationId,
    agentName: linha.aiAgentName,
    revisedAt: linha.aiRevisedAt?.toISOString() ?? null,
  };
}
