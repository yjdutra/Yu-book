import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BoardSummary, NoteTitle, Tag, Workspace } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErroDeResource } from "../erros.js";

/**
 * Teto do catálogo. O acervo cabe inteiro hoje (16 notas), mas o custo cresce
 * linearmente: um item custa ~100 bytes só de id, título e tipo, porque o uuid
 * sozinho já tem 36 caracteres. A 500 notas o catálogo passaria de 50 KB, que
 * é contexto demais para um índice.
 *
 * Quando o teto corta, o resource **diz** que cortou — cap silencioso faz o
 * modelo concluir que o acervo é só aquilo.
 */
const TETO_DO_CATALOGO = 200;

/**
 * Resources diretos — os índices.
 *
 * A regra que decide o que vira resource direto e o que vira template:
 * **conjunto pequeno e limitado é listável; conteúdo que cresce sem limite
 * não é.** Workspace, board e tag são poucos por natureza. Nota não é — por
 * isso o catálogo devolve identificador e rótulo, e o corpo fica atrás de
 * `yubook://nota/{id}`.
 *
 * O custo de um resource direto cresce com a *quantidade* de itens, nunca com
 * o tamanho do conteúdo. É a mesma lição da Etapa 1, aplicada ao endereçamento:
 * listar não é listar conteúdo.
 *
 * O esquema fica em português porque não atravessa a API — quem lê é quem usa
 * o app. Nome de tool continua em inglês, como caminho de rota.
 */
export function registrarCatalogos(server: McpServer): void {
  server.registerResource(
    "notas",
    "yubook://notas",
    {
      title: "Catálogo de notas",
      description:
        "Índice de todas as notas ativas: id, título, tipo, workspace e quando foi alterada. " +
        "Não traz conteúdo — para ler uma nota, use yubook://nota/{id}.",
      mimeType: "application/json",
    },
    comErroDeResource(async (uri) => {
      // /notes/titles é o catálogo do servidor: custo fixo por item, sem corpo
      // e sem trecho. Percorrer /notes paginado traria o excerpt de cada nota
      // só para descartá-lo.
      const todas = await api.get<NoteTitle[]>("/notes/titles");
      // Já vem ordenado por atualização decrescente: o corte tira as mais
      // antigas, que é o que menos dói.
      const notas = todas.slice(0, TETO_DO_CATALOGO);

      /**
       * `workspaceName` e `updatedAt` entraram no contrato depois. A API em
       * produção pode ser mais velha que o contrato compilado aqui — o servidor
       * MCP e a API têm ciclos de deploy independentes, e este é o ponto onde
       * isso aparece. Omitimos o campo em vez de emitir `undefined`.
       */
      const catalogo = notas.map((n) => ({
        id: n.id,
        titulo: n.title,
        tipo: n.kind,
        ...(n.workspaceName != null && { workspace: n.workspaceName }),
        ...(n.updatedAt != null && { atualizadaEm: n.updatedAt }),
      }));

      const corpo =
        todas.length > notas.length
          ? { notas: catalogo, total: todas.length, aviso: `mostrando as ${notas.length} mais recentes de ${todas.length}` }
          : catalogo;

      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(corpo) },
        ],
      };
    }),
  );

  server.registerResource(
    "boards",
    "yubook://boards",
    {
      title: "Quadros kanban",
      description:
        "Índice dos quadros: id, nome, workspace e quantas colunas e cards cada um tem. " +
        "Para ver o quadro, use yubook://board/{id}.",
      mimeType: "application/json",
    },
    comErroDeResource(async (uri) => {
      const boards = await api.get<BoardSummary[]>("/boards");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              boards.map((b) => ({
                id: b.id,
                nome: b.name,
                workspace: b.workspaceName,
                colunas: b.columnCount,
                cards: b.cardCount,
              })),
            ),
          },
        ],
      };
    }),
  );

  server.registerResource(
    "tags",
    "yubook://tags",
    {
      title: "Tags",
      description: "Todas as tags, com quantas notas cada uma tem.",
      mimeType: "application/json",
    },
    comErroDeResource(async (uri) => {
      const tags = await api.get<Tag[]>("/tags");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(tags.map((t) => ({ nome: t.name, notas: t.noteCount }))),
          },
        ],
      };
    }),
  );

  server.registerResource(
    "workspaces",
    "yubook://workspaces",
    {
      title: "Workspaces",
      description:
        "Os workspaces e o que há em cada um. Workspace é contexto, não filtro: " +
        "ele atravessa notas, quadros e cards.",
      mimeType: "application/json",
    },
    comErroDeResource(async (uri) => {
      const workspaces = await api.get<Workspace[]>("/workspaces");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              workspaces.map((w) => ({
                id: w.id,
                nome: w.name,
                notas: w.noteCount,
                quadros: w.boardCount,
                cards: w.cardCount,
              })),
            ),
          },
        ],
      };
    }),
  );
}
