import type { Prisma } from "@prisma/client";
import type { HabitActivityRef } from "@yu-book/shared";
import { diaLocal } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import type { OrigemIA } from "../../lib/marca.js";
import { preferenciaDe } from "../assistente/preferencias.service.js";

/**
 * O vínculo de tarefa, série e evento com uma atividade de hábito (frente Ritmo,
 * RF-06), e o registro que a conclusão da tarefa grava (RF-07).
 *
 * Mora fora de `habitos.service` porque tarefas e eventos o importam, e
 * `habitos.service` importa eventos (o check-in confere a ocorrência lá): no
 * mesmo arquivo, o ciclo entregaria `CAMPOS_DO_VINCULO` ainda indefinido a quem
 * o espalha num `select` na carga do módulo.
 */

/** O recorte do vínculo nos `select` de tarefa e evento. */
export const CAMPOS_DO_VINCULO = {
  select: {
    id: true,
    name: true,
    points: true,
    habit: { select: { id: true, name: true } },
  },
} satisfies Prisma.HabitActivityDefaultArgs;

type LinhaDoVinculo = Prisma.HabitActivityGetPayload<typeof CAMPOS_DO_VINCULO>;

export function paraVinculo(linha: LinhaDoVinculo | null): HabitActivityRef | null {
  if (!linha) return null;
  return {
    id: linha.id,
    name: linha.name,
    points: linha.points,
    habitId: linha.habit.id,
    habitName: linha.habit.name,
  };
}

/**
 * A atividade que vem de fora, conferida contra o usuário (RN-11, INV-59): de
 * outra conta é a mesma resposta que inexistente (INV-02). Arquivada ainda se
 * vincula — só não pontua (RN-07).
 */
export async function conferirAtividade(userId: string, activityId: string): Promise<void> {
  const atividade = await prisma.habitActivity.findFirst({
    where: { id: activityId, userId },
    select: { id: true },
  });
  if (!atividade) throw notFound("Atividade não encontrada");
}

/// O dia de hoje no fuso do usuário (RN-05) — nunca o do processo.
export async function hojeDoUsuario(userId: string): Promise<string> {
  const { timezone } = await preferenciaDe(userId);
  return diaLocal(new Date(), timezone);
}

export const paraColunaDia = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

/**
 * A marca de quem registrou (RN-12), com as mesmas regras da marca de
 * conclusão (INV-63, `camposDaConclusao`): sem origem, o registro é humano.
 */
export function camposDoRegistro(origem: OrigemIA | undefined) {
  return {
    aiVia: origem?.via ?? null,
    aiAuthor: origem?.author ?? null,
    aiAgentName: origem && origem.via !== "mcp" ? (origem.agentName ?? null) : null,
  };
}

/**
 * RF-07: o registro que acompanha a conclusão da tarefa, **na transação dela**.
 * Só se chama quando o estado mudou de fato (o `updateMany` condicional de
 * `concluirTarefa` achou a linha): concluir de novo não passa por aqui.
 *
 * - Concluir: grava os pontos da atividade **de agora** (RN-03), no dia de hoje
 *   do usuário. Atividade ou hábito arquivados não pontuam (RN-07).
 *   `skipDuplicates` sobre o `task_id` único (RN-04) fecha a corrida entre as
 *   duas instâncias da API (INV-60), que o `updateMany` sozinho já fecharia.
 * - Reabrir: apaga o registro da tarefa, se houver.
 */
export async function pontuarConclusao(
  tx: Prisma.TransactionClient,
  pedido: {
    userId: string;
    taskId: string;
    completed: boolean;
    hoje: string;
    origem?: OrigemIA;
  },
): Promise<void> {
  const { userId, taskId } = pedido;
  if (!pedido.completed) {
    await tx.habitEntry.deleteMany({ where: { taskId, userId } });
    return;
  }
  const tarefa = await tx.task.findFirst({
    where: { id: taskId, userId },
    select: {
      habitActivity: {
        select: {
          id: true,
          points: true,
          habitId: true,
          archivedAt: true,
          habit: { select: { archivedAt: true } },
        },
      },
    },
  });
  const atividade = tarefa?.habitActivity;
  if (!atividade || atividade.archivedAt || atividade.habit.archivedAt) return;
  await tx.habitEntry.createMany({
    data: [
      {
        userId,
        habitId: atividade.habitId,
        activityId: atividade.id,
        points: atividade.points,
        day: paraColunaDia(pedido.hoje),
        origin: "task",
        taskId,
        ...camposDoRegistro(pedido.origem),
      },
    ],
    skipDuplicates: true,
  });
}
