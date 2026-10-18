import { Prisma } from "@prisma/client";
import type { TaskInput, TaskItem, TasksQuery, TaskUpdateInput } from "@yu-book/shared";
import {
  HORA_DA_AGENDA,
  LIMITE_TAREFAS_CONCLUIDAS,
  LIMITE_TAREFAS_SEM_DATA,
  diaLocal,
  ehDiaCivil,
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
    overdue: linha.completedAt === null && date !== null && date < hoje,
    completedAt: linha.completedAt?.toISOString() ?? null,
    completion: paraConclusao(linha),
    board: linha.board,
    ai: paraMarca(linha),
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

  const abertas = () =>
    prisma.task.findMany({
      where: { ...base, completedAt: null },
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
    select: { title: true, descriptionMd: true, date: true, time: true, aiGeneratedAt: true },
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

  const { count } = await prisma.task
    .updateMany({
      where: { id, userId },
      data: {
        ...(input.title !== undefined && { title: input.title.trim() }),
        ...(input.descriptionMd !== undefined && { descriptionMd: input.descriptionMd }),
        ...((input.date !== undefined || input.time !== undefined) && {
          date: dataDaColuna,
          time,
        }),
        ...(input.boardId !== undefined && { boardId: input.boardId }),
        ...(revisou && { aiRevisedAt: new Date() }),
      },
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

export async function excluirTarefa(userId: string, id: string): Promise<void> {
  const { count } = await prisma.task.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Tarefa não encontrada");
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
    where: { userId, completedAt: null, date: { lt: paraColunaDate(antesDe) } },
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
