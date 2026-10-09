import { useMutation } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ChatCreated, MessageToNoteInput, NoteDetail } from "@yu-book/shared";
import { invalidarAgenda } from "@yu-book/cliente/agenda";
import { api } from "@yu-book/cliente/api";
import { useInvalidar } from "./notas";

/**
 * O que do chat é só do web (Fase 5 da frente de agenda). O transporte, as
 * consultas de conversa e o redutor da fala em curso moram em
 * `@yu-book/cliente/chat`, comuns ao móvel; aqui ficam as chaves do gasto, que
 * só o web mostra, e o que refaz as telas do acervo — notas, quadros, o Início
 * — depois que o chat grava nele.
 */

/// O AI usage dash (`/ajustes/uso`) lê `ai_usage`, e toda chamada ao provedor
/// grava uma linha ali. Invalidado nos mesmos pontos que `CHAVE_AJUSTES`
/// (`@yu-book/cliente/ia`, a chave que o móvel também lê).
export const CHAVE_USO = ["ia", "uso"] as const;

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
 * o card caiu, e é raro o bastante para não pesar. Evento e tarefa (frente de
 * agenda) levam os prefixos da agenda (`invalidarAgenda`), que o bloco "Hoje"
 * do Início lê.
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
  if (criados.some((c) => c.kind === "event" || c.kind === "task")) invalidarAgenda(qc);
  void qc.invalidateQueries({ queryKey: ["search"], refetchType: "none" });
  // Sem o `refetchType: "none"` do autosave de propósito: aqui o Início pode
  // estar na tela ao lado do painel, e o card com prazo precisa aparecer nele.
  // Desmontado, o padrão (`active`) também não custa rede.
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
}

/**
 * O chat concluiu ou reabriu card (frente de cards, Parte 1). O pedido da
 * ferramenta não diz qual card nem se deu certo — o quadro, o painel e a home
 * vão inteiros, pelo mesmo motivo de `invalidarCriados`.
 */
export function invalidarConclusao(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["board"] });
  void qc.invalidateQueries({ queryKey: ["card"] });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
}
