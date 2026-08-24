import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BoardDetail, NoteDetail } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErroDeResource } from "../erros.js";
import { formatarNota, formatarQuadro } from "../formato.js";

/**
 * Resource templates — o conteúdo, sob demanda.
 *
 * O identificador é o **uuid**, não o título. Renomear uma nota reescreve os
 * `[[…]]` das outras notas, mas não há como reescrever uma URI que já foi
 * injetada no contexto de alguém — então a identidade tem que ser estável.
 *
 * Estes templates devolvem exatamente o mesmo texto que as tools `get_note` e
 * `get_board`, porque chamam a mesma função de `formato.ts`. A duplicação seria
 * o mesmo recurso com duas caras; o que se duplica de propósito é a
 * **superfície**, não a implementação. Tool é o modelo decidindo buscar;
 * resource é o usuário anexando antes de perguntar.
 */
export function registrarConteudo(server: McpServer): void {
  server.registerResource(
    "nota",
    new ResourceTemplate("yubook://nota/{id}", { list: undefined }),
    {
      title: "Nota",
      description:
        "O conteúdo completo de uma nota, com tags, campos livres, as notas que a referenciam " +
        "e os cards vinculados. O id vem do catálogo yubook://notas.",
      mimeType: "text/markdown",
    },
    comErroDeResource(async (uri, { id }) => {
      const nota = await api.get<NoteDetail>(`/notes/${id}`);
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatarNota(nota) }],
      };
    }),
  );

  server.registerResource(
    "board",
    new ResourceTemplate("yubook://board/{id}", { list: undefined }),
    {
      title: "Quadro",
      description:
        "As colunas de um quadro na ordem, com a face dos cards. Cards arquivados não aparecem. " +
        "O id vem do catálogo yubook://boards.",
      mimeType: "text/markdown",
    },
    comErroDeResource(async (uri, { id }) => {
      const board = await api.get<BoardDetail>(`/boards/${id}`);
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatarQuadro(board) }],
      };
    }),
  );
}
