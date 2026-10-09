import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@yu-book/cliente/api";

/**
 * Evento e tarefa no front (frente de agenda). Por ora só o que o chat precisa
 * — o Desfazer do que ele criou e a invalidação. As telas de agenda e tarefas
 * moram no app móvel (`apps/movel`); o desktop ganha só o bloco "Hoje" do
 * Início (Fase 6 da frente de agenda).
 *
 * **Nada de valor de `@yu-book/shared` entra aqui.** Este módulo vai ao chunk
 * inicial por `lib/chat.ts`, que a sessão do chat (sempre montada) importa, e
 * `eventos.ts` e `tarefas.ts` de `shared` constroem schema em escopo de
 * módulo e puxam `agenda.ts` e `ia.ts` atrás (skill `contrato-compartilhado`
 * §2.6). Tipo, quando precisar, vem por `import type`.
 */

/**
 * As chaves de cache da agenda, **como prefixos**. A convenção para o bloco
 * "Hoje": toda query de agenda começa por uma destas — `["agenda", de, ate]`,
 * `["tarefas", filtro]`, `["eventos", id]` —, e quem escreve invalida o
 * prefixo, sem saber quais recortes estão em cache. Uma query com outra raiz
 * ficaria de fora de `invalidarAgenda` sem erro e sem sintoma até alguém
 * olhar a tela velha.
 */
export const CHAVE_AGENDA = ["agenda"] as const;
export const CHAVE_TAREFAS = ["tarefas"] as const;
export const CHAVE_EVENTOS = ["eventos"] as const;

/**
 * Evento ou tarefa mudou: tudo que os mostra fica velho, inclusive o Início.
 * Sem `refetchType: "none"`: o bloco "Hoje" do Início pode estar na tela
 * ao lado do painel do chat; desmontada, o padrão (`active`) não custa rede.
 */
export function invalidarAgenda(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: CHAVE_AGENDA });
  void qc.invalidateQueries({ queryKey: CHAVE_TAREFAS });
  void qc.invalidateQueries({ queryKey: CHAVE_EVENTOS });
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useExcluirEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/events/${id}`),
    onSuccess: () => invalidarAgenda(qc),
  });
}

export function useExcluirTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    onSuccess: () => invalidarAgenda(qc),
  });
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/**
 * "2026-10-10" → "sex, 10/10". O dia já chega decidido no fuso do usuário
 * (o servidor converteu); ler a data pelo `Date` local a empurraria para o
 * fuso do navegador. O dia da semana sai de `Date.UTC` + `getUTCDay`, que é
 * aritmética de calendário pura, sem fuso nenhum.
 */
export function diaDaAgenda(dia: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  if (!ano || !mes || !d) return dia;
  const semana = DIAS_DA_SEMANA[new Date(Date.UTC(ano, mes - 1, d)).getUTCDay()];
  const dd = String(d).padStart(2, "0");
  const mm = String(mes).padStart(2, "0");
  return semana ? `${semana}, ${dd}/${mm}` : `${dd}/${mm}`;
}

/**
 * O "quando" de um evento ou tarefa, em texto: "sex, 10/10 · 14:00". Hora
 * nula diz coisas diferentes nos dois — o evento é de dia inteiro; a tarefa só
 * não tem hora, e nada se acrescenta. Tarefa sem dia é "sem data".
 */
export function quandoNaAgenda(
  tipo: "event" | "task",
  dia: string | null,
  hora: string | null,
): string {
  if (!dia) return "sem data";
  const quando = diaDaAgenda(dia);
  if (hora) return `${quando} · ${hora}`;
  return tipo === "event" ? `${quando} · dia inteiro` : quando;
}
