import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseSearchQuery } from "@yu-book/shared";
import type { NoteDetail, SearchResponse } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErro } from "../erros.js";
import { formatarNota, formatarResultado } from "../formato.js";

/**
 * Nome de tool é fronteira, como caminho de rota — daí o inglês, igual a
 * `/notes` e `/boards`. O que é interno continua em português.
 */
export function registrarToolsDeNotas(server: McpServer): void {
  server.registerTool(
    "search_notes",
    {
      title: "Buscar notas e cards",
      description:
        "Busca no segundo cérebro do usuário e devolve apenas trechos — nunca o corpo das notas. " +
        "Ignora acento e aplica stemming em português (`programacao` acha `programação`); quando " +
        "não há resultado exato, cai numa busca aproximada por semelhança de título. Aceita " +
        "filtros dentro do próprio texto: `tipo:aula`, `tipo:card`, `tag:jwt` e `#workspace`. " +
        "Use para descobrir o que existe; depois chame `get_note` para ler uma nota inteira.",
      inputSchema: {
        q: z
          .string()
          .min(1)
          .max(200)
          .describe("Termo de busca. Pode conter tipo:aula, tag:jwt ou #workspace."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(8)
          .describe("Quantos resultados no máximo. Mantenha baixo: cada um custa contexto."),
      },
    },
    comErro(async ({ q, limit }) => {
      const busca = new URLSearchParams({ q, limit: String(limit) });
      const dados = await api.get<SearchResponse>("/search", busca);

      if (dados.results.length === 0) {
        // Devolver o que foi entendido evita que o modelo repita a mesma busca
        // achando que errou a sintaxe.
        const f = parseSearchQuery(q);
        const aplicados = [
          f.kind && `tipo:${f.kind}`,
          f.card && "tipo:card",
          f.tag && `tag:${f.tag}`,
          f.workspace && `#${f.workspace}`,
        ].filter(Boolean);
        return {
          content: [
            {
              type: "text",
              text:
                `Nenhum resultado para "${f.text || q}".` +
                (aplicados.length ? ` Filtros aplicados: ${aplicados.join(", ")}.` : ""),
            },
          ],
        };
      }

      const cabecalho = dados.approximate
        ? `${dados.results.length} resultado(s) por semelhança de título — não houve correspondência exata:`
        : `${dados.results.length} resultado(s):`;

      return {
        content: [
          {
            type: "text",
            text: `${cabecalho}\n\n${dados.results.map(formatarResultado).join("\n\n")}`,
          },
        ],
      };
    }),
  );

  server.registerTool(
    "get_note",
    {
      title: "Ler uma nota inteira",
      description:
        "Devolve o conteúdo completo de uma nota, com tags, campos livres, as notas que a " +
        "referenciam e os cards vinculados. É a única tool que devolve corpo inteiro, então " +
        "chame-a para uma nota de cada vez, depois de localizar o id com `search_notes`.",
      inputSchema: {
        id: z.string().uuid().describe("Id da nota, como devolvido por search_notes."),
      },
    },
    comErro(async ({ id }) => {
      const nota = await api.get<NoteDetail>(`/notes/${id}`);
      return { content: [{ type: "text", text: formatarNota(nota) }] };
    }),
  );
}
