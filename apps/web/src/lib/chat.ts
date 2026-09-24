import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ChatAttachmentInput,
  ChatCreated,
  ChatEvent,
  Conversation,
  ConversationDetail,
  ConversationInput,
  MessageToNoteInput,
  NoteDetail,
} from "@yu-book/shared";
import { api, apiStream } from "./api";
import { useInvalidar } from "./notas";

/**
 * O chat ancorado (Etapa B da frente de IA).
 *
 * O invariante do arquivo é o mesmo de `ia.ts`: **nenhuma chave de provedor
 * passa por aqui**. Toda chamada de modelo sai do servidor (RNF-02), e o que
 * o front conhece é um fluxo de eventos.
 */

/**
 * As chaves de cache, **exportadas**.
 *
 * Quem invalida está em `sessaoChat.tsx`, e quem consulta está aqui. Escritas à mão
 * nos dois lugares, trocar uma deixaria a outra invalidando coisa nenhuma, sem
 * erro de tipo e sem sintoma.
 */
export const CHAVE_CONVERSAS = ["ia", "conversas"] as const;
export const chaveDaConversa = (id: string) => ["ia", "conversa", id] as const;
/// A tela de ajustes mostra o gasto do dia, e uma mensagem do chat o move.
export const CHAVE_AJUSTES = ["ia", "ajustes"] as const;

const CONVERSAS = CHAVE_CONVERSAS;
const conversa = chaveDaConversa;

export function useConversas() {
  return useQuery({
    queryKey: CONVERSAS,
    queryFn: () => api.get<Conversation[]>("/ai/conversations"),
    staleTime: 30_000,
  });
}

export function useConversa(id: string | null) {
  return useQuery({
    queryKey: conversa(id ?? ""),
    queryFn: () => api.get<ConversationDetail>(`/ai/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useCriarConversa() {
  const qc = useQueryClient();
  return useMutation({
    /// `agentId` só na criação: o agente é fixo por conversa (Etapa D).
    mutationFn: (input: ConversationInput) => api.post<Conversation>("/ai/conversations", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONVERSAS }),
  });
}

export function useRenomearConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<Conversation>(`/ai/conversations/${id}`, { title }),
    onSuccess: (atualizada) => {
      qc.invalidateQueries({ queryKey: CONVERSAS });
      /// Costura em vez de invalidar: renomear não muda uma mensagem sequer, e
      /// recarregar a conversa inteira jogaria fora o que já está na tela.
      qc.setQueryData<ConversationDetail>(conversa(atualizada.id), (atual) =>
        atual ? { ...atual, ...atualizada } : atual,
      );
    },
  });
}

export function useExcluirConversa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ai/conversations/${id}`),
    onSuccess: (_vazio, id) => {
      qc.removeQueries({ queryKey: conversa(id) });
      qc.invalidateQueries({ queryKey: CONVERSAS });
    },
  });
}

/**
 * "Virar nota" (Etapa C da frente de IA): a resposta gravada vira nota marcada.
 * O corpo **não** vai daqui — o servidor lê a mensagem, e o cliente só escolhe
 * título, tipo e workspace. Criar nota por outra rota ainda é criar nota: a
 * invalidação é a mesma de `useCriarNota`.
 */
export function useVirarNota() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({
      conversationId,
      messageId,
      input,
    }: {
      conversationId: string;
      messageId: string;
      input: MessageToNoteInput;
    }) =>
      api.post<NoteDetail>(
        `/ai/conversations/${conversationId}/messages/${messageId}/note`,
        input,
      ),
    onSuccess: invalidar,
  });
}

/**
 * O chat acabou de gravar no acervo (evento `criado`): as listas que mostram
 * nota e card ficaram velhas. O quadro vai inteiro — o evento não diz em qual
 * o card caiu, e é raro o bastante para não pesar.
 */
export function invalidarCriados(qc: QueryClient, criados: ChatCreated[]): void {
  if (criados.some((c) => c.kind === "note")) {
    void qc.invalidateQueries({ queryKey: ["notes"] });
    void qc.invalidateQueries({ queryKey: ["counts"] });
    void qc.invalidateQueries({ queryKey: ["titles"] });
    void qc.invalidateQueries({ queryKey: ["tags"] });
  }
  if (criados.some((c) => c.kind === "card")) {
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["boards"] });
  }
  void qc.invalidateQueries({ queryKey: ["search"], refetchType: "none" });
  // Sem o `refetchType: "none"` do autosave de propósito: aqui o Início pode
  // estar na tela ao lado do painel, e o card com prazo precisa aparecer nele.
  // Desmontado, o padrão (`active`) também não custa rede.
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
}

/**
 * Lê o `text/event-stream` da resposta, entregando cada evento a quem chamou.
 *
 * É a única leitura incremental de corpo HTTP do front. Três cuidados que não
 * são opcionais:
 *
 * - o pedaço que chega pode **cortar um evento ao meio** — TCP não respeita
 *   fronteira de `\n\n` —, então o resto fica guardado para o pedaço seguinte;
 * - `decode(..., { stream: true })` porque um caractere multibyte também pode
 *   vir partido entre dois pedaços, e sem isto acentos viram `�`;
 * - o `signal` cancela de verdade: fechar o painel no meio de uma resposta
 *   precisa soltar a conexão, não deixá-la escrevendo em memória.
 */
export async function lerEventos(
  resposta: Response,
  aoEvento: (evento: ChatEvent) => void,
): Promise<void> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return;

  const decodificador = new TextDecoder();
  let resto = "";

  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;

    resto += decodificador.decode(value, { stream: true });
    const blocos = resto.split("\n\n");
    resto = blocos.pop() ?? "";

    for (const bloco of blocos) {
      const linha = bloco.split("\n").find((l) => l.startsWith("data:"));
      if (!linha) continue;
      try {
        aoEvento(JSON.parse(linha.slice("data:".length).trim()) as ChatEvent);
      } catch {
        /// Evento malformado não derruba a conversa inteira.
      }
    }
  }
}

export interface EnvioDeMensagem {
  conversationId: string;
  content: string;
  attachments: ChatAttachmentInput[];
  aoEvento: (evento: ChatEvent) => void;
  signal?: AbortSignal;
}

/**
 * Manda a mensagem e consome o fluxo.
 *
 * Não é `useMutation`: o valor desta chamada não é o retorno, são os eventos
 * que chegam durante ela — e o cache de quem acompanha é o estado local do
 * painel, não o do TanStack.
 */
export async function enviarMensagem({
  conversationId,
  content,
  attachments,
  aoEvento,
  signal,
}: EnvioDeMensagem): Promise<void> {
  const resposta = await apiStream(`/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, attachments }),
    ...(signal && { signal }),
  });
  await lerEventos(resposta, aoEvento);
}
