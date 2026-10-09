import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AgendaRange,
  EventInput,
  EventItem,
  EventScope,
  EventUpdateInput,
  TaskInput,
  TaskItem,
  TaskStatus,
  TaskUpdateInput,
} from "@yu-book/shared";
import { api } from "./api";

/**
 * Evento e tarefa nos dois fronts (frente de agenda). Nasceu no web, para o
 * chat (o Desfazer do que ele criou e a invalidação), e subiu para o pacote na
 * Fase 4, quando o móvel ganhou a agenda: as chaves e a invalidação precisam
 * ser as mesmas nos dois, e o bloco "Hoje" do Início do web (Fase 6) lê pelos
 * mesmos hooks.
 *
 * **Nada de valor de `@yu-book/shared` entra aqui.** No web este módulo vai ao
 * chunk inicial por `lib/chat.ts`, que a sessão do chat (sempre montada)
 * importa, e `eventos.ts` e `tarefas.ts` de `shared` constroem schema em
 * escopo de módulo e puxam `agenda.ts` e `ia.ts` atrás (skill
 * `contrato-compartilhado` §2.6). Tipo vem por `import type`; o móvel, que
 * pode levar valor, importa `somarDias` e `diasDoEvento` por conta própria.
 *
 * **O cliente não converte fuso** (INV-66): manda e recebe dia e hora locais
 * do usuário, e o "hoje" é `AgendaRange.today`, não o relógio do aparelho.
 */

/**
 * As chaves de cache da agenda, **como prefixos**. A convenção: toda query de
 * agenda começa por uma destas — `["agenda", de, ate]`, `["tarefas",
 * filtro]` —, e quem escreve invalida o prefixo, sem saber quais recortes
 * estão em cache. Uma query com outra raiz ficaria de fora de
 * `invalidarAgenda` sem erro e sem sintoma até alguém olhar a tela velha.
 */
export const CHAVE_AGENDA = ["agenda"] as const;
export const CHAVE_TAREFAS = ["tarefas"] as const;

/**
 * Evento ou tarefa mudou: tudo que os mostra fica velho — o bloco "Hoje" do
 * Início do web inclusive, que lê `["agenda", …]`. O `["dashboard"]` fica de
 * fora: `GET /dashboard` não traz evento nem tarefa. Sem `refetchType:
 * "none"`: o bloco pode estar na tela ao lado do painel do chat; desmontada,
 * o padrão (`active`) não custa rede.
 */
export function invalidarAgenda(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: CHAVE_AGENDA });
  void qc.invalidateQueries({ queryKey: CHAVE_TAREFAS });
}

/**
 * A pergunta do dia, a mesma em todo lugar que a oferece ao assistente: a
 * paleta e o rodapé do bloco "Hoje" do web, e as sugestões da conversa vazia
 * nos dois fronts. Mora aqui, e não no bloco, porque este módulo já está no
 * chunk inicial do web (contrato §6).
 */
export const PERGUNTA_DO_DIA = "O que tenho hoje?";

/* --------------------------------------------------------------- leitura */

/**
 * Eventos, tarefas e prazos de `from` a `to`, inclusive — o que o calendário
 * desenha numa requisição. Os dois dias são locais do usuário; quem ainda não
 * conhece o "hoje" dele pode escolher a janela pela data do aparelho (a
 * resposta corrige: `today` vem dela).
 */
export function useAgenda(from: string | null, to: string | null) {
  return useQuery({
    queryKey: [...CHAVE_AGENDA, from, to],
    queryFn: () => api.get<AgendaRange>(`/agenda?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
    // A exceção ao `refetchOnWindowFocus: false` dos dois apps: a agenda muda
    // noutro aparelho — a tarefa concluída no celular, o evento marcado pelo
    // MCP —, e o Início do desktop a mostra ao voltar à aba. É também o que
    // corrige a virada do dia: o `today` novo chega no primeiro foco depois
    // da meia-noite. Respeita o `staleTime`, como todo refetch automático.
    refetchOnWindowFocus: true,
  });
}

export interface FiltroTarefas {
  status?: TaskStatus;
  boardId?: string;
}

/**
 * `ativo: false` não busca — a aba de concluídas só pede as dela quando
 * aberta. A chave inclui o filtro inteiro: `["tarefas", { status, boardId }]`.
 */
export function useTarefas(filtro: FiltroTarefas = {}, ativo = true) {
  const busca = new URLSearchParams();
  if (filtro.status) busca.set("status", filtro.status);
  if (filtro.boardId) busca.set("boardId", filtro.boardId);
  const query = busca.toString();
  return useQuery({
    queryKey: [...CHAVE_TAREFAS, filtro],
    queryFn: () => api.get<TaskItem[]>(`/tasks${query ? `?${query}` : ""}`),
    enabled: ativo,
    // Pela mesma razão de `useAgenda`: a tarefa se conclui noutro aparelho.
    refetchOnWindowFocus: true,
  });
}

/* ---------------------------------------------------------------- evento */

/// `origin` fica de fora: a marca de IA é do MCP, nunca da tela (INV-58).
export type NovoEvento = Omit<EventInput, "origin">;
export type NovaTarefa = Omit<TaskInput, "origin">;

export function useCriarEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (evento: NovoEvento) => api.post<EventItem>("/events", evento),
    onSuccess: () => invalidarAgenda(qc),
  });
}

/**
 * O caminho de PATCH e DELETE de um evento, com o escopo na query quando ele
 * vem (frente de eventos recorrentes, R3). Sem escopo, o servidor entende
 * `todas`: a série inteira, ou o evento simples — o que o Desfazer do chat
 * quer, e o que estas rotas faziam antes da série.
 */
function caminhoDoEvento(id: string, escopo?: EventScope): string {
  if (!escopo) return `/events/${id}`;
  const busca = new URLSearchParams({ scope: escopo.scope });
  if (escopo.occurrenceDate) busca.set("occurrenceDate", escopo.occurrenceDate);
  return `/events/${id}?${busca.toString()}`;
}

/**
 * PATCH parcial: mande só o que mudou. O servidor mescla o horário com o
 * gravado (`mesclarHorario`) — mandar `date` sozinho anda com o evento inteiro,
 * mantendo o vão e a duração.
 *
 * **Numa série, o escopo muda a base da mescla.** Em `esta` e `seguintes` ela é
 * a ocorrência de `occurrenceDate`; em `todas`, a **primeira** ocorrência: ali
 * `date` recomeça a série, e mudar só a hora move todas. Quem edita a partir de
 * uma ocorrência não manda o `date` dela num `todas`, salvo quando o usuário
 * mudou o dia de propósito. Devolve o evento que ficou com os dados novos — o
 * avulso ou a série nova têm `id` próprio.
 */
export function useAtualizarEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      mudanca,
      escopo,
    }: {
      id: string;
      mudanca: EventUpdateInput;
      escopo?: EventScope;
    }) => api.patch<EventItem>(caminhoDoEvento(id, escopo), mudanca),
    onSuccess: () => invalidarAgenda(qc),
  });
}

/** Só o `id` apaga a série inteira (ou o evento simples). */
export function useExcluirEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alvo: string | { id: string; escopo?: EventScope }) =>
      typeof alvo === "string"
        ? api.delete<void>(caminhoDoEvento(alvo))
        : api.delete<void>(caminhoDoEvento(alvo.id, alvo.escopo)),
    onSuccess: () => invalidarAgenda(qc),
  });
}

/* ---------------------------------------------------------------- tarefa */

export function useCriarTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tarefa: NovaTarefa) => api.post<TaskItem>("/tasks", tarefa),
    onSuccess: () => invalidarAgenda(qc),
  });
}

export function useAtualizarTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mudanca }: { id: string; mudanca: TaskUpdateInput }) =>
      api.patch<TaskItem>(`/tasks/${id}`, mudanca),
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

/*
 * Concluir tarefa (`useConcluirTarefa`) mora em `concluirTarefa.ts`: este
 * módulo vai ao chunk inicial do web, e levaria para lá toda exportação que
 * algum chunk usasse — o concluir otimista só serve ao bloco "Hoje", que é
 * `lazy` (contrato §6).
 */

/** "dom" a "sáb", domingo primeiro (o 0 de `getUTCDay`), nos dois fronts. */
export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/**
 * "2026-10-10" → "sex, 10/10". O dia já chega decidido no fuso do usuário
 * (o servidor converteu); ler a data pelo `Date` local a empurraria para o
 * fuso do navegador. O dia da semana sai de `Date.UTC` + `getUTCDay`, que é
 * aritmética de calendário pura, sem fuso nenhum.
 */
export function diaDaAgenda(dia: string): string {
  const [ano, mes, d] = dia.split("-").map(Number);
  if (!ano || !mes || !d) return dia;
  const semana = DIAS_CURTOS[new Date(Date.UTC(ano, mes - 1, d)).getUTCDay()];
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
