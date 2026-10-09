import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AgendaRange,
  EventInput,
  EventItem,
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
 * PATCH parcial: mande só o que mudou. O servidor mescla o horário com o
 * gravado (`mesclarHorario`) — mandar `date` sozinho anda com o evento inteiro,
 * mantendo o vão e a duração.
 */
export function useAtualizarEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, mudanca }: { id: string; mudanca: EventUpdateInput }) =>
      api.patch<EventItem>(`/events/${id}`, mudanca),
    onSuccess: () => invalidarAgenda(qc),
  });
}

export function useExcluirEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/events/${id}`),
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

/** Os campos que concluir muda — e que o rollback devolve. */
type EstadoDeConclusao = Pick<TaskItem, "completedAt" | "completion" | "overdue">;

/// Aplica `mudar` à tarefa `id` onde quer que ela esteja. Devolve a mesma
/// lista quando ela não está ali, para não trocar a identidade do cache à toa.
function naLista(lista: TaskItem[], id: string, mudar: (t: TaskItem) => TaskItem): TaskItem[] {
  return lista.some((t) => t.id === id)
    ? lista.map((t) => (t.id === id ? mudar(t) : t))
    : lista;
}

/// Em todo cache de `["agenda", …]` e `["tarefas", …]`. A agenda passa o
/// próprio `today`, que é o que diz se a tarefa reaberta volta atrasada.
function emTodoCache(
  qc: QueryClient,
  id: string,
  mudar: (t: TaskItem, hoje: string | null) => TaskItem,
): void {
  qc.setQueriesData<AgendaRange>({ queryKey: CHAVE_AGENDA }, (agenda) => {
    if (!agenda) return agenda;
    const m = (t: TaskItem) => mudar(t, agenda.today);
    return {
      ...agenda,
      tasks: naLista(agenda.tasks, id, m),
      overdueTasks: naLista(agenda.overdueTasks, id, m),
      undatedTasks: naLista(agenda.undatedTasks, id, m),
    };
  });
  qc.setQueriesData<TaskItem[]>({ queryKey: CHAVE_TAREFAS }, (lista) =>
    lista ? naLista(lista, id, (t) => mudar(t, null)) : lista,
  );
}

function acharTarefa(qc: QueryClient, id: string): TaskItem | undefined {
  for (const [, agenda] of qc.getQueriesData<AgendaRange>({ queryKey: CHAVE_AGENDA })) {
    const achada = [
      ...(agenda?.tasks ?? []),
      ...(agenda?.overdueTasks ?? []),
      ...(agenda?.undatedTasks ?? []),
    ].find((t) => t.id === id);
    if (achada) return achada;
  }
  for (const [, lista] of qc.getQueriesData<TaskItem[]>({ queryKey: CHAVE_TAREFAS })) {
    const achada = lista?.find((t) => t.id === id);
    if (achada) return achada;
  }
  return undefined;
}

const CHAVE_CONCLUIR = ["concluirTarefa"] as const;

/**
 * Concluir ou reabrir com um toque: a caixa marca na hora, em todo recorte em
 * cache, e volta se a API recusar.
 *
 * Dois cuidados que o padrão `onMutate`/`onError` sozinho não tem:
 *
 * - **O rollback devolve só os campos desta tarefa**, não uma foto do cache.
 *   Com dois toques em voo, a foto do segundo já traria o otimista do
 *   primeiro, e a do primeiro, restaurada na falha, apagaria o do segundo.
 * - **A invalidação espera a última terminar** (`isMutating <= 1`, a mesma
 *   regra de `useDefinirModeloDaTarefa` no web): um refetch no meio traria o
 *   servidor de antes da segunda escrita e desmarcaria a caixa por um instante.
 *
 * A tarefa concluída **não sai** da lista de abertas aqui: some no refetch,
 * depois que a caixa marcada já foi vista.
 */
export function useConcluirTarefa() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: CHAVE_CONCLUIR,
    mutationFn: ({ id, concluir }: { id: string; concluir: boolean }) =>
      api.patch<TaskItem>(`/tasks/${id}/complete`, { completed: concluir }),
    onMutate: async ({ id, concluir }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: CHAVE_AGENDA }),
        qc.cancelQueries({ queryKey: CHAVE_TAREFAS }),
      ]);
      const atual = acharTarefa(qc, id);
      const anterior: EstadoDeConclusao | null = atual
        ? { completedAt: atual.completedAt, completion: atual.completion, overdue: atual.overdue }
        : null;
      // O instante é só um marcador até a resposta: quem lê `completedAt`
      // aqui quer saber "concluída ou não".
      const agora = new Date().toISOString();
      emTodoCache(qc, id, (t, hoje) => ({
        ...t,
        completedAt: concluir ? agora : null,
        completion: null,
        overdue: concluir ? false : hoje !== null ? t.date !== null && t.date < hoje : t.overdue,
      }));
      return { anterior };
    },
    onError: (_erro, { id }, contexto) => {
      const anterior = contexto?.anterior;
      if (anterior) emTodoCache(qc, id, (t) => ({ ...t, ...anterior }));
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: CHAVE_CONCLUIR }) <= 1) invalidarAgenda(qc);
    },
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
