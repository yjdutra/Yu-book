import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { AgendaRange, TaskCompleteInput, TaskItem } from "@yu-book/shared";
import { useCallback, useState } from "react";
import { api } from "./api";
import { CHAVE_AGENDA, CHAVE_TAREFAS, invalidarAgenda } from "./agenda";

/*
 * Concluir tarefa, nos dois fronts — o hook da mutação e o invólucro das telas
 * (`useAlternarTarefa`). Saiu de `agenda.ts` na Fase 6 da frente de
 * agenda: aquele módulo vai ao chunk inicial do web (pela invalidação do
 * chat), e um módulo do pacote que o inicial importa leva para lá toda
 * exportação que algum chunk use (contrato §6) — e no web só o bloco "Hoje"
 * do Início, preguiçoso, conclui.
 */

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
      api.patch<TaskItem>(`/tasks/${id}/complete`, {
        completed: concluir,
      } satisfies TaskCompleteInput),
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


/**
 * Concluir ou reabrir com um toque, de qualquer lista dos dois fronts — o
 * bloco "Hoje" do web e as listas do móvel. A caixa marca na hora e volta
 * sozinha se a API recusar (o otimismo e o rollback são de
 * `useConcluirTarefa`); aqui fica só o porquê, para a tela mostrar num
 * `Aviso` — a caixa que desmarca calada pareceria um toque que não pegou.
 */
export function useAlternarTarefa() {
  const concluir = useConcluirTarefa();
  const [aviso, setAviso] = useState<string | null>(null);

  const alternar = useCallback(
    (tarefa: TaskItem) => {
      setAviso(null);
      // `mutateAsync` e não `mutate(…, { onError })`: no TanStack v5 o
      // callback por chamada só dispara para a **última** chamada do
      // observador. Dois toques quase juntos com o primeiro recusado
      // desmarcariam a caixa calados; a promessa rejeita para cada chamada.
      concluir
        .mutateAsync({ id: tarefa.id, concluir: tarefa.completedAt === null })
        .catch(() =>
          setAviso(
            `Não deu para atualizar “${tarefa.title}”. Confira a conexão e tente de novo.`,
          ),
        );
    },
    // `mutateAsync` é estável; o objeto da mutation, não.
    [concluir.mutateAsync],
  );
  return { alternar, aviso, limparAviso: () => setAviso(null) };
}
