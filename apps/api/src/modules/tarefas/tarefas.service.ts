import { Prisma } from "@prisma/client";
import type {
  EventRecurrence,
  TaskInput,
  TaskItem,
  TaskSeriesItem,
  TaskSeriesUpdateInput,
  TasksQuery,
  TaskUpdateInput,
} from "@yu-book/shared";
import {
  HORA_DA_AGENDA,
  LIMITE_TAREFAS_CONCLUIDAS,
  LIMITE_TAREFAS_SEM_DATA,
  diaDaSemana,
  diaLocal,
  ehDiaCivil,
  somarDias,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import {
  CAMPOS_DA_CONCLUSAO,
  CAMPOS_DA_MARCA,
  camposDaConclusao,
  camposDaOrigem,
  paraConclusao,
  paraMarca,
} from "../../lib/marca.js";
import type { OrigemIA } from "../../lib/marca.js";
import { preferenciaDe } from "../assistente/preferencias.service.js";

/**
 * Tarefas — frente de agenda, Fase 1.
 *
 * `task` tem `user_id` próprio: a posse é direta, no `where` de toda consulta
 * (INV-01), e toda escrita é condicional com o escopo dentro (INV-04). O que
 * vem de fora e aponta para outra tabela — o quadro — é conferido contra o
 * usuário (INV-59): a FK só garante que o quadro existe.
 */

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);

/**
 * O quadro de evento e tarefa, conferido contra o usuário. De outra conta dá a
 * mesma resposta que inexistente (INV-02). Exportado para `eventos.service`,
 * que confere o mesmo campo.
 */
export async function conferirQuadro(userId: string, boardId: string): Promise<void> {
  const quadro = await prisma.board.findFirst({
    where: { id: boardId, userId },
    select: { id: true },
  });
  if (!quadro) throw notFound("Quadro não encontrado");
}

/**
 * O quadro pode ser excluído entre `conferirQuadro` e a escrita: a FK recusa
 * com `P2003`, e a resposta é a mesma de quem pediu um quadro que não existe —
 * não um 500 (o precedente é `ehAgenteQueSumiu`, `conversas.service.ts`). O
 * nome da constraint é conferido para que outra FK violada suba como é.
 */
export function quadroQueSumiu(erro: unknown): never {
  if (
    erro instanceof Prisma.PrismaClientKnownRequestError &&
    erro.code === "P2003" &&
    (erro.meta?.constraint === "task_board_id_fkey" ||
      erro.meta?.constraint === "event_board_id_fkey")
  ) {
    throw notFound("Quadro não encontrado");
  }
  throw erro;
}

/**
 * `AAAA-MM-DD` ↔ a coluna `DATE`. O Prisma entrega e recebe `DATE` como meia-noite
 * **UTC**, então aqui o corte do ISO é seguro — o dia não passa por fuso
 * nenhum. É o oposto do prazo do card, que é instante e depende do fuso.
 */
///
/// O dia é conferido aqui também, e não só no schema: `new Date` rola
/// `2026-02-30` para 2 de março em silêncio, e o chat (Fase 2 da frente de agenda)
/// chama o service com argumentos que o modelo escreveu.
function paraColunaDate(dia: string): Date {
  if (!ehDiaCivil(dia)) throw invalido("Use uma data que exista, no formato AAAA-MM-DD");
  return new Date(`${dia}T00:00:00.000Z`);
}
const daColunaDate = (data: Date) => data.toISOString().slice(0, 10);

/// A hora, pelo mesmo motivo do dia: o schema confere, o chat não passa por ele.
function conferirHora(hora: string | null): void {
  if (hora !== null && !HORA_DA_AGENDA.test(hora)) throw invalido("Hora no formato HH:MM");
}

/**
 * O dia e a hora de uma tarefa nas colunas, conferidos: "hora só com data", a
 * hora no formato e o dia que exista. Exportado para a conversão de evento em
 * tarefa (`eventos.service`), que grava a tarefa na própria transação.
 */
export function colunasDoQuando(date: string | null, time: string | null) {
  if (time !== null && date === null) throw invalido("Hora só com data: informe o dia");
  conferirHora(time);
  return { date: date === null ? null : paraColunaDate(date), time };
}

const CAMPOS_TAREFA = {
  id: true,
  title: true,
  descriptionMd: true,
  date: true,
  time: true,
  createdAt: true,
  updatedAt: true,
  board: { select: { id: true, name: true } },
  series: { select: { id: true, repeatDays: true, repeatUntil: true } },
  ...CAMPOS_DA_MARCA,
  ...CAMPOS_DA_CONCLUSAO,
} satisfies Prisma.TaskSelect;

type LinhaTarefa = Prisma.TaskGetPayload<{ select: typeof CAMPOS_TAREFA }>;

/// `hoje` é o dia local do usuário: é ele, e não o do servidor, que diz o que
/// está atrasado.
function paraTarefa(linha: LinhaTarefa, hoje: string): TaskItem {
  const date = linha.date ? daColunaDate(linha.date) : null;
  return {
    id: linha.id,
    title: linha.title,
    descriptionMd: linha.descriptionMd,
    date,
    time: linha.time,
    // Ocorrência de série não atrasa: o hábito de ontem não cobra hoje.
    overdue: linha.completedAt === null && date !== null && date < hoje && !linha.series,
    completedAt: linha.completedAt?.toISOString() ?? null,
    completion: paraConclusao(linha),
    board: linha.board,
    ai: paraMarca(linha),
    series: linha.series
      ? {
          id: linha.series.id,
          days: linha.series.repeatDays,
          until: linha.series.repeatUntil ? daColunaDate(linha.series.repeatUntil) : null,
        }
      : null,
    createdAt: linha.createdAt.toISOString(),
    updatedAt: linha.updatedAt.toISOString(),
  };
}

/// O dia de hoje no fuso do usuário — nunca o do processo (a API roda em UTC).
async function hojeDe(userId: string): Promise<string> {
  const { timezone } = await preferenciaDe(userId);
  return diaLocal(new Date(), timezone);
}

/**
 * Abertas: com data primeiro, na ordem do dia; no mesmo dia, as sem hora antes
 * das marcadas (são "do dia", sem horário); e por fim a ordem de criação.
 */
const ORDEM_DAS_ABERTAS: Prisma.TaskOrderByWithRelationInput[] = [
  { date: { sort: "asc", nulls: "last" } },
  { time: { sort: "asc", nulls: "first" } },
  { createdAt: "asc" },
];

export async function listarTarefas(userId: string, query: TasksQuery): Promise<TaskItem[]> {
  if (query.boardId) await conferirQuadro(userId, query.boardId);
  const hoje = await hojeDe(userId);
  const base: Prisma.TaskWhereInput = { userId, ...(query.boardId && { boardId: query.boardId }) };

  // Da série, só a ocorrência de hoje: as futuras inundariam a lista, e as
  // passadas não cobram (não atrasam).
  const abertas = () =>
    prisma.task.findMany({
      where: {
        ...base,
        completedAt: null,
        OR: [{ seriesId: null }, { date: paraColunaDate(hoje) }],
      },
      orderBy: ORDEM_DAS_ABERTAS,
      select: CAMPOS_TAREFA,
    });
  // As concluídas só crescem; a lista mostra as recentes, não o histórico.
  const concluidas = () =>
    prisma.task.findMany({
      where: { ...base, completedAt: { not: null } },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: LIMITE_TAREFAS_CONCLUIDAS,
      select: CAMPOS_TAREFA,
    });

  const linhas =
    query.status === "abertas"
      ? await abertas()
      : query.status === "concluidas"
        ? await concluidas()
        : (await Promise.all([abertas(), concluidas()])).flat();
  return linhas.map((linha) => paraTarefa(linha, hoje));
}

export async function buscarTarefa(userId: string, id: string): Promise<TaskItem> {
  const [linha, hoje] = await Promise.all([
    prisma.task.findFirst({ where: { id, userId }, select: CAMPOS_TAREFA }),
    hojeDe(userId),
  ]);
  if (!linha) throw notFound("Tarefa não encontrada");
  return paraTarefa(linha, hoje);
}

/**
 * `origem` é a marca de IA (INV-58): o chat a monta da conversa, a rota a
 * traduz do `origin` do MCP. Nunca vem do corpo como campo da tarefa.
 */
export async function criarTarefa(
  userId: string,
  input: Omit<TaskInput, "origin">,
  origem?: OrigemIA,
): Promise<TaskItem> {
  if (input.repeat) return criarSerie(userId, { ...input, repeat: input.repeat }, origem);
  const date = input.date ?? null;
  const time = input.time ?? null;
  // O schema já confere; o service confere de novo porque o chat (Fase 2 da frente
  // de agenda) chama daqui com argumentos que o modelo escreveu.
  if (time !== null && date === null) throw invalido("Hora só com data: informe o dia");
  conferirHora(time);
  const dataDaColuna = date === null ? null : paraColunaDate(date);
  if (input.boardId) await conferirQuadro(userId, input.boardId);

  const { id } = await prisma.task
    .create({
      data: {
        userId,
        title: input.title.trim(),
        descriptionMd: input.descriptionMd ?? "",
        date: dataDaColuna,
        time,
        boardId: input.boardId ?? null,
        ...camposDaOrigem(origem),
      },
      select: { id: true },
    })
    .catch(quadroQueSumiu);
  return buscarTarefa(userId, id);
}

export async function atualizarTarefa(
  userId: string,
  id: string,
  input: TaskUpdateInput,
): Promise<TaskItem> {
  const atual = await prisma.task.findFirst({
    where: { id, userId },
    select: {
      title: true,
      descriptionMd: true,
      date: true,
      time: true,
      aiGeneratedAt: true,
      seriesId: true,
    },
  });
  if (!atual) throw notFound("Tarefa não encontrada");
  if (input.boardId) await conferirQuadro(userId, input.boardId);

  // "Hora só com data" sobre o valor mesclado — o schema parcial não o vê.
  // Tirar a data leva a hora junto, em vez de recusar: hora sem dia não tem
  // o que significar, e quem tira a data quer a tarefa "sem quando".
  const date = input.date !== undefined ? input.date : atual.date && daColunaDate(atual.date);
  const time = input.time !== undefined ? input.time : input.date === null ? null : atual.time;
  if (time !== null && date === null) throw invalido("Hora só com data: informe o dia");
  conferirHora(time);
  const dataDaColuna = date === null ? null : paraColunaDate(date);

  // Mesma regra de revisão de card e nota (INV-58): só o texto, e só se mudou.
  const revisou =
    atual.aiGeneratedAt !== null &&
    ((input.title !== undefined && input.title.trim() !== atual.title) ||
      (input.descriptionMd !== undefined && input.descriptionMd !== atual.descriptionMd));

  // Editar uma ocorrência a solta da série: ela vira tarefa avulsa, e o dia
  // dela entra nos `exdates` da série para não ser gerado de novo.
  const soltar = atual.seriesId !== null && atual.date !== null;
  const { count } = await prisma
    .$transaction(async (tx) => {
      if (soltar) await soltarDaSerie(tx, userId, atual.seriesId as string, atual.date as Date);
      return tx.task.updateMany({
        where: { id, userId },
        data: {
          ...(soltar && { seriesId: null }),
          ...(input.title !== undefined && { title: input.title.trim() }),
          ...(input.descriptionMd !== undefined && { descriptionMd: input.descriptionMd }),
          ...((input.date !== undefined || input.time !== undefined) && {
            date: dataDaColuna,
            time,
          }),
          ...(input.boardId !== undefined && { boardId: input.boardId }),
          ...(revisou && { aiRevisedAt: new Date() }),
        },
      });
    })
    .catch(quadroQueSumiu);
  if (count === 0) throw notFound("Tarefa não encontrada");
  return buscarTarefa(userId, id);
}

/**
 * Concluir ou reabrir, com a marca de quem pediu — o par de `concluirCard`
 * (INV-63). Posse **e** estado esperado no mesmo `where`: concluir de novo em
 * paralelo (o toque no celular e o chat) não troca a data nem quem concluiu,
 * porque o segundo `UPDATE` não acha linha aberta. `count === 0` é ambíguo —
 * já estava no estado, ou não é sua —, e `buscarTarefa` desfaz a dúvida com o
 * 404 de sempre.
 */
export async function concluirTarefa(
  userId: string,
  id: string,
  completed: boolean,
  origem?: OrigemIA,
): Promise<TaskItem> {
  await prisma.task.updateMany({
    where: { id, userId, completedAt: completed ? null : { not: null } },
    data: camposDaConclusao(completed, origem),
  });
  return buscarTarefa(userId, id);
}

/**
 * Excluir uma ocorrência de série tira só ela: o dia entra nos `exdates` da
 * série, e a geração não o refaz. A série inteira se encerra por
 * `encerrarSerie`.
 */
export async function excluirTarefa(userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const linha = await tx.task.findFirst({
      where: { id, userId },
      select: { seriesId: true, date: true },
    });
    if (!linha) throw notFound("Tarefa não encontrada");
    if (linha.seriesId && linha.date) await soltarDaSerie(tx, userId, linha.seriesId, linha.date);
    const { count } = await tx.task.deleteMany({ where: { id, userId } });
    if (count === 0) throw notFound("Tarefa não encontrada");
  });
}

/* ------------------------------------------------------------- agenda */

/// Com data no período (abertas e concluídas), para `GET /agenda`.
export async function tarefasDoPeriodo(
  userId: string,
  de: string,
  ate: string,
  hoje: string,
): Promise<TaskItem[]> {
  const linhas = await prisma.task.findMany({
    where: { userId, date: { gte: paraColunaDate(de), lte: paraColunaDate(ate) } },
    orderBy: [{ date: "asc" }, { time: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: CAMPOS_TAREFA,
  });
  return linhas.map((linha) => paraTarefa(linha, hoje));
}

/**
 * Abertas com data antes de `antesDe`, a mais antiga primeiro. A agenda passa
 * `min(hoje, from)`: só as atrasadas **anteriores ao período** — as de dentro
 * dele já vêm em `tarefasDoPeriodo` com `overdue`, e não saem duas vezes.
 * `hoje` continua decidindo o `overdue` de cada uma.
 */
export async function tarefasAtrasadas(
  userId: string,
  hoje: string,
  antesDe: string,
): Promise<TaskItem[]> {
  const linhas = await prisma.task.findMany({
    // Ocorrência de série não atrasa (`paraTarefa`), e não entra aqui.
    where: { userId, completedAt: null, seriesId: null, date: { lt: paraColunaDate(antesDe) } },
    orderBy: ORDEM_DAS_ABERTAS,
    select: CAMPOS_TAREFA,
  });
  return linhas.map((linha) => paraTarefa(linha, hoje));
}

/**
 * Abertas e sem data, as mais **recentes** primeiro, até
 * `LIMITE_TAREFAS_SEM_DATA` — para `GET /agenda` (`undatedTasks`). Sem elas o
 * chat não acha o id de uma tarefa sem dia (Fase 2 da frente de agenda), e a
 * que ele quer concluir é quase sempre a recém-anotada: no corte, quem sai é a
 * mais velha. O índice `(user_id, completed_at, date)` cobre o filtro.
 */
export async function tarefasSemData(userId: string, hoje: string): Promise<TaskItem[]> {
  const linhas = await prisma.task.findMany({
    where: { userId, completedAt: null, date: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIMITE_TAREFAS_SEM_DATA,
    select: CAMPOS_TAREFA,
  });
  return linhas.map((linha) => paraTarefa(linha, hoje));
}

/* ------------------------------------------------------------- séries */

/**
 * Até quantos dias à frente as ocorrências de uma série existem. Além disso
 * elas ainda não foram geradas — o relógio da API empurra o horizonte
 * (`estenderSeriesDeTarefas`). Dois meses cobrem a agenda que o celular
 * desenha e o `list_agenda` do chat.
 */
export const HORIZONTE_DAS_SERIES_DIAS = 60;

const CAMPOS_SERIE = {
  id: true,
  userId: true,
  boardId: true,
  title: true,
  descriptionMd: true,
  time: true,
  startDate: true,
  repeatDays: true,
  repeatUntil: true,
  exdates: true,
  generatedThrough: true,
  aiGeneratedAt: true,
  aiVia: true,
  aiAuthor: true,
  aiAgentName: true,
  aiRoutineName: true,
  aiRevisedAt: true,
  board: { select: { id: true, name: true } },
} satisfies Prisma.TaskSeriesSelect;

type LinhaSerie = Prisma.TaskSeriesGetPayload<{ select: typeof CAMPOS_SERIE }>;

/// O molde das ocorrências: o que cada uma copia da série.
type MoldeDaSerie = Pick<
  LinhaSerie,
  | "id"
  | "userId"
  | "boardId"
  | "title"
  | "descriptionMd"
  | "time"
  | "startDate"
  | "repeatDays"
  | "repeatUntil"
  | "exdates"
  | "aiGeneratedAt"
  | "aiVia"
  | "aiAuthor"
  | "aiAgentName"
  | "aiRoutineName"
  | "aiRevisedAt"
>;

/**
 * Os dias da série entre `de` e `ate`, inclusive: no dia da semana da regra,
 * a partir do início, até o fim, fora os soltos. Datas civis — a série de
 * tarefa não passa por fuso, como `task.date`.
 */
export function diasDaSerie(
  serie: { startDate: string; days: readonly number[]; until: string | null; exdates: readonly string[] },
  de: string,
  ate: string,
): string[] {
  const inicio = de > serie.startDate ? de : serie.startDate;
  const fim = serie.until !== null && serie.until < ate ? serie.until : ate;
  const soltos = new Set(serie.exdates);
  const dias: string[] = [];
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    if (serie.days.includes(diaDaSemana(dia)) && !soltos.has(dia)) dias.push(dia);
  }
  return dias;
}

/**
 * Grava as ocorrências de `de` a `ate` e empurra `generated_through`. O único
 * `(series_id, date)` faz a geração idempotente: a outra instância, o relógio
 * repetido ou uma ocorrência já concluída naquele dia não duplicam nada
 * (`skipDuplicates`), e o horizonte só anda para a frente.
 */
async function gerarOcorrencias(
  tx: Prisma.TransactionClient,
  serie: MoldeDaSerie,
  de: string,
  ate: string,
): Promise<void> {
  const dias = diasDaSerie(
    {
      startDate: daColunaDate(serie.startDate),
      days: serie.repeatDays,
      until: serie.repeatUntil ? daColunaDate(serie.repeatUntil) : null,
      exdates: serie.exdates.map(daColunaDate),
    },
    de,
    ate,
  );
  if (dias.length > 0) {
    await tx.task.createMany({
      data: dias.map((dia) => ({
        userId: serie.userId,
        boardId: serie.boardId,
        seriesId: serie.id,
        title: serie.title,
        descriptionMd: serie.descriptionMd,
        date: paraColunaDate(dia),
        time: serie.time,
        aiGeneratedAt: serie.aiGeneratedAt,
        aiVia: serie.aiVia,
        aiAuthor: serie.aiAuthor,
        aiAgentName: serie.aiAgentName,
        aiRoutineName: serie.aiRoutineName,
        aiRevisedAt: serie.aiRevisedAt,
      })),
      skipDuplicates: true,
    });
  }
  await tx.taskSeries.updateMany({
    where: { id: serie.id, generatedThrough: { lt: paraColunaDate(ate) } },
    data: { generatedThrough: paraColunaDate(ate) },
  });
}

/// O dia da ocorrência solta (editada, excluída ou convertida só ela) entra
/// nos `exdates` da série: a próxima geração não a refaz.
export async function soltarDaSerie(
  tx: Prisma.TransactionClient,
  userId: string,
  seriesId: string,
  dia: Date,
): Promise<void> {
  await tx.taskSeries.updateMany({
    where: { id: seriesId, userId, NOT: { exdates: { has: dia } } },
    data: { exdates: { push: dia } },
  });
}

/** O que a criação de uma série precisa — da tarefa nova ou do evento convertido. */
export interface PedidoDeSerie {
  title: string;
  descriptionMd: string;
  time: string | null;
  boardId: string | null;
  startDate: string;
  recurrence: EventRecurrence;
  exdates?: string[];
}

/**
 * Cria a série e as ocorrências de hoje em diante, dentro de `tx`. Devolve o
 * id da primeira ocorrência, ou `null` se a regra não tem dia nenhum de hoje
 * até o horizonte — quem chama decide se isso é recusa.
 */
export async function gravarSerie(
  tx: Prisma.TransactionClient,
  userId: string,
  pedido: PedidoDeSerie,
  marca: Partial<
    Pick<
      MoldeDaSerie,
      "aiGeneratedAt" | "aiVia" | "aiAuthor" | "aiAgentName" | "aiRoutineName" | "aiRevisedAt"
    >
  >,
  hoje: string,
): Promise<string | null> {
  const de = pedido.startDate > hoje ? pedido.startDate : hoje;
  const ate = somarDias(hoje, HORIZONTE_DAS_SERIES_DIAS);
  const serie = await tx.taskSeries.create({
    data: {
      userId,
      boardId: pedido.boardId,
      title: pedido.title,
      descriptionMd: pedido.descriptionMd,
      time: pedido.time,
      startDate: paraColunaDate(pedido.startDate),
      repeatDays: [...pedido.recurrence.days].sort((a, b) => a - b),
      repeatUntil: pedido.recurrence.until ? paraColunaDate(pedido.recurrence.until) : null,
      exdates: (pedido.exdates ?? []).map(paraColunaDate),
      generatedThrough: paraColunaDate(somarDias(de, -1)),
      aiGeneratedAt: marca.aiGeneratedAt ?? null,
      aiVia: marca.aiVia ?? null,
      aiAuthor: marca.aiAuthor ?? null,
      aiAgentName: marca.aiAgentName ?? null,
      aiRoutineName: marca.aiRoutineName ?? null,
      aiRevisedAt: marca.aiRevisedAt ?? null,
    },
    select: CAMPOS_SERIE,
  });
  await gerarOcorrencias(tx, serie, de, ate);
  const primeira = await tx.task.findFirst({
    where: { seriesId: serie.id },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  return primeira?.id ?? null;
}

/// Os dias, conferidos de novo no service: o chat e o MCP chamam com o que o
/// modelo escreveu.
function conferirRegra(recurrence: EventRecurrence, inicio: string): void {
  if (recurrence.days.length === 0) throw invalido("Escolha pelo menos um dia da semana");
  if (recurrence.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw invalido("Dia da semana de 0 a 6");
  }
  if (new Set(recurrence.days).size !== recurrence.days.length) {
    throw invalido("Dia da semana repetido");
  }
  if (recurrence.until) {
    paraColunaDate(recurrence.until);
    if (recurrence.until < inicio) throw invalido("O fim da repetição vem antes do início");
  }
}

export const semDiaNoHorizonte = () =>
  invalido("A repetição não tem nenhum dia de hoje até o fim escolhido");

/**
 * A tarefa que se repete: cria a série e devolve a primeira ocorrência de
 * hoje em diante. `date` é o primeiro dia; dia passado vale como início, mas
 * só se geram ocorrências de hoje em diante.
 */
async function criarSerie(
  userId: string,
  input: Omit<TaskInput, "origin"> & { repeat: NonNullable<TaskInput["repeat"]> },
  origem?: OrigemIA,
): Promise<TaskItem> {
  const date = input.date ?? null;
  if (date === null) throw invalido("Tarefa que se repete precisa do primeiro dia");
  paraColunaDate(date);
  const time = input.time ?? null;
  conferirHora(time);
  const recurrence = { days: input.repeat.days, until: input.repeat.until ?? null };
  conferirRegra(recurrence, date);
  if (input.boardId) await conferirQuadro(userId, input.boardId);
  const hoje = await hojeDe(userId);
  const origemDaSerie = camposDaOrigem(origem);

  const id = await prisma
    .$transaction((tx) =>
      gravarSerie(
        tx,
        userId,
        {
          title: input.title.trim(),
          descriptionMd: input.descriptionMd ?? "",
          time,
          boardId: input.boardId ?? null,
          startDate: date,
          recurrence,
        },
        {
          aiGeneratedAt: origemDaSerie.aiGeneratedAt ?? null,
          aiVia: origemDaSerie.aiVia ?? null,
          aiAuthor: origemDaSerie.aiAuthor ?? null,
          aiAgentName: origemDaSerie.aiAgentName ?? null,
          aiRoutineName: origemDaSerie.aiRoutineName ?? null,
        },
        hoje,
      ).then((primeira) => {
        if (!primeira) throw semDiaNoHorizonte();
        return primeira;
      }),
    )
    .catch(quadroQueSumiu);
  return buscarTarefa(userId, id);
}

function paraSerie(linha: LinhaSerie): TaskSeriesItem {
  return {
    id: linha.id,
    title: linha.title,
    descriptionMd: linha.descriptionMd,
    time: linha.time,
    startDate: daColunaDate(linha.startDate),
    days: linha.repeatDays,
    until: linha.repeatUntil ? daColunaDate(linha.repeatUntil) : null,
    board: linha.board,
  };
}

export async function buscarSerie(userId: string, id: string): Promise<TaskSeriesItem> {
  const linha = await prisma.taskSeries.findFirst({ where: { id, userId }, select: CAMPOS_SERIE });
  if (!linha) throw notFound("Série não encontrada");
  return paraSerie(linha);
}

/**
 * Muda a série e refaz as ocorrências **abertas de hoje em diante**. As de
 * antes de hoje e as concluídas ficam como estão — são histórico —, e uma
 * concluída de hoje em diante continua ocupando o dia dela (o único
 * `(series_id, date)` a protege da regeração). As soltas também ficam: não
 * são mais da série.
 */
export async function atualizarSerie(
  userId: string,
  id: string,
  input: TaskSeriesUpdateInput,
): Promise<TaskSeriesItem> {
  const atual = await prisma.taskSeries.findFirst({
    where: { id, userId },
    select: { ...CAMPOS_SERIE, updatedAt: true },
  });
  if (!atual) throw notFound("Série não encontrada");
  const time = input.time !== undefined ? input.time : atual.time;
  conferirHora(time);
  const recurrence = input.repeat
    ? { days: input.repeat.days, until: input.repeat.until ?? null }
    : null;
  if (recurrence) conferirRegra(recurrence, daColunaDate(atual.startDate));
  if (input.boardId) await conferirQuadro(userId, input.boardId);
  const hoje = await hojeDe(userId);
  const revisou =
    atual.aiGeneratedAt !== null &&
    ((input.title !== undefined && input.title.trim() !== atual.title) ||
      (input.descriptionMd !== undefined && input.descriptionMd !== atual.descriptionMd));

  await prisma
    .$transaction(async (tx) => {
      const novaLinha = await tx.taskSeries.updateManyAndReturn({
        where: { id, userId, updatedAt: atual.updatedAt },
        data: {
          ...(input.title !== undefined && { title: input.title.trim() }),
          ...(input.descriptionMd !== undefined && { descriptionMd: input.descriptionMd }),
          ...(input.time !== undefined && { time }),
          ...(input.boardId !== undefined && { boardId: input.boardId }),
          ...(recurrence && {
            repeatDays: [...recurrence.days].sort((a, b) => a - b),
            repeatUntil: recurrence.until ? paraColunaDate(recurrence.until) : null,
          }),
          ...(revisou && { aiRevisedAt: new Date() }),
          // O horizonte recomeça de ontem: as abertas de hoje em diante são refeitas.
          generatedThrough: paraColunaDate(somarDias(hoje, -1)),
        },
        select: CAMPOS_SERIE,
      });
      const serie = novaLinha[0];
      if (!serie) throw notFound("Série não encontrada");
      await tx.task.deleteMany({
        where: { seriesId: id, userId, completedAt: null, date: { gte: paraColunaDate(hoje) } },
      });
      await gerarOcorrencias(tx, serie, hoje, somarDias(hoje, HORIZONTE_DAS_SERIES_DIAS));
    })
    .catch(quadroQueSumiu);
  return buscarSerie(userId, id);
}

/**
 * A série para de se repetir **de hoje em diante**: as ocorrências abertas de
 * hoje para a frente saem, e a série some. As de antes de hoje e as
 * concluídas ficam, como tarefas avulsas (a FK solta).
 */
export async function encerrarSerie(userId: string, id: string): Promise<void> {
  const hoje = await hojeDe(userId);
  await prisma.$transaction(async (tx) => {
    // As abertas de hoje em diante saem enquanto ainda apontam para a série;
    // depois, a FK (`SetNull`) solta o que ficou.
    await tx.task.deleteMany({
      where: { seriesId: id, userId, completedAt: null, date: { gte: paraColunaDate(hoje) } },
    });
    const { count } = await tx.taskSeries.deleteMany({ where: { id, userId } });
    if (count === 0) throw notFound("Série não encontrada");
  });
}

/**
 * O relógio das séries: empurra o horizonte de toda série que ficou para
 * trás. Roda nas duas instâncias da API, e a geração é idempotente pelo único
 * `(series_id, date)` (INV-60). O "hoje" é o do UTC com um dia de folga: o
 * horizonte é largo, e um dia de diferença de fuso não importa.
 */
export async function estenderSeriesDeTarefas(agora: Date): Promise<number> {
  const hoje = agora.toISOString().slice(0, 10);
  const ate = somarDias(hoje, HORIZONTE_DAS_SERIES_DIAS + 1);
  // Folga de uma semana: o relógio não regrava toda série a cada volta.
  const candidatas = await prisma.taskSeries.findMany({
    where: { generatedThrough: { lt: paraColunaDate(somarDias(ate, -7)) } },
    select: CAMPOS_SERIE,
    take: 200,
  });
  // A série que já gerou até o próprio fim não tem o que estender.
  const atrasadas = candidatas.filter(
    (serie) => !serie.repeatUntil || serie.repeatUntil > serie.generatedThrough,
  );
  for (const serie of atrasadas) {
    const de = somarDias(daColunaDate(serie.generatedThrough), 1);
    await prisma.$transaction((tx) => gerarOcorrencias(tx, serie, de, ate));
  }
  return atrasadas.length;
}

/** Liga o relógio das séries: na subida e de hora em hora. */
export function vigiarSeriesDeTarefas(registro: {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}): () => void {
  const volta = () =>
    estenderSeriesDeTarefas(new Date()).then(
      (n) => {
        if (n > 0) registro.info({ series: n }, "séries de tarefa estendidas");
      },
      (erro: unknown) => registro.warn({ err: erro }, "extensão das séries de tarefa falhou"),
    );
  void volta();
  const relogio = setInterval(() => void volta(), 60 * 60_000);
  relogio.unref();
  return () => clearInterval(relogio);
}
