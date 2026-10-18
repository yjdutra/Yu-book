import { useConcluirTarefa } from "@yu-book/cliente/concluirTarefa";
import { ganhoNaSemana, useCheckIn, useHabitos } from "@yu-book/cliente/habitos";
import type { EventItem, HabitActivityRef, TaskItem } from "@yu-book/shared";
import { useCallback, useState } from "react";
import { useRitmo } from "./Ritmo";

/**
 * O check de uma atividade do dia (frente Ritmo, RF-26 e RF-29): concluir a
 * tarefa ou fazer o check-in do evento — o mesmo gesto da agenda, nunca um
 * registro avulso no lugar (RN-18). A caixa marca na hora (o otimismo é dos
 * hooks do pacote); depois que a API confirma, o toast diz o ganho (RF-27).
 * Desfazer não tem toast: a caixa desmarcada já diz.
 *
 * O ganho é calculado antes da resposta, sobre a semana em cache — a releitura
 * que a invalidação traz corrige o anel se o servidor pensou diferente.
 */
export function useMarcarAtividade() {
  const concluir = useConcluirTarefa();
  const checkIn = useCheckIn();
  const habitos = useHabitos();
  const { avisarGanho } = useRitmo();
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = habitos.data;

  const comemorar = useCallback(
    (vinculo: HabitActivityRef, dia: string) => {
      const habito = lista?.find((h) => h.id === vinculo.habitId);
      // Fora da semana corrente, a conta da semana não vale: sem toast.
      if (!habito || !habito.week.days.some((d) => d.day === dia)) return;
      avisarGanho(habito, ganhoNaSemana(habito, vinculo.points, dia));
    },
    [lista, avisarGanho],
  );

  const marcarTarefa = useCallback(
    (tarefa: TaskItem, hoje: string) => {
      setAviso(null);
      const fazer = tarefa.completedAt === null;
      concluir
        .mutateAsync({ id: tarefa.id, concluir: fazer })
        // Concluir pontua no dia da conclusão, que é hoje (RF-07).
        .then(() => fazer && tarefa.habitActivity && comemorar(tarefa.habitActivity, hoje))
        .catch(() =>
          setAviso(`Não deu para atualizar “${tarefa.title}”. Confira a conexão e tente de novo.`),
        );
    },
    [concluir.mutateAsync, comemorar],
  );

  const marcarEvento = useCallback(
    (evento: EventItem) => {
      setAviso(null);
      const fazer = !evento.checkedIn;
      const dia = evento.occurrenceDate;
      checkIn
        .mutateAsync({ id: evento.id, dia, fazer })
        .then(() => fazer && evento.habitActivity && comemorar(evento.habitActivity, dia))
        .catch(() =>
          setAviso(
            `Não deu para ${fazer ? "fazer" : "desfazer"} o check-in de “${evento.title}”. ` +
              "Confira a conexão e tente de novo.",
          ),
        );
    },
    [checkIn.mutateAsync, comemorar],
  );

  return { marcarTarefa, marcarEvento, aviso, limparAviso: () => setAviso(null) };
}
