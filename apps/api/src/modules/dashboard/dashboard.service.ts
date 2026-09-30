import type { Prisma } from "@prisma/client";
import type { CardComPrazo, Dashboard, DashboardNextRun } from "@yu-book/shared";
import {
  JANELA_EXECUCOES_SEM_MARCO_HORAS,
  JANELA_PRAZOS_DIAS,
  LIMITE_EXECUCOES_NOVAS,
  LIMITE_LINKS,
  LIMITE_NOTAS,
  LIMITE_PRAZOS,
  PROXIMOS_HORARIOS,
} from "@yu-book/shared";
import { prisma } from "../../db.js";
import { CAMPOS_DA_MARCA, paraMarca } from "../../lib/marca.js";
import { CAMPOS_DO_RUN, listar as listarRotinas, paraRun } from "../assistente/rotinas.service.js";
import { listar as listarNotas } from "../notes/notes.service.js";

const CAMPOS_PRAZO = {
  id: true,
  title: true,
  dueDate: true,
  priority: true,
  column: { select: { name: true, board: { select: { id: true, name: true } } } },
  ...CAMPOS_DA_MARCA,
} satisfies Prisma.CardSelect;

type CardBruto = Prisma.CardGetPayload<{ select: typeof CAMPOS_PRAZO }>;

function toPrazo(card: CardBruto): CardComPrazo {
  return {
    id: card.id,
    title: card.title,
    // Só entram cards com prazo, então a data existe.
    dueDate: (card.dueDate as Date).toISOString(),
    priority: card.priority,
    boardId: card.column.board.id,
    boardName: card.column.board.name,
    columnName: card.column.name,
    ai: paraMarca(card),
  };
}

/**
 * O bloco Rotinas do Início (Etapa F). "Novas" é tudo o que terminou desde a
 * última vez que o Início as mostrou — de qualquer gatilho, e a falha e a
 * `pulada` inclusive: é o que faz nada falhar calado. `ate` é o corte, que o
 * Início devolve em `POST /ai/runs/seen`; sem ele, uma execução terminada
 * entre esta leitura e a marca sumiria sem ser vista.
 *
 * "Próximas" sai das próprias rotinas (`nextRuns`), já no fuso do dono e já
 * vazia para a pausada ou inválida — uma regra só para a galeria e o Início.
 */
async function rotinasDoInicio(userId: string, agora: Date): Promise<Dashboard["rotinas"]> {
  const preferencia = await prisma.aiPreference.findUnique({
    where: { userId },
    select: { runsSeenAt: true },
  });
  const vistoEm = preferencia?.runsSeenAt ?? null;
  const desde =
    vistoEm ?? new Date(agora.getTime() - JANELA_EXECUCOES_SEM_MARCO_HORAS * 60 * 60 * 1000);

  const [execucoes, rotinas] = await Promise.all([
    prisma.aiRoutineRun.findMany({
      where: { userId, endedAt: { gt: desde, lte: agora } },
      orderBy: [{ endedAt: "desc" }, { id: "desc" }],
      take: LIMITE_EXECUCOES_NOVAS,
      select: {
        ...CAMPOS_DO_RUN,
        outputCard: { select: { title: true, column: { select: { boardId: true } } } },
        outputNote: { select: { title: true } },
      },
    }),
    listarRotinas(userId),
  ]);

  const proximas: DashboardNextRun[] = rotinas
    .flatMap((r) => r.nextRuns.map((at) => ({ routineId: r.id, name: r.name, at })))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, PROXIMOS_HORARIOS);

  return {
    novas: execucoes.map(({ outputCard, outputNote, ...run }) => ({
      ...paraRun(run),
      outputBoardId: outputCard?.column.boardId ?? null,
      outputTitle: outputCard?.title ?? outputNote?.title ?? null,
    })),
    proximas,
    vistoEm: vistoEm?.toISOString() ?? null,
    ate: agora.toISOString(),
  };
}

/**
 * A tela inicial inteira em uma requisição (RF-04).
 *
 * As consultas são independentes e vão juntas: o custo da tela é o da mais
 * lenta, não a soma. Todas caem em índice que já existe — `card(due_date)`,
 * `note(user_id, deleted_at, updated_at DESC)` e
 * `link(user_id, kind, created_at DESC)` (RNF-02).
 */
export async function montar(userId: string, workspaceId?: string): Promise<Dashboard> {
  const agora = new Date();
  const limite = new Date(agora.getTime() + JANELA_PRAZOS_DIAS * 24 * 60 * 60 * 1000);

  // RF-11: card arquivado não cobra prazo de ninguém — e, desde a Parte 1 da
  // frente de cards, nem o concluído, que continua no quadro.
  const doUsuario: Prisma.CardWhereInput = {
    archived: false,
    completedAt: null,
    column: { board: { userId, ...(workspaceId && { workspaceId }) } },
  };

  const vencidosWhere = { ...doUsuario, dueDate: { lt: agora } };
  const proximosWhere = { ...doUsuario, dueDate: { gte: agora, lte: limite } };

  const [vencidos, proximos, totalVencidos, totalProximos, notas, totalLinks, antigos, rotinas] =
    await Promise.all([
      prisma.card.findMany({
        where: vencidosWhere,
        // RF-08: o mais atrasado primeiro — é o que mais cobra atenção.
        orderBy: { dueDate: "asc" },
        take: LIMITE_PRAZOS,
        select: CAMPOS_PRAZO,
      }),
      prisma.card.findMany({
        where: proximosWhere,
        orderBy: { dueDate: "asc" },
        take: LIMITE_PRAZOS,
        select: CAMPOS_PRAZO,
      }),
      prisma.card.count({ where: vencidosWhere }),
      prisma.card.count({ where: proximosWhere }),
      // Reaproveita a listagem de notas: mesmo recorte de campos e mesmo
      // trecho truncado no banco, então a home não traz corpo de nota (RNF-03).
      listarNotas(userId, {
        tags: [],
        sort: "updatedAt",
        limit: LIMITE_NOTAS,
        trash: "false",
        ...(workspaceId && { workspaceId }),
      }),
      prisma.link.count({ where: { userId, kind: "depois" } }),
      prisma.link.findMany({
        where: { userId, kind: "depois" },
        // RF-16: os mais antigos — os que estão apodrecendo na fila.
        orderBy: { createdAt: "asc" },
        take: LIMITE_LINKS,
      }),
      rotinasDoInicio(userId, agora),
    ]);

  return {
    prazos: {
      vencidos: vencidos.map(toPrazo),
      proximos: proximos.map(toPrazo),
      totalVencidos,
      totalProximos,
    },
    notas: notas.items,
    links: {
      total: totalLinks,
      antigos: antigos.map((l) => ({
        id: l.id,
        url: l.url,
        title: l.title,
        domain: l.domain,
        createdAt: l.createdAt.toISOString(),
        durationSeconds: l.durationSeconds,
      })),
    },
    rotinas,
  };
}
