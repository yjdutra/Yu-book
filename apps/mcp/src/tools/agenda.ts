import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FERRAMENTAS_DO_ACERVO, formatarAgenda, periodoDeListAgenda } from "@yu-book/shared";
import type { AgendaRange } from "@yu-book/shared";
import { api, ErroDaApi } from "../cliente.js";
import { comErro } from "../erros.js";

/**
 * A leitura da agenda (frente de agenda, Fase 2). O metadado vem de
 * `FERRAMENTAS_DO_ACERVO`, como nas outras; ver `tools/notas.ts`.
 *
 * **Sem `fusoDoUsuario`, de propósito.** Evento e tarefa chegam da API já em
 * dia e hora locais do usuário — o servidor converteu pelo
 * `ai_preference.timezone` —, e `formatarAgenda` não recebe fuso: não há
 * instante a converter deste lado (INV-66). Pedir o fuso aqui seria uma ida à
 * rede para nada, e convertê-lo de novo, a única forma de errar o dia.
 */
export function registrarToolsDeAgenda(server: McpServer): void {
  const agenda = FERRAMENTAS_DO_ACERVO.list_agenda;
  server.registerTool(
    "list_agenda",
    { title: agenda.titulo, description: agenda.descricao, inputSchema: agenda.entrada },
    comErro(async (entrada) => {
      // A regra cruza os dois campos — `to` depois de `from`, no máximo
      // `MAX_DIAS_DE_LIST_AGENDA` — e o `ZodRawShape` da tool não a enxerga.
      // Conferida aqui, antes da rede, pela mesma função do executor do chat:
      // a janela da API é maior (o mês que o calendário desenha), então
      // deixá-la decidir aceitaria um período que não cabe no contexto.
      const { from, to, problema } = periodoDeListAgenda(entrada);
      if (problema) {
        return {
          content: [{ type: "text", text: `Período recusado: ${problema}` }],
          isError: true,
        };
      }

      let periodo: AgendaRange;
      try {
        periodo = await api.get<AgendaRange>("/agenda", new URLSearchParams({ from, to }));
      } catch (erro) {
        // Rota sem id: `NOT_FOUND` aqui só pode ser a rota que não existe — a
        // API no ar é mais velha que este servidor (§13 da skill do MCP). A
        // tradução genérica falaria de um id que o modelo nem mandou.
        if (erro instanceof ErroDaApi && erro.code === "NOT_FOUND") {
          return {
            content: [
              {
                type: "text",
                text:
                  "A API do Yu-book no ar ainda não tem a agenda (GET /agenda não existe nela). " +
                  "Não é um problema de argumento: tentar de novo não resolve.",
              },
            ],
            isError: true,
          };
        }
        throw erro;
      }

      return { content: [{ type: "text", text: formatarAgenda(periodo) }] };
    }),
  );
}
