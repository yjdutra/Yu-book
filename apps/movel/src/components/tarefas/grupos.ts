import { somarDias } from "@yu-book/shared";
import type { TaskItem } from "@yu-book/shared";
import { diaCurto } from "../../lib/datas";

export type ChaveDoGrupo = "atrasadas" | "hoje" | "amanha" | "semana" | "depois" | "semData";

export interface GrupoDeTarefas {
  chave: ChaveDoGrupo;
  titulo: string;
  tarefas: TaskItem[];
}

const TITULO: Record<ChaveDoGrupo, string> = {
  atrasadas: "Atrasadas",
  hoje: "Hoje",
  amanha: "Amanhã",
  semana: "Próximos 7 dias",
  depois: "Depois",
  semData: "Sem data",
};

const ORDEM: ChaveDoGrupo[] = ["atrasadas", "hoje", "amanha", "semana", "depois", "semData"];

/**
 * Em que grupo a tarefa aberta cai. `date` é civil e `hoje` é o do usuário,
 * que veio da API (INV-66): a comparação é de texto `AAAA-MM-DD`, que ordena
 * como o calendário. "Próximos 7 dias" vai de depois de amanhã até uma semana
 * a partir de hoje.
 */
function grupoDe(tarefa: TaskItem, hoje: string): ChaveDoGrupo {
  if (!tarefa.date) return "semData";
  if (tarefa.overdue || tarefa.date < hoje) return "atrasadas";
  if (tarefa.date === hoje) return "hoje";
  if (tarefa.date === somarDias(hoje, 1)) return "amanha";
  if (tarefa.date <= somarDias(hoje, 7)) return "semana";
  return "depois";
}

/** Por dia, depois a hora (sem hora por último), depois o título. */
function comparar(a: TaskItem, b: TaskItem): number {
  return (
    (a.date ?? "").localeCompare(b.date ?? "") ||
    (a.time ?? "99").localeCompare(b.time ?? "99") ||
    a.title.localeCompare(b.title, "pt-BR")
  );
}

/** As abertas nos seis grupos, na ordem de urgência; grupo vazio não vem. */
export function agruparTarefas(tarefas: TaskItem[], hoje: string): GrupoDeTarefas[] {
  const grupos = new Map<ChaveDoGrupo, TaskItem[]>();
  for (const tarefa of tarefas) {
    const chave = grupoDe(tarefa, hoje);
    grupos.set(chave, [...(grupos.get(chave) ?? []), tarefa]);
  }
  return ORDEM.flatMap((chave) => {
    const lista = grupos.get(chave);
    return lista ? [{ chave, titulo: TITULO[chave], tarefas: lista.sort(comparar) }] : [];
  });
}

/**
 * O "quando" da tarefa dentro do grupo: em Hoje e Amanhã o dia já está no
 * título, e basta a hora; nos outros, o dia vem junto.
 */
export function quandoNoGrupo(tarefa: TaskItem, chave: ChaveDoGrupo): string {
  if (!tarefa.date) return "sem data";
  if (chave === "hoje" || chave === "amanha") return tarefa.time ?? "sem hora";
  return tarefa.time ? `${diaCurto(tarefa.date)} · ${tarefa.time}` : diaCurto(tarefa.date);
}
