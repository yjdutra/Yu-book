import { Prisma } from "@prisma/client";
import type {
  EmblemaDoHabito,
  HabitActivityInput,
  HabitActivityItem,
  HabitActivityUpdateInput,
  HabitColor,
  HabitEntryInput,
  HabitEntryItem,
  HabitInput,
  HabitItem,
  HabitsSummary,
  HabitUpdateInput,
} from "@yu-book/shared";
import {
  MAX_DIAS_DO_HISTORICO,
  MAX_DIAS_RETROATIVOS,
  MAX_PONTOS,
  diasEntre,
  ehDiaCivil,
  inicioDaSemana,
  nivelDoXp,
  semanaPonderada,
  somarDias,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import type { OrigemIA } from "../../lib/marca.js";
import { conferirOcorrencia } from "../eventos/eventos.service.js";
import { camposDoRegistro, hojeDoUsuario, paraColunaDia } from "./vinculo.service.js";

/**
 * Hábitos — frente Ritmo, Ritmo 1 (docs/prd-ritmo.md).
 *
 * Posse direta por `user_id` em hábito, atividade e registro (INV-01): toda
 * consulta e toda escrita levam o escopo no `where` (INV-04), e o que vem de
 * fora apontando para outra linha é conferido contra o usuário (INV-59).
 * Semana, XP e ofensivas não se gravam: saem dos registros na leitura (P3).
 */

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);
/// Sem código próprio em `ERROR_CODES`: o 409 com `VALIDATION_ERROR` tem
/// precedente (`eventos.service.ts`, `mudouDuranteAEdicao`).
const arquivado = (mensagem: string) => new AppError(409, "VALIDATION_ERROR", mensagem);

const paraDia = (data: Date) => data.toISOString().slice(0, 10);

/** RN-02: o nome repetido chega do banco como `P2002` na unique. */
function nomeRepetido(o: string) {
  return (erro: unknown): never => {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      throw new AppError(409, "NOME_DUPLICADO", `Já existe ${o} com esse nome`);
    }
    throw erro;
  };
}

/* ------------------------------------------------------------- leitura */

const CAMPOS_ATIVIDADE = {
  id: true,
  habitId: true,
  name: true,
  points: true,
  position: true,
  archivedAt: true,
} satisfies Prisma.HabitActivitySelect;

const ORDEM = [{ position: "asc" }, { createdAt: "asc" }] as const;

const CAMPOS_HABITO = {
  id: true,
  name: true,
  color: true,
  emblem: true,
  weeklyGoal: true,
  targetDays: true,
  position: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  activities: { select: CAMPOS_ATIVIDADE, orderBy: [...ORDEM] },
} satisfies Prisma.HabitSelect;

type LinhaHabito = Prisma.HabitGetPayload<{ select: typeof CAMPOS_HABITO }>;
type LinhaAtividade = Prisma.HabitActivityGetPayload<{ select: typeof CAMPOS_ATIVIDADE }>;

function paraAtividade(linha: LinhaAtividade): HabitActivityItem {
  return {
    id: linha.id,
    habitId: linha.habitId,
    name: linha.name,
    points: linha.points,
    position: linha.position,
    archived: linha.archivedAt !== null,
  };
}

/**
 * Os hábitos com a semana de `hoje`. Uma consulta de registros para todos
 * (RNF-05), não uma por hábito.
 */
async function comSemana(userId: string, linhas: LinhaHabito[]): Promise<HabitItem[]> {
  const hoje = await hojeDoUsuario(userId);
  const inicio = inicioDaSemana(hoje);
  const registros = linhas.length
    ? await prisma.habitEntry.findMany({
        where: {
          userId,
          habitId: { in: linhas.map((h) => h.id) },
          day: { gte: paraColunaDia(inicio), lte: paraColunaDia(somarDias(inicio, 6)) },
        },
        select: { habitId: true, day: true, points: true },
      })
    : [];
  return linhas.map((linha) => ({
    id: linha.id,
    name: linha.name,
    // O schema só deixa entrar o catálogo; a coluna é texto para o catálogo
    // crescer sem migration.
    color: linha.color as HabitColor,
    emblem: linha.emblem as EmblemaDoHabito,
    weeklyGoal: linha.weeklyGoal,
    targetDays: linha.targetDays,
    position: linha.position,
    archived: linha.archivedAt !== null,
    activities: linha.activities.map(paraAtividade),
    week: semanaPonderada(
      linha,
      registros
        .filter((r) => r.habitId === linha.id)
        .map((r) => ({ day: paraDia(r.day), points: r.points })),
      hoje,
    ),
    createdAt: linha.createdAt.toISOString(),
    updatedAt: linha.updatedAt.toISOString(),
  }));
}

/** RF-04. Arquivados só sob pedido. */
export async function listarHabitos(
  userId: string,
  includeArchived: boolean,
): Promise<HabitItem[]> {
  const linhas = await prisma.habit.findMany({
    where: { userId, ...(!includeArchived && { archivedAt: null }) },
    select: CAMPOS_HABITO,
    orderBy: [...ORDEM],
  });
  return comSemana(userId, linhas);
}

export async function buscarHabito(userId: string, id: string): Promise<HabitItem> {
  const linha = await prisma.habit.findFirst({ where: { id, userId }, select: CAMPOS_HABITO });
  if (!linha) throw notFound("Hábito não encontrado");
  const [item] = await comSemana(userId, [linha]);
  return item as HabitItem;
}

/**
 * RF-31 (Ritmo 2): o XP total, o da semana e o nível. Duas somas no banco, sem
 * agregado gravado (P3). Entra todo registro do usuário, de hábito arquivado
 * também (RN-14); o de hábito excluído já saiu com ele (RN-08).
 */
export async function resumirRitmo(userId: string): Promise<HabitsSummary> {
  const hoje = await hojeDoUsuario(userId);
  const [total, semana] = await Promise.all([
    prisma.habitEntry.aggregate({ where: { userId }, _sum: { points: true } }),
    prisma.habitEntry.aggregate({
      where: { userId, day: { gte: paraColunaDia(inicioDaSemana(hoje)) } },
      _sum: { points: true },
    }),
  ]);
  const xp = total._sum.points ?? 0;
  return { today: hoje, xp, weekXp: semana._sum.points ?? 0, level: nivelDoXp(xp) };
}

/* ------------------------------------------------------------- hábitos */

/** RF-01: o hábito e as atividades iniciais numa transação só. */
export async function criarHabito(userId: string, input: HabitInput): Promise<HabitItem> {
  const posicao = await prisma.habit.count({ where: { userId } });
  const { id } = await prisma.habit
    .create({
      data: {
        userId,
        name: input.name.trim(),
        color: input.color ?? "violeta",
        emblem: input.emblem ?? "estrela",
        weeklyGoal: input.weeklyGoal,
        targetDays: input.targetDays,
        position: posicao,
        activities: {
          create: (input.activities ?? []).map((a, i) => ({
            userId,
            name: a.name.trim(),
            points: a.points,
            position: i,
          })),
        },
      },
      select: { id: true },
    })
    .catch(nomeRepetido("um hábito"));
  return buscarHabito(userId, id);
}

/** RF-02 e RF-05. `archived` vira `archived_at` (RN-07). */
export async function atualizarHabito(
  userId: string,
  id: string,
  input: HabitUpdateInput,
): Promise<HabitItem> {
  const { count } = await prisma.habit
    .updateMany({
      where: { id, userId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.emblem !== undefined && { emblem: input.emblem }),
        ...(input.weeklyGoal !== undefined && { weeklyGoal: input.weeklyGoal }),
        ...(input.targetDays !== undefined && { targetDays: input.targetDays }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.archived !== undefined && { archivedAt: input.archived ? new Date() : null }),
      },
    })
    .catch(nomeRepetido("um hábito"));
  if (count === 0) throw notFound("Hábito não encontrado");
  return buscarHabito(userId, id);
}

/** RN-08: leva atividades e registros; os vínculos de tarefa e evento se soltam. */
export async function excluirHabito(userId: string, id: string): Promise<void> {
  const { count } = await prisma.habit.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Hábito não encontrado");
}

/* ------------------------------------------------------------- atividades */

async function habitoDoUsuario(userId: string, habitId: string) {
  const habito = await prisma.habit.findFirst({
    where: { id: habitId, userId },
    select: { id: true, archivedAt: true },
  });
  if (!habito) throw notFound("Hábito não encontrado");
  return habito;
}

/** RF-03. */
export async function criarAtividade(
  userId: string,
  habitId: string,
  input: HabitActivityInput,
): Promise<HabitActivityItem> {
  await habitoDoUsuario(userId, habitId);
  const posicao = await prisma.habitActivity.count({ where: { habitId, userId } });
  const linha = await prisma.habitActivity
    .create({
      data: { habitId, userId, name: input.name.trim(), points: input.points, position: posicao },
      select: CAMPOS_ATIVIDADE,
    })
    .catch(nomeRepetido("uma atividade neste hábito"));
  return paraAtividade(linha);
}

/** RF-03 e RF-05. Mudar `points` não reescreve registros antigos (RN-03). */
export async function atualizarAtividade(
  userId: string,
  id: string,
  input: HabitActivityUpdateInput,
): Promise<HabitActivityItem> {
  const { count } = await prisma.habitActivity
    .updateMany({
      where: { id, userId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.points !== undefined && { points: input.points }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.archived !== undefined && { archivedAt: input.archived ? new Date() : null }),
      },
    })
    .catch(nomeRepetido("uma atividade neste hábito"));
  if (count === 0) throw notFound("Atividade não encontrada");
  const linha = await prisma.habitActivity.findFirst({
    where: { id, userId },
    select: CAMPOS_ATIVIDADE,
  });
  if (!linha) throw notFound("Atividade não encontrada");
  return paraAtividade(linha);
}

/** RN-08: os registros ficam, sem atividade; tarefa, série e evento se soltam. */
export async function excluirAtividade(userId: string, id: string): Promise<void> {
  const { count } = await prisma.habitActivity.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound("Atividade não encontrada");
}

/* ------------------------------------------------------------- registros */

const CAMPOS_REGISTRO = {
  id: true,
  habitId: true,
  activity: { select: { id: true, name: true } },
  points: true,
  day: true,
  origin: true,
  note: true,
  taskId: true,
  eventId: true,
  aiVia: true,
  aiAuthor: true,
  aiAgentName: true,
  createdAt: true,
} satisfies Prisma.HabitEntrySelect;

type LinhaRegistro = Prisma.HabitEntryGetPayload<{ select: typeof CAMPOS_REGISTRO }>;

function paraRegistro(linha: LinhaRegistro): HabitEntryItem {
  return {
    id: linha.id,
    habitId: linha.habitId,
    activity: linha.activity,
    points: linha.points,
    day: paraDia(linha.day),
    origin: linha.origin,
    note: linha.note,
    taskId: linha.taskId,
    eventId: linha.eventId,
    ai: linha.aiVia
      ? { via: linha.aiVia, author: linha.aiAuthor, agentName: linha.aiAgentName }
      : null,
    createdAt: linha.createdAt.toISOString(),
  };
}

/** RF-11. Sem período, os últimos 30 dias até hoje. Mais recentes primeiro. */
export async function listarRegistros(
  userId: string,
  habitId: string,
  periodo: { from?: string; to?: string },
): Promise<HabitEntryItem[]> {
  await habitoDoUsuario(userId, habitId);
  const hoje = await hojeDoUsuario(userId);
  const ate = periodo.to ?? hoje;
  // A janela padrão alcança o registro mais antigo que o avulso aceita (RN-06).
  const de = periodo.from ?? somarDias(ate, -MAX_DIAS_RETROATIVOS);
  const dias = diasEntre(de, ate);
  if (dias < 0) throw invalido("O fim do período não pode ser antes do início");
  // O schema só confere a janela com os dois lados; com um só, o outro é daqui.
  if (dias + 1 > MAX_DIAS_DO_HISTORICO) {
    throw invalido(`No máximo ${MAX_DIAS_DO_HISTORICO} dias por consulta`);
  }
  const linhas = await prisma.habitEntry.findMany({
    where: { userId, habitId, day: { gte: paraColunaDia(de), lte: paraColunaDia(ate) } },
    select: CAMPOS_REGISTRO,
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
  });
  return linhas.map(paraRegistro);
}

/**
 * RF-09: registro fora do plano. A atividade, se vier, é do hábito e está
 * ativa; os pontos são os dela, a menos que o pedido diga outro valor. O dia
 * fica entre hoje e 30 dias atrás (RN-06), conferido aqui e não no schema —
 * só o servidor sabe que dia é hoje para o usuário, e o chat chama direto.
 */
export async function registrarAvulso(
  userId: string,
  habitId: string,
  input: Omit<HabitEntryInput, "origin">,
  origem?: OrigemIA,
): Promise<HabitEntryItem> {
  const habito = await habitoDoUsuario(userId, habitId);
  if (habito.archivedAt) throw arquivado("Hábito arquivado não recebe registro");

  let pontos = input.points;
  let activityId: string | null = null;
  if (input.activityId) {
    const atividade = await prisma.habitActivity.findFirst({
      where: { id: input.activityId, habitId, userId },
      select: { id: true, points: true, archivedAt: true },
    });
    if (!atividade) throw notFound("Atividade não encontrada");
    if (atividade.archivedAt) throw arquivado("Atividade arquivada não recebe registro");
    activityId = atividade.id;
    pontos ??= atividade.points;
  }
  // O schema confere; o chat chama o service com o que o modelo escreveu.
  if (pontos === undefined || !Number.isInteger(pontos) || pontos < 1 || pontos > MAX_PONTOS) {
    throw invalido(`Pontos de 1 a ${MAX_PONTOS}`);
  }

  const hoje = await hojeDoUsuario(userId);
  const dia = input.day ?? hoje;
  if (!ehDiaCivil(dia)) throw invalido("Use uma data que exista, no formato AAAA-MM-DD");
  const atras = diasEntre(dia, hoje);
  if (atras < 0) throw invalido("Registro no futuro não vale");
  if (atras > MAX_DIAS_RETROATIVOS) {
    throw invalido(`Registro de no máximo ${MAX_DIAS_RETROATIVOS} dias atrás`);
  }

  const linha = await prisma.habitEntry.create({
    data: {
      userId,
      habitId,
      activityId,
      points: pontos,
      day: paraColunaDia(dia),
      origin: "manual",
      note: input.note?.trim() || null,
      ...camposDoRegistro(origem),
    },
    select: CAMPOS_REGISTRO,
  });
  return paraRegistro(linha);
}

/**
 * RN-10: o registro avulso se exclui por aqui; o de tarefa ou de check-in, só
 * quando a origem sumiu (tarefa ou evento excluídos, RN-09) — aí não há mais
 * por onde desfazê-lo.
 */
export async function excluirRegistro(userId: string, id: string): Promise<void> {
  const { count } = await prisma.habitEntry.deleteMany({
    where: {
      id,
      userId,
      OR: [
        { origin: "manual" },
        { origin: "task", taskId: null },
        { origin: "event", eventId: null },
      ],
    },
  });
  if (count > 0) return;
  const existe = await prisma.habitEntry.findFirst({
    where: { id, userId },
    select: { origin: true },
  });
  if (!existe) throw notFound("Registro não encontrado");
  throw invalido(
    existe.origin === "task"
      ? "Esse registro veio de uma tarefa: reabra a tarefa para desfazê-lo"
      : "Esse registro veio de um check-in: tire o check-in do evento para desfazê-lo",
  );
}

/* ------------------------------------------------------------- check-in */

/**
 * RF-08: o check-in na ocorrência `dia` de um evento com atividade. O dia
 * precisa ser uma ocorrência de verdade e não pode estar no futuro. Repetir
 * não duplica (RN-04): `skipDuplicates` sobre `(event_id, day)` fecha a corrida
 * entre as duas instâncias (INV-60), e a resposta é o registro que ficou.
 */
export async function fazerCheckIn(
  userId: string,
  eventId: string,
  dia: string,
  origem?: OrigemIA,
): Promise<HabitEntryItem> {
  const hoje = await hojeDoUsuario(userId);
  if (diasEntre(dia, hoje) < 0) throw invalido("Check-in no futuro não vale");
  const evento = await conferirOcorrencia(userId, eventId, dia);
  if (!evento.habitActivityId) throw invalido("Esse evento não está ligado a um hábito");
  const atividade = await prisma.habitActivity.findFirst({
    where: { id: evento.habitActivityId, userId },
    select: { id: true, points: true, habitId: true, archivedAt: true, habit: { select: { archivedAt: true } } },
  });
  if (!atividade) throw notFound("Atividade não encontrada");
  if (atividade.archivedAt || atividade.habit.archivedAt) {
    throw arquivado("Hábito ou atividade arquivados não recebem registro");
  }
  await prisma.habitEntry.createMany({
    data: [
      {
        userId,
        habitId: atividade.habitId,
        activityId: atividade.id,
        points: atividade.points,
        day: paraColunaDia(dia),
        origin: "event",
        eventId,
        ...camposDoRegistro(origem),
      },
    ],
    skipDuplicates: true,
  });
  const linha = await prisma.habitEntry.findFirst({
    where: { userId, eventId, day: paraColunaDia(dia) },
    select: CAMPOS_REGISTRO,
  });
  if (!linha) throw notFound("Registro não encontrado");
  return paraRegistro(linha);
}

/** RF-08: desfaz o check-in. Sem check-in, nada a fazer — idempotente. */
export async function desfazerCheckIn(userId: string, eventId: string, dia: string): Promise<void> {
  const evento = await prisma.event.findFirst({ where: { id: eventId, userId }, select: { id: true } });
  if (!evento) throw notFound("Evento não encontrado");
  await prisma.habitEntry.deleteMany({
    where: { userId, eventId, day: paraColunaDia(dia), origin: "event" },
  });
}
