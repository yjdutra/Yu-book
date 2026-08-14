import type { Prisma } from "@prisma/client";
import type { CardComPrazo, Dashboard } from "@yu-book/shared";
import { JANELA_PRAZOS_DIAS, LIMITE_LINKS, LIMITE_NOTAS, LIMITE_PRAZOS } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { listar as listarNotas } from "../notes/notes.service.js";

const CAMPOS_PRAZO = {
  id: true,
  title: true,
  dueDate: true,
  priority: true,
  column: { select: { name: true, board: { select: { id: true, name: true } } } },
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

  // RF-11: card arquivado não cobra prazo de ninguém.
  const doUsuario: Prisma.CardWhereInput = {
    archived: false,
    column: { board: { userId, ...(workspaceId && { workspaceId }) } },
  };

  const vencidosWhere = { ...doUsuario, dueDate: { lt: agora } };
  const proximosWhere = { ...doUsuario, dueDate: { gte: agora, lte: limite } };

  const [vencidos, proximos, totalVencidos, totalProximos, notas, totalLinks, antigos] =
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
      })),
    },
  };
}
