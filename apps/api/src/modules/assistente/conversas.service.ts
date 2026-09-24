import {
  formatarCardDetalhe,
  formatarNota,
  formatarQuadro,
  MAX_CONTEUDO_IA,
} from "@yu-book/shared";
import type {
  ChatAttachment,
  ChatAttachmentInput,
  ChatCreated,
  ChatMessage,
  ChatSource,
  Conversation,
  ConversationDetail,
  MessageToNoteInput,
  NoteDetail,
} from "@yu-book/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import * as kanban from "../kanban/kanban.service.js";
import * as notes from "../notes/notes.service.js";

/**
 * Conversa, mensagem e anexo (RF-23, RF-24, RNF-06).
 *
 * Escopo por usuário como no resto do projeto: o `userId` vem só do token, e
 * conversa de outra conta responde **404, não 403** — dizer "existe, mas não é
 * sua" já é contar que existe (CA-16).
 *
 * Excluir conversa apaga mensagens e anexos por cascata e **não** toca em nota
 * nem em card: o anexo é um ponteiro, não uma posse.
 */

type MensagemNoBanco = Prisma.AiMessageGetPayload<{ include: { attachments: true } }>;

function toAnexo(a: MensagemNoBanco["attachments"][number]): ChatAttachment {
  return { id: a.id, noteId: a.noteId, cardId: a.cardId, boardId: a.boardId, title: a.title };
}

function toMensagem(m: MensagemNoBanco): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    modelId: m.modelId,
    modelUsed: m.modelUsed,
    toolName: m.toolName,
    sources: Array.isArray(m.sources) ? (m.sources as unknown as ChatSource[]) : [],
    created: Array.isArray(m.created) ? (m.created as unknown as ChatCreated[]) : [],
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments.map(toAnexo),
  };
}

interface ConversaNoBanco {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

function toConversa(c: ConversaNoBanco): Conversation {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listar(userId: string): Promise<Conversation[]> {
  const linhas = await prisma.aiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return linhas.map(toConversa);
}

export async function criar(userId: string, title: string): Promise<Conversation> {
  const linha = await prisma.aiConversation.create({ data: { userId, title } });
  return toConversa(linha);
}

/**
 * A conversa com o histórico inteiro.
 *
 * As mensagens de papel `tool` vêm junto: elas são o que o provedor precisa
 * receber de volta no turno seguinte. Quem decide não **mostrá-las** é a tela,
 * que tem o `toolName` para dizer o que foi consultado sem despejar o texto
 * formatado para o modelo.
 */
export async function buscarPorId(userId: string, id: string): Promise<ConversationDetail> {
  const linha = await prisma.aiConversation.findFirst({
    where: { id, userId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
    },
  });
  if (!linha) throw notFound("Conversa não encontrada");

  return { ...toConversa(linha), messages: linha.messages.map(toMensagem) };
}

/** Só a posse, sem arrastar o histórico. */
export async function garantirPosse(userId: string, id: string): Promise<void> {
  const linha = await prisma.aiConversation.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!linha) throw notFound("Conversa não encontrada");
}

/**
 * INV-04: o `userId` entra no `where` da **própria mutação**, por `updateMany`,
 * em vez de um `findFirst` antes de um `update` por id. Não é paranoia com uma
 * corrida improvável — é que a forma checar-depois-agir deixa a posse como
 * disciplina de quem escreve a próxima função, e a forma atômica a deixa no
 * tipo da consulta.
 */
export async function renomear(userId: string, id: string, title: string): Promise<Conversation> {
  const { count } = await prisma.aiConversation.updateMany({
    where: { id, userId },
    data: { title },
  });
  if (count === 0) throw notFound("Conversa não encontrada");

  /// Uma segunda consulta porque `updateMany` não devolve linha. É o mesmo
  /// número de idas ao banco que a forma antiga, sem o furo de forma.
  const linha = await prisma.aiConversation.findUniqueOrThrow({ where: { id } });
  return toConversa(linha);
}

/** RF-24: apaga a conversa. Nota e card não são tocados. */
export async function excluir(userId: string, id: string): Promise<void> {
  const { count } = await prisma.aiConversation.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Conversa não encontrada");
}

/**
 * "Virar nota": uma resposta do assistente vira nota marcada como gerada por
 * IA (Etapa C da frente de IA, Q-04 do PRD).
 *
 * **O cliente não afirma nada sobre o conteúdo.** Corpo, modelo e conversa
 * saem da `AiMessage` gravada; do corpo da requisição vêm só título, tipo e
 * workspace. Aceitar o texto do cliente deixaria qualquer um gravar nota com a
 * marca de um modelo que nunca a escreveu.
 *
 * A posse vem pela cadeia mensagem → conversa → usuário, **no mesmo `where`**
 * (INV-03 aplicado à conversa): mensagem de outra conta é 404, como conversa
 * de outra conta. Título repetido sobe como `TITULO_DUPLICADO` pelo service de
 * notas, sem tradução aqui.
 */
export async function virarNota(
  userId: string,
  conversationId: string,
  messageId: string,
  entrada: MessageToNoteInput,
): Promise<NoteDetail> {
  const mensagem = await prisma.aiMessage.findFirst({
    where: { id: messageId, conversationId, conversation: { userId } },
    select: { role: true, content: true, modelId: true, modelUsed: true },
  });
  if (!mensagem) throw notFound("Mensagem não encontrada");

  /// Só a fala do assistente tem autor-modelo. A do usuário já é dele, e
  /// marcá-la como gerada por IA seria mentir no dado; a de `tool` é texto
  /// formatado para o modelo, não para ser lido.
  if (mensagem.role !== "assistant") {
    throw new AppError(422, "VALIDATION_ERROR", "Só uma resposta do assistente vira nota");
  }
  if (!mensagem.content.trim()) {
    throw new AppError(422, "VALIDATION_ERROR", "Esta resposta não tem texto para virar nota");
  }

  return notes.criar(
    userId,
    {
      title: entrada.title,
      contentMd: mensagem.content,
      ...(entrada.kind !== undefined && { kind: entrada.kind }),
      ...(entrada.workspaceId !== undefined && { workspaceId: entrada.workspaceId }),
    },
    { via: "chat", author: mensagem.modelUsed ?? mensagem.modelId, conversationId },
  );
}

export interface AnexoResolvido {
  entrada: ChatAttachmentInput;
  titulo: string;
  /// O texto que vai para o modelo, pelos formatadores de `packages/shared` —
  /// os mesmos do servidor MCP (RF-26, CA-11).
  texto: string;
}

/**
 * Resolve o que o `@` anexou (RF-18, RF-19).
 *
 * Nota entra com o **corpo completo**; quadro, com as colunas e a face dos
 * cards; card, com a ficha dele. É o mesmo recorte que o MCP já usa, e é o
 * mesmo código — duas montagens apareceriam como o mesmo dado com duas caras.
 *
 * Um alvo que não é do usuário levanta 404 pelo service de origem, sem ramo
 * especial aqui: é a regra de escopo do projeto inteiro funcionando sozinha.
 */
export async function resolverAnexos(
  userId: string,
  anexos: ChatAttachmentInput[],
  fuso: string,
): Promise<AnexoResolvido[]> {
  return Promise.all(
    anexos.map(async (entrada): Promise<AnexoResolvido> => {
      if (entrada.noteId) {
        const nota = await notes.buscarPorId(userId, entrada.noteId);
        return { entrada, titulo: nota.title, texto: formatarNota(nota, fuso) };
      }
      if (entrada.boardId) {
        const board = await kanban.buscarBoard(userId, entrada.boardId);
        return { entrada, titulo: board.name, texto: formatarQuadro(board, fuso) };
      }
      if (entrada.cardId) {
        const card = await kanban.buscarCard(userId, entrada.cardId);
        return { entrada, titulo: card.title, texto: formatarCardDetalhe(card, fuso) };
      }
      /// O schema de `packages/shared` garante um dos três; este ramo existe
      /// para o `strict` do TypeScript, não para acontecer.
      throw new AppError(422, "VALIDATION_ERROR", "Anexo sem alvo");
    }),
  );
}

/**
 * Os anexos como um bloco de contexto, com o limite **declarado** quando corta
 * (RNF-04).
 *
 * Nada de truncar calado: o usuário anexou aquilo de propósito, e uma resposta
 * que ignorou metade do que ele mandou sem avisar é pior do que uma recusa.
 * Cortamos por anexo inteiro, não no meio de um — meia nota no contexto é o
 * tipo de entrada que faz o modelo afirmar o contrário do que a nota diz.
 */
export function montarContexto(anexos: AnexoResolvido[]): { texto: string; cortados: string[] } {
  const partes: string[] = [];
  const cortados: string[] = [];
  let tamanho = 0;

  for (const anexo of anexos) {
    const bloco = `<<< ${anexo.titulo} >>>\n${anexo.texto}`;
    if (tamanho + bloco.length > MAX_CONTEUDO_IA) {
      cortados.push(anexo.titulo);
      continue;
    }
    partes.push(bloco);
    tamanho += bloco.length;
  }

  return { texto: partes.join("\n\n"), cortados };
}
