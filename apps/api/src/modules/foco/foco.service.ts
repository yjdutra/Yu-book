import { Prisma } from "@prisma/client";
import type { FocusSessionInput, FocusSessionItem, FocusSessionResult } from "@yu-book/shared";
import {
  FOLGA_DO_FOCO,
  MAX_DIAS_DO_HISTORICO,
  MAX_HORAS_DO_FOCO,
  diaLocal,
  diasEntre,
  ehDiaCivil,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { preferenciaDe } from "../assistente/preferencias.service.js";
import { CAMPOS_REGISTRO, paraRegistro } from "../habitos/habitos.service.js";
import { paraColunaDia } from "../habitos/vinculo.service.js";

/**
 * Foco — frente Ritmo, Ritmo 6 (docs/prd-ritmo.md, §9).
 *
 * O timer roda no aparelho; aqui chega só o pomodoro concluído (RN-35). A
 * sessão e o registro `focus` saem numa transação, e o `client_id` único por
 * usuário torna a gravação idempotente — o aparelho que repete o envio depois
 * de uma queda recebe a que ficou (RF-56).
 */

const invalido = (mensagem: string) => new AppError(422, "VALIDATION_ERROR", mensagem);
const paraDia = (data: Date) => data.toISOString().slice(0, 10);

const CAMPOS = {
  id: true,
  clientId: true,
  minutes: true,
  startedAt: true,
  endedAt: true,
  day: true,
  activity: { select: { id: true, name: true, habitId: true } },
  entry: { select: { points: true } },
} satisfies Prisma.FocusSessionSelect;

type Linha = Prisma.FocusSessionGetPayload<{ select: typeof CAMPOS }>;

function paraSessao(linha: Linha): FocusSessionItem {
  return {
    id: linha.id,
    clientId: linha.clientId,
    activity: linha.activity,
    minutes: linha.minutes,
    startedAt: linha.startedAt.toISOString(),
    endedAt: linha.endedAt.toISOString(),
    day: paraDia(linha.day),
    points: linha.entry?.points ?? 0,
  };
}

/** A sessão já gravada com este `clientId`, com o registro dela. */
async function existente(userId: string, clientId: string): Promise<FocusSessionResult | null> {
  const linha = await prisma.focusSession.findUnique({
    where: { userId_clientId: { userId, clientId } },
    select: { ...CAMPOS, entry: { select: CAMPOS_REGISTRO } },
  });
  if (!linha) return null;
  const { entry, ...resto } = linha;
  return {
    session: paraSessao({ ...resto, entry: entry ? { points: entry.points } : null }),
    entry: entry ? paraRegistro(entry) : null,
  };
}

/**
 * RF-56: grava o pomodoro concluído agora. Confere a duração (RN-36) e, se a
 * atividade pontua por pomodoro e está ativa (RN-37), grava o registro `focus`
 * com os pontos do momento (P5), no dia do fim, na mesma transação.
 */
export async function gravarSessao(
  userId: string,
  input: FocusSessionInput,
): Promise<FocusSessionResult & { criada: boolean }> {
  const ja = await existente(userId, input.clientId);
  if (ja) return { ...ja, criada: false };

  const agora = new Date();
  const inicio = new Date(input.startedAt);
  const decorrido = agora.getTime() - inicio.getTime();
  if (decorrido < input.minutes * 60_000 * FOLGA_DO_FOCO) {
    throw invalido("O foco ainda não durou o tempo dele");
  }
  if (decorrido > MAX_HORAS_DO_FOCO * 3_600_000) {
    throw invalido(`Foco de mais de ${MAX_HORAS_DO_FOCO} horas atrás não vale`);
  }

  const atividade = input.activityId
    ? await prisma.habitActivity.findFirst({
        where: { id: input.activityId, userId },
        select: {
          id: true,
          habitId: true,
          pointsPerPomodoro: true,
          archivedAt: true,
          habit: { select: { archivedAt: true } },
        },
      })
    : null;
  if (input.activityId && !atividade) throw notFound("Atividade não encontrada");

  const { timezone } = await preferenciaDe(userId);
  const dia = paraColunaDia(diaLocal(agora, timezone));
  const pontua =
    atividade?.pointsPerPomodoro && !atividade.archivedAt && !atividade.habit.archivedAt
      ? atividade.pointsPerPomodoro
      : null;

  try {
    await prisma.$transaction(async (tx) => {
      const sessao = await tx.focusSession.create({
        data: {
          userId,
          clientId: input.clientId,
          activityId: atividade?.id ?? null,
          habitId: atividade?.habitId ?? null,
          minutes: input.minutes,
          startedAt: inicio,
          endedAt: agora,
          day: dia,
        },
        select: { id: true },
      });
      if (atividade && pontua) {
        await tx.habitEntry.create({
          data: {
            userId,
            habitId: atividade.habitId,
            activityId: atividade.id,
            points: pontua,
            day: dia,
            origin: "focus",
            focusSessionId: sessao.id,
          },
        });
      }
    });
  } catch (erro) {
    // A corrida entre duas instâncias (INV-60) com o mesmo `clientId`: a
    // unique fecha, e a resposta é a que ficou.
    if (!(erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002")) {
      throw erro;
    }
  }
  const gravada = await existente(userId, input.clientId);
  if (!gravada) throw notFound("Sessão não encontrada");
  return { ...gravada, criada: true };
}

/** RF-57. Sem período, hoje. As mais recentes primeiro. */
export async function listarSessoes(
  userId: string,
  periodo: { from?: string; to?: string },
): Promise<FocusSessionItem[]> {
  const { timezone } = await preferenciaDe(userId);
  const hoje = diaLocal(new Date(), timezone);
  const ate = periodo.to ?? hoje;
  const de = periodo.from ?? ate;
  if (!ehDiaCivil(de) || !ehDiaCivil(ate)) throw invalido("Use datas que existam, AAAA-MM-DD");
  const dias = diasEntre(de, ate);
  if (dias < 0) throw invalido("O fim do período não pode ser antes do início");
  if (dias + 1 > MAX_DIAS_DO_HISTORICO) {
    throw invalido(`No máximo ${MAX_DIAS_DO_HISTORICO} dias por consulta`);
  }
  const linhas = await prisma.focusSession.findMany({
    where: { userId, day: { gte: paraColunaDia(de), lte: paraColunaDia(ate) } },
    select: CAMPOS,
    orderBy: { endedAt: "desc" },
  });
  return linhas.map(paraSessao);
}
