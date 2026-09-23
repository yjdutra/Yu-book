import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FERRAMENTAS_DO_ACERVO,
  formatarDashboard,
  formatarListaDeQuadros,
  formatarQuadro,
} from "@yu-book/shared";
import type { BoardDetail, BoardSummary, Dashboard } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErro } from "../erros.js";
import { fusoDoUsuario } from "../fuso.js";

/** Os handlers; o metadado vem de `FERRAMENTAS_DO_ACERVO`. Ver `tools/notas.ts`. */
export function registrarToolsDeKanban(server: McpServer): void {
  const lista = FERRAMENTAS_DO_ACERVO.list_boards;
  server.registerTool(
    "list_boards",
    { title: lista.titulo, description: lista.descricao, inputSchema: lista.entrada },
    comErro(async ({ workspaceId }) => {
      const parametros = new URLSearchParams();
      if (workspaceId) parametros.set("workspaceId", workspaceId);

      const boards = await api.get<BoardSummary[]>("/boards", parametros);
      return { content: [{ type: "text", text: formatarListaDeQuadros(boards) }] };
    }),
  );

  const quadro = FERRAMENTAS_DO_ACERVO.get_board;
  server.registerTool(
    "get_board",
    { title: quadro.titulo, description: quadro.descricao, inputSchema: quadro.entrada },
    comErro(async ({ id }) => {
      // As duas em paralelo: o fuso não depende do quadro, e serializá-las
      // somaria uma ida à rede ao tempo de resposta da tool.
      const [board, fuso] = await Promise.all([
        api.get<BoardDetail>(`/boards/${id}`),
        fusoDoUsuario(),
      ]);
      return { content: [{ type: "text", text: formatarQuadro(board, fuso) }] };
    }),
  );

  const painel = FERRAMENTAS_DO_ACERVO.get_dashboard;
  server.registerTool(
    "get_dashboard",
    { title: painel.titulo, description: painel.descricao, inputSchema: painel.entrada },
    comErro(async ({ workspaceId }) => {
      const parametros = new URLSearchParams();
      if (workspaceId) parametros.set("workspaceId", workspaceId);
      const [dados, fuso] = await Promise.all([
        api.get<Dashboard>("/dashboard", parametros),
        fusoDoUsuario(),
      ]);
      return { content: [{ type: "text", text: formatarDashboard(dados, fuso) }] };
    }),
  );
}
