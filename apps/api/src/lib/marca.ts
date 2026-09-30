import type { Prisma } from "@prisma/client";
import type { AiCompletion, AiMark, AiVia } from "@yu-book/shared";

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
 * aceita `mcp`. É isso que faz a marca ser gravada só pelo servidor. A rotina
 * (Etapa E) a monta no motor, a partir da execução — o modelo não a declara.
 *
 * **União discriminada por `via`, e não um objeto de opcionais** (INV-58): é o
 * compilador que obriga o chat a gravar a conversa e a rotina a gravar a
 * execução. Com tudo opcional, uma origem `via: "chat"` sem `conversationId`
 * compilava e gravava uma marca de chat que não aponta para conversa nenhuma.
 */
export type OrigemIA =
  | {
      via: "chat";
      /// O modelo que respondeu.
      author: string | null;
      conversationId: string;
      /// O agente da conversa (Etapa D); ausente no Assistente sem agente.
      agentName?: string | null;
    }
  | {
      via: "rotina";
      /// O modelo do último passo que reescreveu.
      author: string | null;
      agentName: string | null;
      runId: string;
      routineName: string;
    }
  | {
      /// O MCP não tem conversa, agente nem execução: `author` é o cliente.
      via: "mcp";
      author: string | null;
    };

/** A origem que o próprio assistente monta — nunca o MCP (Etapa E). */
export type OrigemDoAssistente = Extract<OrigemIA, { via: "chat" | "rotina" }>;

/** Os campos `ai*` de uma criação, iguais em nota e card. */
export function camposDaOrigem(origem: OrigemIA | undefined) {
  if (!origem) return {};
  return {
    aiGeneratedAt: new Date(),
    aiVia: origem.via,
    aiAuthor: origem.author,
    aiConversationId: origem.via === "chat" ? origem.conversationId : null,
    aiAgentName: origem.via === "mcp" ? null : (origem.agentName ?? null),
    aiRunId: origem.via === "rotina" ? origem.runId : null,
    aiRoutineName: origem.via === "rotina" ? origem.routineName : null,
  };
}

/** O mesmo recorte de colunas em `note` e em `card`. */
export const CAMPOS_DA_MARCA = {
  aiGeneratedAt: true,
  aiVia: true,
  aiAuthor: true,
  aiConversationId: true,
  aiAgentName: true,
  aiRunId: true,
  aiRoutineName: true,
  aiRevisedAt: true,
} satisfies Prisma.NoteSelect & Prisma.CardSelect;

interface LinhaDaMarca {
  aiGeneratedAt: Date | null;
  aiVia: AiVia | null;
  aiAuthor: string | null;
  aiConversationId: string | null;
  aiAgentName: string | null;
  aiRunId: string | null;
  aiRoutineName: string | null;
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
    routineName: linha.aiRoutineName,
    runId: linha.aiRunId,
    revisedAt: linha.aiRevisedAt?.toISOString() ?? null,
  };
}

/**
 * A conclusão do card e a marca de quem concluiu (frente de cards, Parte 1).
 *
 * Só se chama quando o estado **muda** — concluir um card já concluído não
 * passa por aqui, e a data e a marca originais ficam. Sem `origem`, a
 * conclusão é humana e a marca vai a `null`: ela diz quem pôs o card no estado
 * atual, e não é histórico. Reabrir zera tudo.
 *
 * Nada aqui toca em `aiRevisedAt`: concluir não é revisão do texto.
 */
export function camposDaConclusao(completed: boolean, origem?: OrigemIA) {
  return {
    completedAt: completed ? new Date() : null,
    aiCompletedVia: completed && origem ? origem.via : null,
    aiCompletedAuthor: completed && origem ? origem.author : null,
    aiCompletedAgentName:
      completed && origem && origem.via !== "mcp" ? (origem.agentName ?? null) : null,
  };
}

export const CAMPOS_DA_CONCLUSAO = {
  completedAt: true,
  aiCompletedVia: true,
  aiCompletedAuthor: true,
  aiCompletedAgentName: true,
} satisfies Prisma.CardSelect;

interface LinhaDaConclusao {
  aiCompletedVia: AiVia | null;
  aiCompletedAuthor: string | null;
  aiCompletedAgentName: string | null;
}

export function paraConclusao(linha: LinhaDaConclusao): AiCompletion | null {
  if (!linha.aiCompletedVia) return null;
  return {
    via: linha.aiCompletedVia,
    author: linha.aiCompletedAuthor,
    agentName: linha.aiCompletedAgentName,
  };
}
