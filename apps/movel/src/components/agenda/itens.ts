import {
  compararNoDia,
  horaDoEvento,
  ORDEM_DO_PRAZO,
  ordemDaTarefa,
  ordemDoEvento,
} from "@yu-book/cliente/hoje";
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

function novoResumo(): ResumoDoDia {
  return { eventos: 0, tarefas: 0, concluidas: 0, prazos: 0, itens: [] };
}

export function itemDeTarefa(tarefa: TaskItem, hora: string): ItemDoDia {
  return {
    tipo: "tarefa",
    id: `t-${tarefa.id}`,
    tarefa,
    hora,
    ordem: ordemDaTarefa(tarefa),
  };
}

export function itemDePrazo(card: AgendaCard): ItemDoDia {
  return {
    tipo: "prazo",
    id: `c-${card.id}`,
    card,
    hora: "até o fim do dia",
    ordem: ORDEM_DO_PRAZO,
  };
}

/** O evento fora da grade de um dia (listas de vários dias): hora já dita. */
export function itemDeEvento(evento: EventItem, hora: string): ItemDoDia {
  return { tipo: "evento", id: `e-${evento.id}`, evento, hora, ordem: evento.startsAt };
}

/**
 * Agrupa a resposta de `GET /agenda` por dia, na ordem do dia que o bloco
 * "Hoje" do web também segue (`compararNoDia`, em `@yu-book/cliente/hoje`): o
 * evento de dia inteiro primeiro, depois o que tem hora, pela hora, as tarefas
 * sem hora e por fim os prazos de card.
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
        ordem: ordemDoEvento(inicio),
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
    resumo.itens.sort((a, b) =>
      compararNoDia(
        { ordem: a.ordem, titulo: tituloDe(a) },
        { ordem: b.ordem, titulo: tituloDe(b) },
      ),
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
