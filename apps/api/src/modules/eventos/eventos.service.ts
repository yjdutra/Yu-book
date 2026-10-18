import type { Prisma } from "@prisma/client";
import type {
  AgendaQuery,
  AgendaRange,
  ConversionScope,
  EventInput,
  EventItem,
  EventRecurrence,
  EventScope,
  EventToTaskInput,
  EventUpdateInput,
  FieldIssue,
  HorarioDoEvento,
  OcorrenciaDoEvento,
  PedidoDeHorario,
  PedidoDeRepeticao,
  SerieDoEvento,
  TaskItem,
  TaskToEventInput,
} from "@yu-book/shared";
import {
  MAX_DIAS_DO_EVENTO,
  MAX_TAREFA_DESCRICAO,
  diaDaSemana,
  diaLocal,
  horarioNoFuso,
  instanteLocal,
  mesclarHorario,
  ocorrenciaDoDia,
  ocorrenciasNoPeriodo,
  primeiraOcorrenciaViva,
  resolverSerie,
  restaOcorrencia,
  somarDias,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { CAMPOS_DA_MARCA, camposDaOrigem, copiaDaMarca, paraMarca } from "../../lib/marca.js";
import type { OrigemIA } from "../../lib/marca.js";
import { preferenciaDe } from "../assistente/preferencias.service.js";
import { CAMPOS_PRAZO, toPrazo } from "../dashboard/dashboard.service.js";
import { CAMPOS_DO_VINCULO, conferirAtividade, paraVinculo } from "../habitos/vinculo.service.js";
import {
  buscarTarefa,
  colunasDoQuando,
  conferirQuadro,
  gravarSerie,
  semDiaNoHorizonte,
  soltarDaSerie,
  quadroQueSumiu,
  tarefasAtrasadas,
  tarefasDoPeriodo,
  tarefasSemData,
} from "../tarefas/tarefas.service.js";

/**
 * Eventos da agenda — frente de agenda, Fase 1.
 *
 * **O cliente não converte fuso.** Entra dia e hora locais, sai dia e hora
 * locais, e no meio o banco guarda instante UTC (`starts_at`/`ends_at`). A
 * conversão é sempre pelo fuso do usuário (`preferenciaDe(...).timezone`), por
 * `instanteLocal` na ida e `horarioNoFuso` na volta — nunca pelo fuso do
 * processo, que em produção é UTC, nem pelo do navegador (§4.5 do contrato).
 *
 * Posse direta por `user_id` (INV-01, INV-02), escrita condicional (INV-04),
 * quadro conferido contra o usuário (INV-59).
 *
 * **Séries** (frente de eventos recorrentes, R1): uma linha com a regra
 * (`repeat_days`, `repeat_until`, `exdates`), em que `starts_at`/`ends_at` são
 * a primeira ocorrência. A leitura por período expande as ocorrências
 * (`ocorrenciasNoPeriodo`, de `shared`); PATCH e DELETE recebem o escopo —
 * `esta`, `seguintes` ou `todas` — e o dia da ocorrência.
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
  repeatDays: true,
  repeatUntil: true,
  exdates: true,
  location: true,
  url: true,
  createdAt: true,
  updatedAt: true,
  board: { select: { id: true, name: true } },
  habitActivity: CAMPOS_DO_VINCULO,
  ...CAMPOS_DA_MARCA,
} satisfies Prisma.EventSelect;

type LinhaEvento = Prisma.EventGetPayload<{ select: typeof CAMPOS_EVENTO }>;

/// O que um escopo copia da série para o avulso ou a série nova, além do
/// que a resposta mostra: vínculos que nenhuma rota edita hoje, mas existem.
const CAMPOS_DA_COPIA = {
  ...CAMPOS_EVENTO,
  workspaceId: true,
  noteId: true,
  cardId: true,
} satisfies Prisma.EventSelect;

type LinhaDaCopia = Prisma.EventGetPayload<{ select: typeof CAMPOS_DA_COPIA }>;

/// `DATE` chega do Prisma como meia-noite UTC: o corte do ISO é o dia civil,
/// como em `task.date` (INV-66). Passá-lo por fuso o recuaria a oeste de UTC.
const paraDiaCivil = (data: Date) => data.toISOString().slice(0, 10);
const deDiaCivil = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

function regraDe(linha: Pick<LinhaEvento, "repeatDays" | "repeatUntil">): EventRecurrence | null {
  if (linha.repeatDays.length === 0) return null;
  return {
    days: [...linha.repeatDays].sort((a, b) => a - b),
    until: linha.repeatUntil ? paraDiaCivil(linha.repeatUntil) : null,
  };
}

type LinhaDaSerie = Pick<
  LinhaEvento,
  "allDay" | "startsAt" | "endsAt" | "repeatDays" | "repeatUntil" | "exdates"
>;

function serieDe(linha: LinhaDaSerie, recurrence: EventRecurrence): SerieDoEvento {
  return {
    allDay: linha.allDay,
    startsAt: linha.startsAt,
    endsAt: linha.endsAt,
    recurrence,
    exdates: linha.exdates.map(paraDiaCivil),
  };
}

/**
 * A linha como a resposta a mostra. Sem `ocorrencia`, o horário é o gravado —
 * o evento simples, ou a série pela primeira ocorrência (`GET /events/:id`).
 */
function paraEvento(linha: LinhaEvento, fuso: string, ocorrencia?: OcorrenciaDoEvento): EventItem {
  const horario = ocorrencia ?? {
    ...horarioNoFuso(linha, fuso),
    startsAt: linha.startsAt,
    endsAt: linha.endsAt,
  };
  return {
    id: linha.id,
    title: linha.title,
    description: linha.description ?? "",
    allDay: horario.allDay,
    date: horario.date,
    endDate: horario.endDate,
    startTime: horario.startTime,
    endTime: horario.endTime,
    startsAt: horario.startsAt.toISOString(),
    endsAt: horario.endsAt.toISOString(),
    occurrenceDate: ocorrencia?.occurrenceDate ?? horario.date,
    recurrence: regraDe(linha),
    location: linha.location,
    url: linha.url,
    board: linha.board,
    habitActivity: paraVinculo(linha.habitActivity),
    ai: paraMarca(linha),
    createdAt: linha.createdAt.toISOString(),
    updatedAt: linha.updatedAt.toISOString(),
  };
}

/** A primeira queixa vira a mensagem do 422 — o formato de erro tem uma só. */
function recusar(problemas: FieldIssue[]): never {
  throw invalido(problemas[0]?.message ?? "Horário inválido");
}

/** Horário e repetição completos e conferidos (`resolverSerie`), ou 422. */
function resolverOuRecusar(
  pedido: PedidoDeHorario,
  repeticao: PedidoDeRepeticao | null | undefined,
): { horario: HorarioDoEvento; recurrence: EventRecurrence | null } {
  const { horario, recurrence, problemas } = resolverSerie(pedido, repeticao);
  if (!horario) recusar(problemas);
  return { horario, recurrence };
}

/**
 * Converte o horário já resolvido em instantes no fuso do usuário. É o único
 * caminho de escrita de `starts_at`/`ends_at` — na criação, no PATCH e no
 * avulso ou série nova que um escopo cria.
 */
function instantesDe(horario: HorarioDoEvento, fuso: string) {
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

/** As colunas da regra; `null` grava o evento simples. */
function colunasDaRegra(recurrence: EventRecurrence | null) {
  return {
    repeatDays: recurrence?.days ?? [],
    repeatUntil: recurrence?.until ? deDiaCivil(recurrence.until) : null,
  };
}

/// Vazio apaga o campo: `null` no banco, não string vazia.
const limpo = (texto: string | null | undefined) => texto?.trim() || null;

/**
 * Os eventos que **se sobrepõem** ao período — começam antes do fim dele e
 * terminam depois do início —, para que o evento que atravessa a borda
 * apareça nos dois lados. Os dias são do usuário: a janela vai da meia-noite
 * local de `de` à do dia seguinte a `ate`.
 *
 * Duas consultas: o evento simples pela sobreposição dos instantes gravados, e
 * a série, expandida em ocorrências na memória. A primeira ocorrência de uma
 * série também se sobrepõe pelos instantes gravados — por isso o simples se
 * pede com `repeat_days` vazio, ou ela sairia duas vezes.
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
  const [simples, series] = await Promise.all([
    prisma.event.findMany({
      where: {
        userId,
        repeatDays: { isEmpty: true },
        startsAt: { gte: piso, lt: fim },
        endsAt: { gt: inicio },
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      select: CAMPOS_EVENTO,
    }),
    seriesNoPeriodo(userId, de, fim),
  ]);

  const eventos = simples.map((linha) => paraEvento(linha, fuso));
  for (const linha of series) {
    const recurrence = regraDe(linha);
    if (!recurrence) continue;
    for (const ocorrencia of ocorrenciasNoPeriodo(serieDe(linha, recurrence), de, ate, fuso)) {
      eventos.push(paraEvento(linha, fuso, ocorrencia));
    }
  }
  // ISO de `toISOString` ordena como texto.
  return eventos.sort((a, b) =>
    a.startsAt !== b.startsAt
      ? a.startsAt < b.startsAt
        ? -1
        : 1
      : a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : 0,
  );
}

/**
 * As séries que podem ter ocorrência no período: começaram antes do fim dele e
 * não acabaram antes do início. A série não tem piso em `starts_at` — a de
 * janeiro ainda aparece em outubro —, e quem a acha é o índice parcial
 * `event_serie_idx` (só as séries; migration `20261010120000_eventos_recorrentes`),
 * cujo predicado é o que o Prisma emite para `isEmpty: false`.
 *
 * `repeat_until` é o dia da última ocorrência, que pode atravessar a
 * meia-noite e aparecer no dia seguinte: daí o dia de folga antes de `de`.
 */
function seriesNoPeriodo(userId: string, de: string, fim: Date) {
  return prisma.event.findMany({
    where: {
      userId,
      repeatDays: { isEmpty: false },
      startsAt: { lt: fim },
      OR: [{ repeatUntil: null }, { repeatUntil: { gte: deDiaCivil(somarDias(de, -1)) } }],
    },
    select: CAMPOS_EVENTO,
  });
}

export async function listarEventos(userId: string, query: AgendaQuery): Promise<EventItem[]> {
  const { timezone } = await preferenciaDe(userId);
  return eventosNoPeriodo(userId, query.from, query.to, timezone);
}

/**
 * A série vem inteira, pela **primeira ocorrência viva**: a gravada, salvo se
 * foi cancelada ("excluir só esta" na primeira) — então a seguinte. Mostrar a
 * cancelada daria à tela um `occurrenceDate` que PATCH e DELETE recusam com
 * 404. Série sem ocorrência viva não deveria existir (quem a esvazia a apaga,
 * `tirarDaSerie`); se existir, é 404 como inexistente.
 */
export async function buscarEvento(userId: string, id: string): Promise<EventItem> {
  const [linha, { timezone }] = await Promise.all([
    prisma.event.findFirst({ where: { id, userId }, select: CAMPOS_EVENTO }),
    preferenciaDe(userId),
  ]);
  if (!linha) throw notFound("Evento não encontrado");
  const recurrence = regraDe(linha);
  if (!recurrence) return paraEvento(linha, timezone);
  const primeira = primeiraOcorrenciaViva(serieDe(linha, recurrence), timezone);
  if (!primeira) throw notFound("Evento não encontrado");
  return paraEvento(linha, timezone, primeira);
}

/**
 * `origem` é a marca de IA (INV-58): o chat a monta da conversa, a rota a
 * traduz do `origin` do MCP. Nunca vem do corpo como campo do evento.
 *
 * Com `repeat`, o `starts_at` gravado é o da primeira ocorrência — a primeira
 * data de `date` em diante que cai num dos dias escolhidos (`resolverSerie`).
 */
export async function criarEvento(
  userId: string,
  input: Omit<EventInput, "origin">,
  origem?: OrigemIA,
): Promise<EventItem> {
  const { timezone } = await preferenciaDe(userId);
  // O schema já confere o horário; o service confere de novo porque o chat
  // (Fase 2 da frente de agenda) chama daqui com argumentos que o modelo escreveu.
  const { horario, recurrence } = resolverOuRecusar(
    {
      allDay: input.allDay ?? false,
      date: input.date,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
    },
    input.repeat,
  );
  const instantes = instantesDe(horario, timezone);
  if (input.boardId) await conferirQuadro(userId, input.boardId);
  if (input.habitActivityId) await conferirAtividade(userId, input.habitActivityId);

  const { id } = await prisma.event
    .create({
      data: {
        userId,
        title: input.title.trim(),
        description: input.description ?? "",
        ...instantes,
        ...colunasDaRegra(recurrence),
        location: limpo(input.location),
        url: limpo(input.url),
        boardId: input.boardId ?? null,
        habitActivityId: input.habitActivityId ?? null,
        ...camposDaOrigem(origem),
      },
      select: { id: true },
    })
    .catch(quadroQueSumiu);
  return buscarEvento(userId, id);
}

/// Só o texto, e só se mudou — a mesma regra de revisão de card e nota (INV-58).
function revisouTexto(atual: LinhaEvento, input: EventUpdateInput): boolean {
  return (
    atual.aiGeneratedAt !== null &&
    ((input.title !== undefined && input.title.trim() !== atual.title) ||
      (input.description !== undefined && input.description !== (atual.description ?? "")))
  );
}

const tocouHorario = (input: EventUpdateInput) =>
  input.allDay !== undefined ||
  input.date !== undefined ||
  input.endDate !== undefined ||
  input.startTime !== undefined ||
  input.endTime !== undefined;

/**
 * A condição de "a ocorrência `dia` ainda existe" que cabe no `where`: o dia da
 * semana está na regra, não foi cancelado e não passou do fim. É ela que faz
 * a escrita condicional (INV-04) — o dia ter sido cancelado ou a série
 * encerrada entre a leitura e a escrita dá `count === 0`. O "não antes da
 * primeira" depende do fuso e fica na leitura (`ocorrenciaDoDia`).
 */
function ocorrenciaViva(id: string, userId: string, dia: string) {
  return {
    id,
    userId,
    repeatDays: { has: diaDaSemana(dia) },
    NOT: { exdates: { has: deDiaCivil(dia) } },
    OR: [{ repeatUntil: null }, { repeatUntil: { gte: deDiaCivil(dia) } }],
  } satisfies Prisma.EventWhereInput;
}

const ocorrenciaNaoEncontrada = () => notFound("Ocorrência não encontrada");

/** Uma série tocada por `esta` ou `seguintes`, com a ocorrência conferida. */
interface OcorrenciaTocada<L extends LinhaDaSerie> {
  linha: L;
  serie: SerieDoEvento;
  ocorrencia: OcorrenciaDoEvento;
  /// O dia da primeira ocorrência gravada, no fuso.
  primeiroDia: string;
}

/**
 * Confere a ocorrência que o escopo `esta`/`seguintes` toca. `null` quando o
 * escopo não se aplica — evento simples, ou `todas` —, e quem chama segue pela
 * série inteira.
 */
function ocorrenciaTocada<L extends LinhaDaSerie>(
  linha: L,
  escopo: EventScope,
  fuso: string,
): OcorrenciaTocada<L> | null {
  const recurrence = regraDe(linha);
  if (!recurrence || escopo.scope === "todas") return null;
  if (!escopo.occurrenceDate) {
    throw invalido("Diga qual ocorrência da série (occurrenceDate)");
  }
  const serie = serieDe(linha, recurrence);
  const ocorrencia = ocorrenciaDoDia(serie, escopo.occurrenceDate, fuso);
  if (!ocorrencia) throw ocorrenciaNaoEncontrada();
  return { linha, serie, ocorrencia, primeiroDia: horarioNoFuso(linha, fuso).date };
}

/**
 * `escopo` só conta numa série (`EventScope`): `todas` (o padrão) altera a
 * série inteira; `esta` cancela a ocorrência e cria um evento avulso com os
 * dados novos; `seguintes` encerra a série na véspera da ocorrência e cria uma
 * série nova a partir dela. Devolve o evento que ficou com os dados novos — a
 * série, o avulso ou a série nova, que têm `id` próprio.
 */
export async function atualizarEvento(
  userId: string,
  id: string,
  input: EventUpdateInput,
  escopo: EventScope,
): Promise<EventItem> {
  const atual = await prisma.event.findFirst({ where: { id, userId }, select: CAMPOS_DA_COPIA });
  if (!atual) throw notFound("Evento não encontrado");
  if (input.boardId) await conferirQuadro(userId, input.boardId);
  if (input.habitActivityId) await conferirAtividade(userId, input.habitActivityId);

  const precisaDoFuso =
    tocouHorario(input) || input.repeat !== undefined || escopo.scope !== "todas";
  const timezone = precisaDoFuso ? (await preferenciaDe(userId)).timezone : null;
  const tocada = timezone ? ocorrenciaTocada(atual, escopo, timezone) : null;

  if (tocada && timezone) {
    // "Seguintes" a partir da primeira é a série inteira.
    const daPrimeira = tocada.ocorrencia.occurrenceDate === tocada.primeiroDia;
    if (escopo.scope === "esta") return atualizarEsta(userId, tocada, input, timezone);
    if (!daPrimeira) return atualizarSeguintes(userId, tocada, input, timezone);
  }
  return atualizarTodas(userId, atual, input, timezone);
}

/// Duas escritas concorrentes na mesma série, duas vezes seguidas: não há
/// código de conflito em `ERROR_CODES`, e o 409 com `VALIDATION_ERROR` tem
/// precedente (`execucao.service.ts`, execução interrompida).
const mudouDuranteAEdicao = () =>
  new AppError(409, "VALIDATION_ERROR", "O evento mudou enquanto era editado. Tente de novo.");

/**
 * A série inteira, ou o evento simples.
 *
 * Quando o PATCH toca horário ou regra, as colunas da série (`repeat_days`,
 * `repeat_until`, `exdates`) são regravadas **a partir da leitura** — e um
 * "excluir só esta" ou um "seguintes" gravado no meio sumiria calado. Daí a
 * mesma guarda de `updatedAt` de `tirarDaSerie` (INV-04). Com `count === 0`,
 * relê e **repete uma vez** sobre o valor novo: a corrida é rara numa conta de
 * um usuário só, e repetir dá o resultado que ele pediu sobre o estado de
 * agora; uma segunda corrida seguida vira 409. Só o texto não deriva da
 * leitura e segue sem guarda, como antes da série.
 */
async function atualizarTodas(
  userId: string,
  lida: LinhaEvento,
  input: EventUpdateInput,
  timezone: string | null,
): Promise<EventItem> {
  let atual = lida;
  for (let tentativa = 1; ; tentativa += 1) {
    const horario = timezone ? horarioDaSerieInteira(atual, input, timezone) : null;
    const { count } = await prisma.event
      .updateMany({
        where: { id: atual.id, userId, ...(horario && { updatedAt: atual.updatedAt }) },
        data: {
          ...(input.title !== undefined && { title: input.title.trim() }),
          ...(input.description !== undefined && { description: input.description }),
          ...(horario ?? {}),
          ...(input.location !== undefined && { location: limpo(input.location) }),
          ...(input.url !== undefined && { url: limpo(input.url) }),
          ...(input.boardId !== undefined && { boardId: input.boardId }),
          ...(input.habitActivityId !== undefined && { habitActivityId: input.habitActivityId }),
          ...(revisouTexto(atual, input) && { aiRevisedAt: new Date() }),
        },
      })
      .catch(quadroQueSumiu);
    if (count > 0) return buscarEvento(userId, atual.id);
    if (!horario) throw notFound("Evento não encontrado");

    const relida = await prisma.event.findFirst({
      where: { id: atual.id, userId },
      select: CAMPOS_EVENTO,
    });
    if (!relida) throw notFound("Evento não encontrado");
    if (tentativa >= 2) throw mudouDuranteAEdicao();
    atual = relida;
  }
}

/**
 * As colunas de horário e regra que um PATCH `todas` grava, ou `null` se ele
 * não tocou em nenhum dos dois: trocar o título não pode reescrever
 * `starts_at` pelo fuso de agora (INV-66).
 *
 * A regra cruzada roda sobre o valor **mesclado** — o schema parcial não o
 * vê. Numa série, `date` é o início dela: mudar a hora move todas as
 * ocorrências, e mudar o dia recomeça a série dali. Os cancelamentos ficam; a
 * regra nova que só cairia em dias cancelados é recusada, porque a série
 * gravada não apareceria em lugar nenhum.
 */
function horarioDaSerieInteira(
  atual: LinhaEvento,
  input: EventUpdateInput,
  timezone: string,
): Prisma.EventUpdateManyMutationInput | null {
  if (!tocouHorario(input) && input.repeat === undefined) return null;
  const resolvido = resolverOuRecusar(
    mesclarHorario(horarioNoFuso(atual, timezone), input),
    input.repeat !== undefined ? input.repeat : regraDe(atual),
  );
  const instantes = instantesDe(resolvido.horario, timezone);
  if (resolvido.recurrence) {
    const serie = serieDe({ ...atual, ...instantes }, resolvido.recurrence);
    if (!restaOcorrencia(serie, timezone)) {
      throw invalido("Todas as ocorrências dessa repetição estão canceladas");
    }
  }
  return {
    ...instantes,
    ...colunasDaRegra(resolvido.recurrence),
    // Virou evento simples: os cancelamentos não querem dizer mais nada.
    ...(resolvido.recurrence === null && { exdates: [] }),
  };
}

/**
 * O que o avulso ou a série nova herdam da série, com o PATCH por cima.
 *
 * **A marca de IA é herdada** (INV-58): a ocorrência que a IA criou continua
 * gerada por IA depois de remarcada, e a marca nunca some. `aiRevisedAt` segue
 * a regra de sempre — só preenche se o PATCH mudou de fato o título ou a
 * descrição; mover uma ocorrência não é revisão, como mover um card não é.
 */
function copiaDaSerie(atual: LinhaDaCopia, input: EventUpdateInput) {
  return {
    title: input.title !== undefined ? input.title.trim() : atual.title,
    description: input.description !== undefined ? input.description : (atual.description ?? ""),
    location: input.location !== undefined ? limpo(input.location) : atual.location,
    url: input.url !== undefined ? limpo(input.url) : atual.url,
    boardId: input.boardId !== undefined ? input.boardId : (atual.board?.id ?? null),
    habitActivityId:
      input.habitActivityId !== undefined
        ? input.habitActivityId
        : (atual.habitActivity?.id ?? null),
    workspaceId: atual.workspaceId,
    noteId: atual.noteId,
    cardId: atual.cardId,
    aiGeneratedAt: atual.aiGeneratedAt,
    aiVia: atual.aiVia,
    aiAuthor: atual.aiAuthor,
    aiConversationId: atual.aiConversationId,
    aiAgentName: atual.aiAgentName,
    aiRunId: atual.aiRunId,
    aiRoutineName: atual.aiRoutineName,
    aiRevisedAt: revisouTexto(atual, input) ? new Date() : atual.aiRevisedAt,
  };
}

/**
 * As colunas da série depois de perder a ocorrência `dia` (`esta`) ou de
 * encerrar na véspera de `corte` (`seguintes`). Os cancelamentos de `corte` em
 * diante saem da original: passam para a série nova, se há uma, e no DELETE
 * deixam de existir com o resto.
 */
function serieSem(
  tocada: OcorrenciaTocada<LinhaDaSerie>,
  alcance: { escopo: "esta" } | { escopo: "seguintes"; corte: string },
): Prisma.EventUpdateManyMutationInput {
  if (alcance.escopo === "esta") {
    return { exdates: { push: deDiaCivil(tocada.ocorrencia.occurrenceDate) } };
  }
  const { corte } = alcance;
  return {
    repeatUntil: deDiaCivil(somarDias(corte, -1)),
    exdates: tocada.serie.exdates.filter((d) => d < corte).map(deDiaCivil),
  };
}

/**
 * Tira a ocorrência (ou ela e as seguintes) da série, condicionado a ela ainda
 * existir (`ocorrenciaViva`). Em `seguintes` a escrita regrava `exdates` a
 * partir do que se leu, e por isso exige também o `updatedAt` lido: um
 * cancelamento gravado no meio não some calado.
 *
 * **A série que fica sem ocorrência viva é apagada, e quem decide é a releitura
 * depois da escrita, na mesma transação** — não a leitura de antes. Dois
 * "excluir só esta" simultâneos nas duas últimas ocorrências passam ambos pela
 * condicional (o segundo espera a trava da linha e reavalia o `where` sobre a
 * versão nova); decidindo pela leitura de antes, cada um veria a outra ainda
 * viva, e a linha ficaria vazia. A releitura do segundo vê os dois
 * cancelamentos, e ele apaga.
 */
async function tirarDaSerie(
  tx: Prisma.TransactionClient,
  userId: string,
  tocada: OcorrenciaTocada<LinhaDaSerie & { id: string; updatedAt: Date }>,
  alcance: { escopo: "esta" } | { escopo: "seguintes"; corte: string },
  fuso: string,
): Promise<void> {
  const { id } = tocada.linha;
  const { count } = await tx.event.updateMany({
    where: {
      ...ocorrenciaViva(id, userId, tocada.ocorrencia.occurrenceDate),
      ...(alcance.escopo === "seguintes" && { updatedAt: tocada.linha.updatedAt }),
    },
    data: serieSem(tocada, alcance),
  });
  if (count === 0) throw ocorrenciaNaoEncontrada();

  const depois = await tx.event.findFirst({
    where: { id, userId },
    select: {
      allDay: true,
      startsAt: true,
      endsAt: true,
      repeatDays: true,
      repeatUntil: true,
      exdates: true,
    },
  });
  const regra = depois ? regraDe(depois) : null;
  if (depois && regra && !restaOcorrencia(serieDe(depois, regra), fuso)) {
    await tx.event.deleteMany({ where: { id, userId } });
  }
}

/**
 * Frente Ritmo, RN-04: o check-in é da ocorrência, gravado como
 * `(event_id, day)`. Quando a ocorrência muda de linha — o avulso de `esta`, a
 * série nova de `seguintes` —, o registro vai junto; sem isso, um check-in no
 * evento novo pontuaria o mesmo dia de novo, e o antigo não se desfaria mais.
 */
async function levarCheckIns(
  tx: Prisma.TransactionClient,
  userId: string,
  de: string,
  para: string,
  dias: Pick<Prisma.HabitEntryWhereInput, "day">,
): Promise<void> {
  await tx.habitEntry.updateMany({
    where: { userId, eventId: de, origin: "event", ...dias },
    data: { eventId: para },
  });
}

/**
 * `esta`: a ocorrência sai da série (`exdates`) e nasce um evento avulso com o
 * horário dela e o PATCH por cima. A repetição não se muda numa ocorrência só.
 */
async function atualizarEsta(
  userId: string,
  tocada: OcorrenciaTocada<LinhaDaCopia>,
  input: EventUpdateInput,
  fuso: string,
): Promise<EventItem> {
  if (input.repeat !== undefined) {
    throw invalido("A repetição se muda em todas as ocorrências ou nas seguintes");
  }
  const { horario } = resolverOuRecusar(mesclarHorario(tocada.ocorrencia, input), null);
  const instantes = instantesDe(horario, fuso);

  const id = await prisma
    .$transaction(async (tx) => {
      // O avulso nasce antes de a ocorrência sair: o check-in dela (frente
      // Ritmo, RF-08) muda de dono antes que a série, ficando vazia, seja
      // apagada e a FK o solte.
      const avulso = await tx.event.create({
        data: { userId, ...copiaDaSerie(tocada.linha, input), ...instantes },
        select: { id: true },
      });
      await levarCheckIns(tx, userId, tocada.linha.id, avulso.id, {
        day: deDiaCivil(tocada.ocorrencia.occurrenceDate),
      });
      await tirarDaSerie(tx, userId, tocada, { escopo: "esta" }, fuso);
      return avulso.id;
    })
    .catch(quadroQueSumiu);
  return buscarEvento(userId, id);
}

/**
 * `seguintes`: a série original termina e nasce uma série nova a partir da
 * ocorrência com o PATCH por cima — a regra também, se veio (`repeat: null`
 * deixa só a ocorrência, avulsa). Os cancelamentos de dali em diante passam
 * para a nova. Da primeira ocorrência, é `todas` (quem decide é
 * `atualizarEvento`).
 *
 * **A original termina na véspera do que vier antes**: da ocorrência, ou do
 * novo início, se o PATCH puxou o dia para trás. Cortar só na ocorrência
 * deixaria as duas séries com ocorrência nos dias entre o novo início e ela —
 * a quarta 21 movida para a segunda 19 duplicaria a segunda. Se o novo início
 * cai no início da série ou antes, nada da original fica: é `todas`.
 */
async function atualizarSeguintes(
  userId: string,
  tocada: OcorrenciaTocada<LinhaDaCopia>,
  input: EventUpdateInput,
  fuso: string,
): Promise<EventItem> {
  const { serie, ocorrencia } = tocada;
  const { horario, recurrence } = resolverOuRecusar(
    mesclarHorario(ocorrencia, input),
    input.repeat !== undefined ? input.repeat : serie.recurrence,
  );
  if (horario.date <= tocada.primeiroDia) {
    return atualizarTodas(userId, tocada.linha, input, fuso);
  }
  const instantes = instantesDe(horario, fuso);
  const corte = horario.date < ocorrencia.occurrenceDate ? horario.date : ocorrencia.occurrenceDate;
  // Os cancelamentos depois do início da nova passam para ela; o do próprio
  // início, não: é o dia que o PATCH pediu para a ocorrência, e herdá-lo
  // gravaria a série nova já sem a primeira — 200, e nada no dia pedido.
  const exdates = recurrence ? serie.exdates.filter((d) => d > horario.date) : [];

  const id = await prisma
    .$transaction(async (tx) => {
      const nova = await tx.event.create({
        data: {
          userId,
          ...copiaDaSerie(tocada.linha, input),
          ...instantes,
          ...colunasDaRegra(recurrence),
          exdates: exdates.map(deDiaCivil),
        },
        select: { id: true },
      });
      // Os check-ins do corte em diante vão para a série nova, como as
      // ocorrências (frente Ritmo, RF-08) — antes de a original encolher.
      await levarCheckIns(tx, userId, tocada.linha.id, nova.id, {
        day: { gte: deDiaCivil(corte) },
      });
      await tirarDaSerie(tx, userId, tocada, { escopo: "seguintes", corte }, fuso);
      return nova.id;
    })
    .catch(quadroQueSumiu);
  return buscarEvento(userId, id);
}

/**
 * `todas` (o padrão) e o evento simples apagam a linha; `esta` cancela a
 * ocorrência; `seguintes` encerra a série na véspera — da primeira, apaga
 * tudo. A série que fica sem ocorrência viva é apagada.
 */
export async function excluirEvento(userId: string, id: string, escopo: EventScope): Promise<void> {
  if (escopo.scope !== "todas") {
    const linha = await prisma.event.findFirst({
      where: { id, userId },
      select: {
        id: true,
        allDay: true,
        startsAt: true,
        endsAt: true,
        repeatDays: true,
        repeatUntil: true,
        exdates: true,
        updatedAt: true,
      },
    });
    if (!linha) throw notFound("Evento não encontrado");
    if (linha.repeatDays.length > 0) {
      const { timezone } = await preferenciaDe(userId);
      const tocada = ocorrenciaTocada(linha, escopo, timezone);
      const daPrimeira = tocada?.ocorrencia.occurrenceDate === tocada?.primeiroDia;
      if (tocada && (escopo.scope === "esta" || !daPrimeira)) {
        // Transação: a escrita e a releitura que decide apagar a série vazia.
        const dia = tocada.ocorrencia.occurrenceDate;
        const alcance =
          escopo.scope === "esta"
            ? ({ escopo: "esta" } as const)
            : ({ escopo: "seguintes", corte: dia } as const);
        await prisma.$transaction((tx) => tirarDaSerie(tx, userId, tocada, alcance, timezone));
        return;
      }
    }
  }
  const { count } = await prisma.event.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Evento não encontrado");
}

/* --------------------------------------------------------- conversão */

/// O vínculo com o hábito vai junto na conversão, como o projeto (frente
/// Ritmo, RF-06); o que vier no pedido passa por cima.
function vinculoDaConversao(
  pedido: string | null | undefined,
  atual: string | null | undefined,
): string | null {
  return pedido !== undefined ? pedido : (atual ?? null);
}

/**
 * Frente Ritmo, RF-08: confere que `dia` é uma ocorrência de verdade do evento
 * — o dia do evento simples, ou um dia vivo da série — e devolve o vínculo
 * dele com o hábito. Mora aqui porque é aqui que se sabe ler série e fuso.
 */
export async function conferirOcorrencia(
  userId: string,
  id: string,
  dia: string,
): Promise<{ habitActivityId: string | null }> {
  const linha = await prisma.event.findFirst({
    where: { id, userId },
    select: { ...CAMPOS_EVENTO, habitActivityId: true },
  });
  if (!linha) throw notFound("Evento não encontrado");
  const { timezone } = await preferenciaDe(userId);
  const recurrence = regraDe(linha);
  const existe = recurrence
    ? ocorrenciaDoDia(serieDe(linha, recurrence), dia, timezone) !== null
    : horarioNoFuso(linha, timezone).date === dia;
  if (!existe) throw invalido("O evento não acontece nesse dia");
  return { habitActivityId: linha.habitActivityId };
}

/**
 * O que o evento leva para a descrição da tarefa: local e link não têm campo
 * nela, e sumir com eles calado perderia o endereço da consulta. Cortado no
 * teto da descrição da tarefa, que é o mesmo do evento.
 */
function descricaoDaTarefa(linha: {
  description: string | null;
  location: string | null;
  url: string | null;
}) {
  const extras = [
    linha.location && `Local: ${linha.location}`,
    linha.url && `Link: ${linha.url}`,
  ].filter(Boolean);
  const base = linha.description ?? "";
  if (extras.length === 0) return base;
  return `${base ? `${base}\n\n` : ""}${extras.join("\n")}`.slice(0, MAX_TAREFA_DESCRICAO);
}

/**
 * O evento vira tarefa, numa transação: a tarefa nasce e o evento sai. Da
 * tarefa vêm título, descrição (com local e link anexados), o dia e a hora de
 * início — nenhuma, no dia inteiro — e o projeto; `input` passa por cima. A
 * marca de IA vai junto (`copiaDaMarca`, INV-58).
 *
 * **Numa série, só uma ocorrência vira tarefa** (`scope=esta`): tarefa não se
 * repete, e converter `todas` ou `seguintes` produziria uma tarefa e apagaria
 * o resto calado. A ocorrência sai da série como no "excluir só esta"
 * (`tirarDaSerie`), e a série que fica vazia é apagada.
 *
 * O evento simples sai condicionado ao `updatedAt` lido (INV-04): editado no
 * meio, a conversão falha com 404 em vez de gravar a tarefa com dados velhos.
 */
export async function converterEventoEmTarefa(
  userId: string,
  id: string,
  input: EventToTaskInput,
  escopo: ConversionScope,
): Promise<TaskItem> {
  const linha = await prisma.event.findFirst({
    where: { id, userId },
    select: CAMPOS_DA_COPIA,
  });
  if (!linha) throw notFound("Evento não encontrado");
  const { timezone } = await preferenciaDe(userId);

  const serie = linha.repeatDays.length > 0;
  if (serie && escopo.scope === "todas") {
    return converterSerieEmTarefas(userId, linha, input, timezone);
  }
  if (serie && escopo.scope !== "esta") {
    throw invalido(
      "Numa série, diga o alcance: uma ocorrência (scope=esta e occurrenceDate) ou a série " +
        "inteira, que vira tarefa recorrente (scope=todas)",
    );
  }
  const tocada = serie
    ? ocorrenciaTocada(linha, { scope: "esta", occurrenceDate: escopo.occurrenceDate }, timezone)
    : null;
  const horario = tocada?.ocorrencia ?? horarioNoFuso(linha, timezone);

  const boardId = input.boardId !== undefined ? input.boardId : (linha.board?.id ?? null);
  if (boardId && boardId !== linha.board?.id) await conferirQuadro(userId, boardId);
  const habitActivityId = vinculoDaConversao(input.habitActivityId, linha.habitActivity?.id);
  if (habitActivityId && habitActivityId !== linha.habitActivity?.id) {
    await conferirAtividade(userId, habitActivityId);
  }
  const date = input.date !== undefined ? input.date : horario.date;
  // Tirar a data leva a hora junto, como no PATCH da tarefa.
  const time =
    input.time !== undefined ? input.time : input.date === null ? null : horario.startTime;
  const quando = colunasDoQuando(date, time);

  const tarefaId = await prisma
    .$transaction(async (tx) => {
      if (tocada) {
        await tirarDaSerie(tx, userId, tocada, { escopo: "esta" }, timezone);
      } else {
        const { count } = await tx.event.deleteMany({
          where: { id, userId, updatedAt: linha.updatedAt },
        });
        if (count === 0) throw notFound("Evento não encontrado");
      }
      const tarefa = await tx.task.create({
        data: {
          userId,
          title: (input.title ?? linha.title).trim(),
          descriptionMd: input.descriptionMd ?? descricaoDaTarefa(linha),
          ...quando,
          boardId,
          habitActivityId,
          ...copiaDaMarca(linha),
        },
        select: { id: true },
      });
      return tarefa.id;
    })
    .catch(quadroQueSumiu);
  return buscarTarefa(userId, tarefaId);
}

/**
 * A série de evento inteira vira tarefa recorrente: a série de tarefa começa
 * hoje (ou no início do evento, se ele ainda não começou), com os mesmos dias,
 * fim e dias cancelados de hoje em diante; a hora é a de início, nenhuma no
 * dia inteiro. **O evento não some do passado**: a série termina ontem, e só
 * a que nem tinha começado é apagada. A marca de IA vai para a série de
 * tarefa e daí para cada ocorrência (INV-58).
 */
async function converterSerieEmTarefas(
  userId: string,
  linha: LinhaDaCopia,
  input: EventToTaskInput,
  fuso: string,
): Promise<TaskItem> {
  const recurrence = regraDe(linha);
  if (!recurrence) throw invalido("Este evento não se repete");
  const hoje = diaLocal(new Date(), fuso);
  if (recurrence.until && recurrence.until < hoje) {
    throw invalido("Esta série já terminou: não há o que converter de hoje em diante");
  }
  const primeiro = horarioNoFuso(linha, fuso);
  const startDate = primeiro.date > hoje ? primeiro.date : hoje;
  const boardId = input.boardId !== undefined ? input.boardId : (linha.board?.id ?? null);
  if (boardId && boardId !== linha.board?.id) await conferirQuadro(userId, boardId);
  const time = input.time !== undefined ? input.time : primeiro.startTime;
  colunasDoQuando(startDate, time);
  const habitActivityId = vinculoDaConversao(input.habitActivityId, linha.habitActivity?.id);
  if (habitActivityId && habitActivityId !== linha.habitActivity?.id) {
    await conferirAtividade(userId, habitActivityId);
  }
  const marca = copiaDaMarca(linha);

  const tarefaId = await prisma
    .$transaction(async (tx) => {
      const daqui = { id: linha.id, userId, updatedAt: linha.updatedAt };
      if (primeiro.date >= hoje) {
        const { count } = await tx.event.deleteMany({ where: daqui });
        if (count === 0) throw notFound("Evento não encontrado");
      } else {
        const { count } = await tx.event.updateMany({
          where: daqui,
          data: {
            repeatUntil: deDiaCivil(somarDias(hoje, -1)),
            exdates: serieDe(linha, recurrence)
              .exdates.filter((d) => d < hoje)
              .map(deDiaCivil),
          },
        });
        if (count === 0) throw notFound("Evento não encontrado");
      }
      const primeira = await gravarSerie(
        tx,
        userId,
        {
          title: (input.title ?? linha.title).trim(),
          descriptionMd: input.descriptionMd ?? descricaoDaTarefa(linha),
          time,
          boardId,
          startDate,
          recurrence,
          exdates: serieDe(linha, recurrence).exdates.filter((d) => d >= hoje),
          habitActivityId,
        },
        {
          aiGeneratedAt: marca.aiGeneratedAt,
          aiVia: marca.aiVia,
          aiAuthor: marca.aiAuthor,
          aiAgentName: marca.aiAgentName,
          aiRoutineName: marca.aiRoutineName,
          aiRevisedAt: marca.aiRevisedAt,
        },
        hoje,
      );
      if (!primeira) throw semDiaNoHorizonte();
      return primeira;
    })
    .catch(quadroQueSumiu);
  return buscarTarefa(userId, tarefaId);
}

/**
 * A tarefa vira evento, numa transação: o evento nasce e a tarefa sai. Do
 * evento vêm título, descrição e projeto; o horário sai do dia e da hora da
 * tarefa — com hora, começa nela e dura o padrão; sem hora, é de dia inteiro.
 * `input` passa por cima de tudo, a repetição inclusive. A marca de IA vai
 * junto (INV-58).
 *
 * **Tarefa sem data pede o dia em `input.date`**: evento sem dia não existe.
 * **Tarefa concluída é recusada**: o evento não tem onde guardar a conclusão,
 * e convertê-la apagaria o registro de que foi feita.
 */
export async function converterTarefaEmEvento(
  userId: string,
  id: string,
  input: TaskToEventInput,
): Promise<EventItem> {
  const tarefa = await prisma.task.findFirst({
    where: { id, userId },
    select: {
      title: true,
      descriptionMd: true,
      date: true,
      time: true,
      boardId: true,
      completedAt: true,
      updatedAt: true,
      seriesId: true,
      habitActivityId: true,
      ...CAMPOS_DA_MARCA,
    },
  });
  if (!tarefa) throw notFound("Tarefa não encontrada");
  if (tarefa.completedAt) {
    throw invalido("Tarefa concluída não vira evento: reabra-a antes de converter");
  }

  const date = input.date ?? (tarefa.date ? paraDiaCivil(tarefa.date) : null);
  if (!date) throw invalido("Informe o dia do evento: a tarefa não tem data");
  // Hora pedida liga o horário; sem ela, vale a da tarefa, e sem nenhuma o
  // evento é do dia inteiro.
  const startTime = input.startTime !== undefined ? input.startTime : tarefa.time;
  const allDay = input.allDay ?? !startTime;
  const { horario, recurrence } = resolverOuRecusar(
    {
      allDay,
      date,
      endDate: input.endDate,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : input.endTime,
    },
    input.repeat,
  );
  const { timezone } = await preferenciaDe(userId);
  const instantes = instantesDe(horario, timezone);

  const boardId = input.boardId !== undefined ? input.boardId : tarefa.boardId;
  if (boardId && boardId !== tarefa.boardId) await conferirQuadro(userId, boardId);
  const habitActivityId = vinculoDaConversao(input.habitActivityId, tarefa.habitActivityId);
  if (habitActivityId && habitActivityId !== tarefa.habitActivityId) {
    await conferirAtividade(userId, habitActivityId);
  }

  const eventoId = await prisma
    .$transaction(async (tx) => {
      // Ocorrência de série sai só ela: o dia não é gerado de novo.
      if (tarefa.seriesId && tarefa.date) {
        await soltarDaSerie(tx, userId, tarefa.seriesId, tarefa.date);
      }
      const { count } = await tx.task.deleteMany({
        where: { id, userId, updatedAt: tarefa.updatedAt, completedAt: null },
      });
      if (count === 0) throw notFound("Tarefa não encontrada");
      const evento = await tx.event.create({
        data: {
          userId,
          title: (input.title ?? tarefa.title).trim(),
          description: input.description ?? tarefa.descriptionMd,
          ...instantes,
          ...colunasDaRegra(recurrence),
          location: limpo(input.location),
          url: limpo(input.url),
          boardId,
          habitActivityId,
          ...copiaDaMarca(tarefa),
        },
        select: { id: true },
      });
      return evento.id;
    })
    .catch(quadroQueSumiu);
  return buscarEvento(userId, eventoId);
}

/* ------------------------------------------------------------- agenda */

/**
 * Tudo o que a agenda desenha num período, numa requisição: eventos que se
 * sobrepõem a ele, tarefas com data nele, as atrasadas de antes dele (as de
 * dentro já estão nas tarefas do período, marcadas `overdue`), as abertas sem
 * data — que não têm período e vêm sempre — e os cards com prazo.
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

  const [events, tasks, overdueTasks, undatedTasks, cards] = await Promise.all([
    eventosNoPeriodo(userId, query.from, query.to, timezone),
    tarefasDoPeriodo(userId, query.from, query.to, hoje),
    // Só as anteriores ao período: as de dentro já vêm em `tasks`.
    tarefasAtrasadas(userId, hoje, query.from < hoje ? query.from : hoje),
    tarefasSemData(userId, hoje),
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
    undatedTasks,
    cards: cards.map((card) => ({
      ...toPrazo(card),
      // Só entram cards com prazo no período, então a data existe.
      date: diaLocal(card.dueDate as Date, timezone),
    })),
  };
}
