import { useConcluirTarefa } from "@yu-book/cliente/agenda";
import type { TaskItem } from "@yu-book/shared";
import { useCallback, useState } from "react";

/**
 * Concluir ou reabrir com um toque, de qualquer lista do móvel. A caixa marca
 * na hora e volta sozinha se a API recusar (o otimismo e o rollback são do
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
