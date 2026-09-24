import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FERRAMENTAS_DO_ACERVO, formatarBusca, formatarNota } from "@yu-book/shared";
import type { NoteDetail, SearchResponse } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErro } from "../erros.js";
import { fusoDoUsuario } from "../fuso.js";

/**
 * O metadado das tools — nome, título, descrição e schema — vem de
 * `FERRAMENTAS_DO_ACERVO`, em `packages/shared`. Aqui ficam só os handlers.
 *
 * A separação é o que sustenta "uma definição, dois consumidores": o chat
 * interno da `apps/api` oferece estas mesmas ações ao provedor, e ele chama os
 * services direto enquanto este servidor fala HTTP com a API. O que os dois
 * **precisam** ter igual é o contrato que o modelo lê; o caminho até o dado,
 * não.
 */
export function registrarToolsDeNotas(server: McpServer): void {
  const busca = FERRAMENTAS_DO_ACERVO.search_notes;
  server.registerTool(
    "search_notes",
    { title: busca.titulo, description: busca.descricao, inputSchema: busca.entrada },
    comErro(async ({ q, limit }) => {
      const parametros = new URLSearchParams({ q, limit: String(limit) });
      const dados = await api.get<SearchResponse>("/search", parametros);
      return { content: [{ type: "text", text: formatarBusca(dados, q) }] };
    }),
  );

  const nota = FERRAMENTAS_DO_ACERVO.get_note;
  server.registerTool(
    "get_note",
    { title: nota.titulo, description: nota.descricao, inputSchema: nota.entrada },
    comErro(async ({ id }) => {
      // O fuso só data a linha da marca de IA: na leitura ele recua, e em
      // paralelo porque não decide nada do que se pede à API.
      const [dados, fuso] = await Promise.all([
        api.get<NoteDetail>(`/notes/${id}`),
        fusoDoUsuario(),
      ]);
      return { content: [{ type: "text", text: formatarNota(dados, fuso) }] };
    }),
  );
}
