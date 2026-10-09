import type { TaskItem } from "@yu-book/shared";
import { useId } from "react";
import { ItemAgenda } from "../agenda/ItemAgenda";
import { itemDeTarefa } from "../agenda/itens";
import type { ItemDoDia } from "../agenda/itens";
import { agruparTarefas, quandoNoGrupo } from "./grupos";
import type { GrupoDeTarefas } from "./grupos";

/**
 * As tarefas abertas em seções — Atrasadas, Hoje, Amanhã, Próximos 7 dias,
 * Depois, Sem data —, cada uma com a contagem. Serve a Tarefas e ao detalhe
 * do projeto. `nivel` é o do título da seção na página que a hospeda.
 */
export function ListaAgrupada({
  tarefas,
  hoje,
  nivel = 2,
  onAbrir,
  onConcluir,
}: {
  tarefas: TaskItem[];
  hoje: string;
  nivel?: 2 | 3;
  onAbrir: (item: ItemDoDia) => void;
  onConcluir: (tarefa: TaskItem) => void;
}) {
  return (
    <div className="space-y-7">
      {agruparTarefas(tarefas, hoje).map((grupo) => (
        <Grupo
          key={grupo.chave}
          grupo={grupo}
          nivel={nivel}
          onAbrir={onAbrir}
          onConcluir={onConcluir}
        />
      ))}
    </div>
  );
}

function Grupo({
  grupo,
  nivel,
  onAbrir,
  onConcluir,
}: {
  grupo: GrupoDeTarefas;
  nivel: 2 | 3;
  onAbrir: (item: ItemDoDia) => void;
  onConcluir: (tarefa: TaskItem) => void;
}) {
  const id = useId();
  const Titulo = nivel === 2 ? "h2" : "h3";
  const atrasadas = grupo.chave === "atrasadas";
  return (
    <section aria-labelledby={id} data-foco-retorno={id}>
      {/* A cor do atraso vai num filho: a de `rotulo` e a de `text-red-300`
          no mesmo nó disputam pela ordem do CSS gerado, não do atributo. */}
      <Titulo id={id} tabIndex={-1} className="rotulo flex items-center gap-2">
        <span className={atrasadas ? "font-semibold text-red-300" : undefined}>
          {atrasadas && <span aria-hidden="true">! </span>}
          {grupo.titulo}
        </span>
        <span
          className="rounded-full bg-ink-800 px-2 py-0.5 text-miudo font-semibold normal-case
                     tracking-normal text-ink-200"
        >
          {grupo.tarefas.length}
        </span>
      </Titulo>
      <ul className="mt-3 space-y-2">
        {grupo.tarefas.map((tarefa) => (
          <ItemAgenda
            key={tarefa.id}
            item={itemDeTarefa(tarefa, quandoNoGrupo(tarefa, grupo.chave))}
            atrasada={atrasadas && tarefa.completedAt === null}
            onAbrir={onAbrir}
            onConcluir={onConcluir}
          />
        ))}
      </ul>
    </section>
  );
}
