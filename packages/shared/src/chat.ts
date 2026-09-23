import { z } from "zod";
import type { AiCallUsage } from "./ia.js";
import type { AiMessageRole } from "./enums.js";

/**
 * O chat ancorado — Etapa B da frente de IA, RF-17 a RF-26 de
 * `docs/prd-ia-no-yu-book.md`.
 *
 * A diferença para a Etapa A cabe numa frase: **uma mensagem do usuário não é
 * uma chamada ao provedor, são até cinco.** O modelo pede uma ferramenta, o
 * Yu-book executa, o resultado volta, ele decide se acabou. Tudo o que é
 * estranho neste contrato — o teto conferido por passo, o evento de ferramenta
 * no fluxo, o papel `tool` na mensagem — sai daí.
 */

/**
 * Quantas voltas o laço dá antes de desistir.
 *
 * Não é generosidade nem economia: é o que impede um modelo que entrou em
 * ciclo (buscar → não achar → buscar de novo) de gastar o teto do dia inteiro
 * numa pergunta só. Cinco cobre o caminho real mais longo que desenhamos —
 * buscar, ler duas notas, ver o quadro, responder.
 */
export const MAX_PASSOS_DO_LACO = 5;

export const MAX_TITULO_CONVERSA = 120;
export const MAX_MENSAGEM_CHAT = 4_000;

/// Quantos anexos cabem numa mensagem. O corte de verdade é por tamanho —
/// este só evita montar 200 consultas antes de descobrir isso.
export const MAX_ANEXOS_POR_MENSAGEM = 10;

export interface ChatSource {
  kind: "note" | "card" | "board";
  id: string;
  title: string;
}

export interface ChatAttachment {
  id: string;
  noteId: string | null;
  cardId: string | null;
  boardId: string | null;
  /// O título no momento do anexo. O alvo pode ter ido para a lixeira depois, e
  /// o histórico não pode virar três nulos por causa disso.
  title: string;
}

export interface ChatMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  /// RF-25: o painel diz qual modelo respondeu **cada** mensagem. Só em
  /// `assistant`.
  modelId: string | null;
  modelUsed: string | null;
  /// Em `tool`: qual ação produziu este resultado.
  toolName: string | null;
  /// O que o turno consultou, na fala que o fecha. Vazio nas demais.
  sources: ChatSource[];
  createdAt: string;
  attachments: ChatAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

/**
 * O que trafega no `text/event-stream` enquanto a resposta é gerada.
 *
 * União discriminada por `tipo`, e não um objeto com campos opcionais: quem lê
 * do outro lado é um `switch`, e um campo opcional a mais viraria um ramo que
 * ninguém escreveu.
 */
export type ChatEvent =
  /**
   * Primeiro evento, sempre. Traz a mensagem do usuário **já persistida** — a
   * tela troca o rascunho local por ela, e é assim que o id existe antes de a
   * resposta começar.
   *
   * `cortados` são os anexos que não couberam no orçamento de contexto. Vêm
   * aqui porque o RNF-04 exige que o limite seja **declarado** quando corta:
   * uma resposta que ignorou metade do que o usuário anexou, em silêncio, é
   * pior do que uma recusa.
   */
  | { tipo: "inicio"; mensagem: ChatMessage; cortados: string[] }
  /// Um pedaço de texto da resposta. Chega em ordem; concatenar basta.
  | { tipo: "delta"; texto: string }
  /// O modelo pediu uma ação e ela está sendo executada. É o que o painel
  /// mostra como "consultando o acervo" — sem isto, a espera do passo de
  /// ferramenta é um silêncio sem explicação.
  | { tipo: "ferramenta"; nome: string; passo: number }
  /// O que aquela ação consultou (RN-05). Determinístico: não depende de o
  /// modelo citar.
  | { tipo: "fontes"; fontes: ChatSource[] }
  /**
   * O teto diário cortou **no meio** do laço. O que já foi gerado fica: os
   * passos anteriores custaram dinheiro e renderam alguma coisa, e o usuário
   * precisa ver onde parou em vez de receber um erro que apaga tudo.
   */
  | { tipo: "teto"; mensagem: string }
  /// Acabou. `mensagem` é a mensagem de assistente já persistida.
  | { tipo: "fim"; mensagem: ChatMessage; usage: AiCallUsage[] }
  /// Falhou no meio do fluxo. Depois do primeiro byte não há mais status HTTP
  /// para usar, então o erro vira evento — com o mesmo `code` estável de
  /// sempre, para o front decidir por ele e não pela frase.
  | { tipo: "erro"; code: string; mensagem: string };

export const conversationInputSchema = z.object({
  title: z.string().trim().min(1, "Informe um título").max(MAX_TITULO_CONVERSA),
});

/**
 * Um anexo: exatamente **um** dos três alvos.
 *
 * `superRefine` e não três schemas: a regra é "um e só um", e escrevê-la como
 * união exigiria que quem chama soubesse qual ramo tentar primeiro.
 */
export const chatAttachmentSchema = z
  .object({
    noteId: z.string().uuid().optional(),
    cardId: z.string().uuid().optional(),
    boardId: z.string().uuid().optional(),
  })
  .superRefine((valor, ctx) => {
    const quantos = [valor.noteId, valor.cardId, valor.boardId].filter(Boolean).length;
    if (quantos !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Um anexo aponta para exatamente uma nota, um card ou um quadro",
      });
    }
  });

export const chatMessageInputSchema = z.object({
  content: z.string().trim().min(1, "Escreva alguma coisa").max(MAX_MENSAGEM_CHAT),
  attachments: z.array(chatAttachmentSchema).max(MAX_ANEXOS_POR_MENSAGEM).default([]),
});

export type ConversationInput = z.infer<typeof conversationInputSchema>;
export type ChatAttachmentInput = z.infer<typeof chatAttachmentSchema>;
export type ChatMessageInput = z.infer<typeof chatMessageInputSchema>;
