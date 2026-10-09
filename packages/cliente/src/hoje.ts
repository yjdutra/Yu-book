// Valor de `shared`, contra a regra do pacote (só `import type`), e de
// propósito: a soma de dias é uma só no projeto (`somarDias`, contrato §4.5),
// e uma cópia aqui seria a segunda. O custo é o que ela arrasta — `agenda.ts`
// e `ia.ts` de `shared` —, e por isso este módulo é à parte de `agenda.ts`
// (que o web leva no chunk inicial): no web, só tela `lazy` o importa (o bloco
// "Hoje" do Início); o móvel pode levar valor.
import { somarDias } from "@yu-book/shared";
import type { EventItem, TaskItem } from "@yu-book/shared";
import { useState } from "react";
import { useAgenda } from "./agenda";

/**
 * O hoje do usuário e o que se mostra nele, nos dois fronts (frente de agenda;
 * subiu do móvel na Fase 6, quando o Início do web ganhou o bloco "Hoje").
 *
 * **O relógio do aparelho só escolhe janela** (INV-66): `diaDoAparelho` serve
 * para a primeira consulta sair antes de a API dizer qual é o hoje; nunca vira
 * dado nem "hoje" na tela.
 */

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * A data do aparelho, só para escolher a janela da primeira consulta da
 * agenda, antes de a API dizer qual é o hoje do usuário. Nunca vira dado nem
 * "hoje" na tela.
 */
export function diaDoAparelho(): string {
  const agora = new Date();
  const mes = doisDigitos(agora.getMonth() + 1);
  return `${agora.getFullYear()}-${mes}-${doisDigitos(agora.getDate())}`;
}

/**
 * A agenda de hoje até `dias` adiante, numa consulta, **sem esperar** saber o
 * hoje do usuário (INV-66). A janela parte da data do aparelho — a única coisa
 * que ela decide —, e a resposta traz o `today` de verdade. Quase sempre os
 * dois coincidem e acabou ali: nenhuma cascata de "primeiro o hoje, depois a
 * semana". Quando não coincidem (aparelho noutro fuso), uma segunda consulta,
 * já pela janela certa, toma o lugar da primeira.
 *
 * A data do aparelho é guardada na montagem, para a chave não mudar à
 * meia-noite no meio do uso.
 */
export function useAgendaAdiante(dias: number) {
  const [aparelho] = useState(diaDoAparelho);
  const primeira = useAgenda(aparelho, somarDias(aparelho, dias));
  const hoje = primeira.data?.today ?? null;
  const errada = hoje !== null && hoje !== aparelho;
  const certa = useAgenda(errada ? hoje : null, errada ? somarDias(hoje, dias) : null);
  return {
    hoje,
    fuso: primeira.data?.timezone ?? null,
    consulta: errada ? certa : primeira,
  };
}

/**
 * A hora de um evento **naquele dia**: "14:00–15:00" no dia em que começa e
 * acaba; nos de um evento que atravessa a meia-noite, a parte do dia
 * ("22:00–24:00", "00:00–01:00"), e "o dia todo" no meio. `inicio` é a hora
 * de começo no dia, para ordenar — vazia no dia inteiro, que vem primeiro.
 *
 * Os dias em que o evento aparece são os de `diasDoEvento` (contrato §4.8);
 * esta função só diz a hora num deles.
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

/*
 * A ordem dos itens num dia, a mesma no bloco "Hoje" do web e na agenda do
 * móvel: o evento de dia inteiro primeiro ("0"); depois o que tem hora, pela
 * hora, evento e tarefa misturados ("1HH:MM"); as tarefas sem hora — o que se
 * faz "em algum momento" do dia — ("2"); e por fim os prazos de card, que são
 * do quadro e só se leem ali ("3"). Empate, pelo título.
 */

/** A chave de ordem do evento no dia, pelo `inicio` de `horaDoEvento`. */
export function ordemDoEvento(inicio: string): string {
  return inicio ? `1${inicio}` : "0";
}

export function ordemDaTarefa(tarefa: Pick<TaskItem, "time">): string {
  return tarefa.time ? `1${tarefa.time}` : "2";
}

export const ORDEM_DO_PRAZO = "3";

/** Para `sort`: pela chave de ordem, e no empate pelo título. */
export function compararNoDia(
  a: { ordem: string; titulo: string },
  b: { ordem: string; titulo: string },
): number {
  return a.ordem.localeCompare(b.ordem) || a.titulo.localeCompare(b.titulo, "pt-BR");
}
