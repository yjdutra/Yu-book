import type { Prisma } from "@prisma/client";
import type {
  AgendaQuery,
  AgendaRange,
  EventInput,
  EventItem,
  EventUpdateInput,
  FieldIssue,
  HorarioDoEvento,
  PedidoDeHorario,
} from "@yu-book/shared";
import {
  MAX_DIAS_DO_EVENTO,
  diaLocal,
  horaLocal,
  instanteLocal,
  mesclarHorario,
  resolverHorario,
  somarDias,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { CAMPOS_DA_MARCA, camposDaOrigem, paraMarca } from "../../lib/marca.js";
import type { OrigemIA } from "../../lib/marca.js";
import { preferenciaDe } from "../assistente/preferencias.service.js";
import { CAMPOS_PRAZO, toPrazo } from "../dashboard/dashboard.service.js";
import {
  conferirQuadro,
  quadroQueSumiu,
  tarefasAtrasadas,
  tarefasDoPeriodo,
} from "../tarefas/tarefas.service.js";

/**
 * Eventos da agenda — frente de agenda, Fase 1.
 *
 * **O cliente não converte fuso.** Entra dia e hora locais, sai dia e hora
 * locais, e no meio o banco guarda instante UTC (`starts_at`/`ends_at`). A
 * conversão é sempre pelo fuso do usuário (`preferenciaDe(...).timezone`), por
 * `instanteLocal` na ida e `diaLocal`/`horaLocal` na volta — nunca pelo fuso do
 * processo, que em produção é UTC, nem pelo do navegador (§4.5 do contrato).
 *
 * Posse direta por `user_id` (INV-01, INV-02), escrita condicional (INV-04),
 * quadro conferido contra o usuário (INV-59).
 */

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

const DIA_MS = 24 * 60 * 60_000;

const CAMPOS_EVENTO = {
  id: true,
  title: true,
  description: true,
  allDay: true,
  startsAt: true,
  endsAt: true,
  location: true,
  url: true,
  createdAt: true,
  updatedAt: true,
  board: { select: { id: true, name: true } },
  ...CAMPOS_DA_MARCA,
} satisfies Prisma.EventSelect;

type LinhaEvento = Prisma.EventGetPayload<{ select: typeof CAMPOS_EVENTO }>;

/**
 * O horário gravado, lido no fuso do usuário. Dia inteiro termina na meia-noite
 * **seguinte** ao último dia, então o último dia é o de `endsAt` menos um.
 *
 * Mudar o fuso em `/ajustes` move o evento com hora no relógio — é o mesmo
 * instante, visto de outro lugar, e é o certo. O dia inteiro também se lê pelo
 * fuso atual: gravado em São Paulo e lido muito a oeste, pode recuar um dia.
 */
function horarioDe(linha: Pick<LinhaEvento, "allDay" | "startsAt" | "endsAt">, fuso: string) {
  const date = diaLocal(linha.startsAt, fuso);
  if (linha.allDay) {
    const endDate = somarDias(diaLocal(linha.endsAt, fuso), -1);
    return {
      allDay: true,
      date,
      endDate: endDate < date ? date : endDate,
      startTime: null,
      endTime: null,
    } satisfies HorarioDoEvento;
  }
  return {
    allDay: false,
    date,
    endDate: diaLocal(linha.endsAt, fuso),
    startTime: horaLocal(linha.startsAt, fuso),
    endTime: horaLocal(linha.endsAt, fuso),
  } satisfies HorarioDoEvento;
}

function paraEvento(linha: LinhaEvento, fuso: string): EventItem {
  return {
    id: linha.id,
    title: linha.title,
    description: linha.description ?? "",
    ...horarioDe(linha, fuso),
    startsAt: linha.startsAt.toISOString(),
    endsAt: linha.endsAt.toISOString(),
    location: linha.location,
    url: linha.url,
    board: linha.board,
    ai: paraMarca(linha),
    createdAt: linha.createdAt.toISOString(),
    updatedAt: linha.updatedAt.toISOString(),
  };
}

/** A primeira queixa vira a mensagem do 422 — o formato de erro tem uma só. */
function recusar(problemas: FieldIssue[]): never {
  throw invalido(problemas[0]?.message ?? "Horário inválido");
}

/**
 * Completa o horário pedido e o converte em instantes no fuso do usuário. É o
 * único caminho de escrita de `starts_at`/`ends_at`, na criação e no PATCH.
 */
function instantesDe(pedido: PedidoDeHorario, fuso: string) {
  const { horario, problemas } = resolverHorario(pedido);
  if (!horario) recusar(problemas);

  let startsAt: Date;
  let endsAt: Date;
  try {
    if (horario.allDay) {
      startsAt = instanteLocal(horario.date, "00:00", fuso);
      endsAt = instanteLocal(somarDias(horario.endDate, 1), "00:00", fuso);
    } else {
      startsAt = instanteLocal(horario.date, horario.startTime ?? "00:00", fuso);
      endsAt = instanteLocal(horario.endDate, horario.endTime ?? "00:00", fuso);
    }
  } catch (erro) {
    // `instanteLocal` lança `RangeError` para dia ou hora que não existem.
    if (erro instanceof RangeError) throw invalido("Data ou hora inexistente");
    throw erro;
  }
  // Uma virada de horário de verão pode engolir um evento curto: a hora que
  // não existe vira a primeira que existe, e o fim pode encostar no início.
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw invalido("O fim precisa ser depois do início");
  }
  return { allDay: horario.allDay, startsAt, endsAt };
}

/// Vazio apaga o campo: `null` no banco, não string vazia.
const limpo = (texto: string | null | undefined) => texto?.trim() || null;

/**
 * Os eventos que **se sobrepõem** ao período — começam antes do fim dele e
 * terminam depois do início —, para que o evento que atravessa a borda
 * apareça nos dois lados. Os dias são do usuário: a janela vai da meia-noite
 * local de `de` à do dia seguinte a `ate`.
 */
async function eventosNoPeriodo(userId: string, de: string, ate: string, fuso: string) {
  const inicio = instanteLocal(de, "00:00", fuso);
  const fim = instanteLocal(somarDias(ate, 1), "00:00", fuso);
  // Nenhum evento dura mais que `MAX_DIAS_DO_EVENTO`, então o que se sobrepõe
  // à janela começou no máximo isso antes dela. O piso em `startsAt` deixa o
  // índice `(user_id, starts_at)` cortar dos dois lados — sem ele, a consulta
  // leria todo evento do passado da conta para filtrar por `endsAt`. Um dia de
  // folga cobre a virada de horário de verão.
  const piso = new Date(inicio.getTime() - (MAX_DIAS_DO_EVENTO + 1) * DIA_MS);
  const linhas = await prisma.event.findMany({
    where: { userId, startsAt: { gte: piso, lt: fim }, endsAt: { gt: inicio } },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    select: CAMPOS_EVENTO,
  });
  return linhas.map((linha) => paraEvento(linha, fuso));
}

export async function listarEventos(userId: string, query: AgendaQuery): Promise<EventItem[]> {
  const { timezone } = await preferenciaDe(userId);
  return eventosNoPeriodo(userId, query.from, query.to, timezone);
}

export async function buscarEvento(userId: string, id: string): Promise<EventItem> {
  const [linha, { timezone }] = await Promise.all([
    prisma.event.findFirst({ where: { id, userId }, select: CAMPOS_EVENTO }),
    preferenciaDe(userId),
  ]);
  if (!linha) throw notFound("Evento não encontrado");
  return paraEvento(linha, timezone);
}

/**
 * `origem` é a marca de IA (INV-58): o chat a monta da conversa, a rota a
 * traduz do `origin` do MCP. Nunca vem do corpo como campo do evento.
 */
export async function criarEvento(
  userId: string,
  input: Omit<EventInput, "origin">,
  origem?: OrigemIA,
): Promise<EventItem> {
  const { timezone } = await preferenciaDe(userId);
  // O schema já confere o horário; o service confere de novo porque o chat
  // (Fase 2 da frente de agenda) chama daqui com argumentos que o modelo escreveu.
  const horario = instantesDe(
    {
      allDay: input.allDay ?? false,
      date: input.date,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
    },
    timezone,
  );
  if (input.boardId) await conferirQuadro(userId, input.boardId);

  const { id } = await prisma.event
    .create({
      data: {
        userId,
        title: input.title.trim(),
        description: input.description ?? "",
        ...horario,
        location: limpo(input.location),
        url: limpo(input.url),
        boardId: input.boardId ?? null,
        ...camposDaOrigem(origem),
      },
      select: { id: true },
    })
    .catch(quadroQueSumiu);
  return buscarEvento(userId, id);
}

export async function atualizarEvento(
  userId: string,
  id: string,
  input: EventUpdateInput,
): Promise<EventItem> {
  const atual = await prisma.event.findFirst({ where: { id, userId }, select: CAMPOS_EVENTO });
  if (!atual) throw notFound("Evento não encontrado");
  if (input.boardId) await conferirQuadro(userId, input.boardId);

  // Só recalcula os instantes se o PATCH tocou no horário: trocar o título não
  // pode reescrever `starts_at` pelo fuso de agora.
  const tocouHorario =
    input.allDay !== undefined ||
    input.date !== undefined ||
    input.endDate !== undefined ||
    input.startTime !== undefined ||
    input.endTime !== undefined;
  let horario: ReturnType<typeof instantesDe> | null = null;
  if (tocouHorario) {
    const { timezone } = await preferenciaDe(userId);
    // A regra cruzada sobre o valor **mesclado** — o schema parcial não o vê.
    horario = instantesDe(mesclarHorario(horarioDe(atual, timezone), input), timezone);
  }

  // Mesma regra de revisão de card e nota (INV-58): só o texto, e só se mudou.
  const revisou =
    atual.aiGeneratedAt !== null &&
    ((input.title !== undefined && input.title.trim() !== atual.title) ||
      (input.description !== undefined && input.description !== (atual.description ?? "")));

  const { count } = await prisma.event
    .updateMany({
      where: { id, userId },
      data: {
        ...(input.title !== undefined && { title: input.title.trim() }),
        ...(input.description !== undefined && { description: input.description }),
        ...(horario ?? {}),
        ...(input.location !== undefined && { location: limpo(input.location) }),
        ...(input.url !== undefined && { url: limpo(input.url) }),
        ...(input.boardId !== undefined && { boardId: input.boardId }),
        ...(revisou && { aiRevisedAt: new Date() }),
      },
    })
    .catch(quadroQueSumiu);
  if (count === 0) throw notFound("Evento não encontrado");
  return buscarEvento(userId, id);
}

export async function excluirEvento(userId: string, id: string): Promise<void> {
  const { count } = await prisma.event.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Evento não encontrado");
}

/* ------------------------------------------------------------- agenda */

/**
 * Tudo o que a agenda desenha num período, numa requisição: eventos que se
 * sobrepõem a ele, tarefas com data nele, as atrasadas de antes dele (as de
 * dentro já estão nas tarefas do período, marcadas `overdue`) e os cards com
 * prazo.
 *
 * O card entra pelo **dia local do prazo**, não pelo instante: a janela vai da
 * meia-noite local de `from` à do dia seguinte a `to`, e o prazo gravado às
 * 23:59:59 do fuso cai no dia certo — `.slice(0, 10)` do ISO o poria um dia à
 * frente em UTC−3 (§4.5 do contrato). Concluído e arquivado ficam de fora:
 * não cobram prazo (INV-63, "concluído sai de quem cobra").
 */
export async function agendaDoPeriodo(userId: string, query: AgendaQuery): Promise<AgendaRange> {
  const { timezone } = await preferenciaDe(userId);
  const hoje = diaLocal(new Date(), timezone);
  const inicio = instanteLocal(query.from, "00:00", timezone);
  const fim = instanteLocal(somarDias(query.to, 1), "00:00", timezone);

  const [events, tasks, overdueTasks, cards] = await Promise.all([
    eventosNoPeriodo(userId, query.from, query.to, timezone),
    tarefasDoPeriodo(userId, query.from, query.to, hoje),
    // Só as anteriores ao período: as de dentro já vêm em `tasks`.
    tarefasAtrasadas(userId, hoje, query.from < hoje ? query.from : hoje),
    prisma.card.findMany({
      where: {
        archived: false,
        completedAt: null,
        dueDate: { gte: inicio, lt: fim },
        column: { board: { userId } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: CAMPOS_PRAZO,
    }),
  ]);

  return {
    timezone,
    today: hoje,
    from: query.from,
    to: query.to,
    events,
    tasks,
    overdueTasks,
    cards: cards.map((card) => ({
      ...toPrazo(card),
      // Só entram cards com prazo no período, então a data existe.
      date: diaLocal(card.dueDate as Date, timezone),
    })),
  };
}
