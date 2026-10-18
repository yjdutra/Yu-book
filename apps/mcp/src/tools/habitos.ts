import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FERRAMENTAS_DO_ACERVO, formatarHabitos } from "@yu-book/shared";
import type { HabitItem } from "@yu-book/shared";
import { api, ErroDaApi } from "../cliente.js";
import { comErro } from "../erros.js";

/**
 * A leitura dos hábitos (frente Ritmo, Ritmo 1 — RF-12). A semana ponderada
 * chega pronta da API, calculada no dia local do usuário (RN-05): não há fuso
 * a pedir deste lado, como na agenda.
 */
export function registrarToolsDeHabitos(server: McpServer): void {
  const lista = FERRAMENTAS_DO_ACERVO.list_habits;
  server.registerTool(
    "list_habits",
    { title: lista.titulo, description: lista.descricao, inputSchema: lista.entrada },
    comErro(async () => {
      let habitos: HabitItem[];
      try {
        habitos = await api.get<HabitItem[]>("/habits");
      } catch (erro) {
        // Rota sem id: `NOT_FOUND` só pode ser a API mais velha que este
        // servidor (§13 da skill do MCP).
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return {
            content: [
              {
                type: "text",
                text:
                  "A API do Yu-book no ar ainda não tem hábitos (GET /habits não existe nela). " +
                  "Tentar de novo não resolve.",
              },
            ],
            isError: true,
          };
        }
        throw erro;
      }
      return { content: [{ type: "text", text: formatarHabitos(habitos) }] };
    }),
  );
}
