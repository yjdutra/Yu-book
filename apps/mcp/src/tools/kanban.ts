import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BoardDetail, BoardSummary, Dashboard } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErro } from "../erros.js";
import { formatarDashboard, formatarQuadro } from "../formato.js";

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
        "prioridade, progresso do checklist, tags e nota vinculada. As tags agrupam cards por " +
        "assunto, num eixo independente da coluna. Cards arquivados não aparecem. " +
        "A descrição do card não vem aqui: o quadro é uma visão de superfície.",
      inputSchema: {
        id: z.string().uuid().describe("Id do quadro, como devolvido por list_boards."),
      },
    },
    comErro(async ({ id }) => {
      const board = await api.get<BoardDetail>(`/boards/${id}`);
      return { content: [{ type: "text", text: formatarQuadro(board) }] };
    }),
  );

  server.registerTool(
    "get_dashboard",
    {
      title: "O que precisa de atenção agora",
      description:
        "Devolve o agregado da tela inicial numa requisição só: prazos vencidos, prazos dos " +
        "próximos 7 dias, notas editadas recentemente e o tamanho da fila de links. É a fonte " +
        "dos prompts de revisão — prefira esta tool a montar o mesmo recorte com várias chamadas.",
      inputSchema: {
        workspaceId: z
          .string()
          .uuid()
          .optional()
          .describe("Restringe prazos e notas a um workspace. A fila de links nunca é filtrada."),
      },
    },
    comErro(async ({ workspaceId }) => {
      const busca = new URLSearchParams();
      if (workspaceId) busca.set("workspaceId", workspaceId);
      const dados = await api.get<Dashboard>("/dashboard", busca);
      return { content: [{ type: "text", text: formatarDashboard(dados) }] };
    }),
  );
}
