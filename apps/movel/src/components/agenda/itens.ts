import { diasDoEvento } from "@yu-book/shared";
import type { AgendaCard, AgendaRange, EventItem, TaskItem } from "@yu-book/shared";
import { diaCurto } from "../../lib/datas";

/**
 * O que a agenda mostra num dia, já ordenado. Os três tipos convivem e cada um
 * tem a própria regra de dia (INV-66): o evento aparece nos dias de
 * `diasDoEvento` — **nunca** de `date` a `endDate`, que poria o evento que
 * acaba às 00:00 num dia que a API desse dia não devolve (contrato §4.8) —; a
 * tarefa, no `date` civil dela; o prazo do card, no `date` que a API já
 * converteu pelo fuso do usuário.
 */
export type ItemDoDia =
  | { tipo: "evento"; id: string; evento: EventItem; hora: string; ordem: string }
  | { tipo: "tarefa"; id: string; tarefa: TaskItem; hora: string; ordem: string }
  | { tipo: "prazo"; id: string; card: AgendaCard; hora: string; ordem: string };

export interface ResumoDoDia {
  eventos: number;
  tarefas: number;
  concluidas: number;
  prazos: number;
  itens: ItemDoDia[];
}

/**
 * A hora de um evento **naquele dia**: "14:00–15:00" no dia em que começa e
 * acaba; nos de um evento que atravessa a meia-noite, a parte do dia
 * ("22:00–24:00", "00:00–01:00"), e "o dia todo" no meio.
 */
export function horaDoEvento(evento: EventItem, dia: string): { texto: string; inicio: string } {
  if (evento.allDay || !evento.startTime || !evento.endTime) {
    return { texto: "dia inteiro", inicio: "" };
  }
  const inicio = dia === evento.date ? evento.startTime : "00:00";
  const fim = dia === evento.endDate ? evento.endTime : "24:00";
  if (inicio === "00:00" && fim === "24:00") return { texto: "o dia todo", inicio: "" };
  return { texto: `${inicio}–${fim}`, inicio };
}

function novoResumo(): ResumoDoDia {
  return { eventos: 0, tarefas: 0, concluidas: 0, prazos: 0, itens: [] };
}

export function itemDeTarefa(tarefa: TaskItem, hora: string): ItemDoDia {
  return {
    tipo: "tarefa",
    id: `t-${tarefa.id}`,
    tarefa,
    hora,
    ordem: tarefa.time ? `1${tarefa.time}` : "2",
  };
}

export function itemDePrazo(card: AgendaCard): ItemDoDia {
  return { tipo: "prazo", id: `c-${card.id}`, card, hora: "até o fim do dia", ordem: "3" };
}

/** O evento fora da grade de um dia (listas de vários dias): hora já dita. */
export function itemDeEvento(evento: EventItem, hora: string): ItemDoDia {
  return { tipo: "evento", id: `e-${evento.id}`, evento, hora, ordem: evento.startsAt };
}

/**
 * Agrupa a resposta de `GET /agenda` por dia. A ordem: o evento de dia
 * inteiro primeiro, depois o que tem hora, pela hora, as tarefas sem hora — o
 * que se faz "em algum momento" do dia — e por fim os prazos de card, que são
 * do quadro e só se leem aqui.
 */
export function indexarPorDia(agenda: AgendaRange): Map<string, ResumoDoDia> {
  const porDia = new Map<string, ResumoDoDia>();
  const doDia = (dia: string) => {
    let resumo = porDia.get(dia);
    if (!resumo) {
      resumo = novoResumo();
      porDia.set(dia, resumo);
    }
    return resumo;
  };

  for (const evento of agenda.events) {
    for (const dia of diasDoEvento(evento)) {
      const { texto, inicio } = horaDoEvento(evento, dia);
      const resumo = doDia(dia);
      resumo.eventos += 1;
      resumo.itens.push({
        tipo: "evento",
        id: `e-${evento.id}`,
        evento,
        hora: texto,
        ordem: inicio ? `1${inicio}` : "0",
      });
    }
  }
  for (const tarefa of agenda.tasks) {
    if (!tarefa.date) continue;
    const resumo = doDia(tarefa.date);
    resumo.tarefas += 1;
    if (tarefa.completedAt) resumo.concluidas += 1;
    resumo.itens.push(itemDeTarefa(tarefa, tarefa.time ?? "sem hora"));
  }
  for (const card of agenda.cards) {
    const resumo = doDia(card.date);
    resumo.prazos += 1;
    resumo.itens.push(itemDePrazo(card));
  }

  for (const resumo of porDia.values()) {
    resumo.itens.sort(
      (a, b) => a.ordem.localeCompare(b.ordem) || tituloDe(a).localeCompare(tituloDe(b), "pt-BR"),
    );
  }
  return porDia;
}

export function tituloDe(item: ItemDoDia): string {
  if (item.tipo === "evento") return item.evento.title;
  if (item.tipo === "tarefa") return item.tarefa.title;
  return item.card.title;
}

/** A hora de início de um item com hora no dia (`HH:MM`), ou `null`. */
export function inicioDe(item: ItemDoDia): string | null {
  return item.ordem.startsWith("1") ? item.ordem.slice(1, 6) : null;
}

/**
 * O quando de um evento fora da grade (listas de vários dias): "ter, 13 de
 * out · 10:30–11:15", "sáb, 12 de out · dia inteiro", "ter, 20 de out · 22:00
 * até qua, 06:00".
 */
export function quandoDoEvento(evento: EventItem): string {
  const inicio = diaCurto(evento.date);
  if (evento.allDay) {
    return evento.endDate === evento.date
      ? `${inicio} · dia inteiro`
      : `${inicio} a ${diaCurto(evento.endDate)}`;
  }
  const mesmoDia = diasDoEvento(evento).length === 1;
  return mesmoDia
    ? `${inicio} · ${evento.startTime}–${evento.endTime}`
    : `${inicio} · ${evento.startTime} até ${diaCurto(evento.endDate)}, ${evento.endTime}`;
}
