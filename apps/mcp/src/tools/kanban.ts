import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BoardDetail, BoardSummary } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErro } from "../erros.js";
import { formatarCard } from "../formato.js";

export function registrarToolsDeKanban(server: McpServer): void {
  server.registerTool(
    "list_boards",
    {
      title: "Listar os quadros",
      description:
        "Lista os quadros kanban do usuário, com o workspace a que pertencem e quantas colunas e " +
        "cards cada um tem. Use para descobrir o id de um quadro antes de chamar `get_board`.",
      inputSchema: {
        workspaceId: z
          .string()
          .uuid()
          .optional()
          .describe("Restringe a um workspace. Omita para ver todos."),
      },
    },
    comErro(async ({ workspaceId }) => {
      const busca = new URLSearchParams();
      if (workspaceId) busca.set("workspaceId", workspaceId);

      const boards = await api.get<BoardSummary[]>("/boards", busca);

      if (boards.length === 0) {
        return { content: [{ type: "text", text: "Nenhum quadro encontrado." }] };
      }

      const linhas = boards.map(
        (b) =>
          `- **${b.name}** — workspace ${b.workspaceName} · ${b.columnCount} coluna(s) · ` +
          `${b.cardCount} card(s)\n  id: ${b.id}`,
      );
      return { content: [{ type: "text", text: linhas.join("\n") }] };
    }),
  );

  server.registerTool(
    "get_board",
    {
      title: "Ver um quadro inteiro",
      description:
        "Devolve as colunas de um quadro na ordem, com os cards de cada uma — título, prazo, " +
        "prioridade, progresso do checklist e nota vinculada. Cards arquivados não aparecem. " +
        "A descrição do card não vem aqui: o quadro é uma visão de superfície.",
      inputSchema: {
        id: z.string().uuid().describe("Id do quadro, como devolvido por list_boards."),
      },
    },
    comErro(async ({ id }) => {
      const board = await api.get<BoardDetail>(`/boards/${id}`);

      const linhas = [`# ${board.name}`, `workspace: ${board.workspaceName}`, ""];

      for (const coluna of board.columns) {
        // O limite de WIP avisa e não bloqueia (INV-15) — informamos como o
        // quadro informa, sem sugerir que estourar seja erro.
        const wip = coluna.wipLimit ? ` [${coluna.cards.length}/${coluna.wipLimit}]` : "";
        linhas.push(`## ${coluna.name}${wip}`);
        linhas.push(
          coluna.cards.length
            ? coluna.cards.map(formatarCard).join("\n")
            : "_(vazia)_",
        );
        linhas.push("");
      }

      if (board.archivedCount > 0) {
        linhas.push(`_${board.archivedCount} card(s) arquivado(s), fora do quadro._`);
      }

      return { content: [{ type: "text", text: linhas.join("\n") }] };
    }),
  );
}
