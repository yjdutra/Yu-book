import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  LoggingLevel,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Log e progresso — a via de volta do protocolo, do curso Advanced Topics.
 *
 * As duas coisas são pedidos que o **servidor** faz ao cliente, e a diferença
 * entre elas não é técnica, é de destinatário:
 *
 *   progresso  "estou no passo 2 de 3"    — para a barra, some quando acaba
 *   log        "criei o card X na coluna Y" — para o humano, fica
 *
 * **O que vale aqui é o log, e vale por um motivo específico:** estas são as
 * primeiras operações do servidor que *mudam dado*. Todo diagnóstico deste
 * pacote vai para stderr, que nenhum cliente MCP mostra. Um log de escrita é o
 * único registro que o usuário chega a ver de que uma nota foi para a lixeira.
 *
 * **E o progresso, nesta etapa, é quase ornamental — de propósito.** Com tools
 * estreitas contra API local, cada chamada é uma requisição de dezenas de
 * milissegundos, e uma barra que vai de 0 a 1 não informa ninguém. Ele entra
 * porque o mecanismo é o mesmo de que o backfill de embeddings vai precisar
 * (RF-30 do PRD de IA pede "progresso visível e retomada"), e construí-lo agora
 * custa zero. O que **não** se faz é inventar passo artificial para a barra
 * parecer cheia: progresso falso ensina o usuário a ignorá-lo.
 */
export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface Relato {
  /** Um passo concluído: progresso, se o cliente pediu, mais log de depuração. */
  passo(mensagem: string): Promise<void>;
  /** Um fato para o log do cliente, fora da contagem de passos. */
  registrar(nivel: LoggingLevel, dados: Record<string, unknown>): Promise<void>;
}

/**
 * REGRA QUE NÃO SE QUEBRA: notificação nunca decide o resultado de uma tool.
 *
 * Quando o relato é emitido, a escrita já aconteceu. Se um `sendNotification`
 * lançar — cliente desconectado, transporte fechado, capability ausente —, uma
 * criação bem-sucedida viraria `isError`, e o modelo criaria o card de novo.
 * Por isso toda emissão é engolida aqui, com o motivo indo para stderr.
 */
export function relatar(server: McpServer, extra: Extra, tool: string, total: number): Relato {
  // O cliente só recebe progresso se ele tiver pedido, mandando um
  // `progressToken` no `_meta` da chamada. Emitir sem token é ruído.
  const token = extra._meta?.progressToken;
  let feitos = 0;

  return {
    async passo(mensagem) {
      feitos += 1;
      try {
        if (token !== undefined) {
          await extra.sendNotification({
            method: "notifications/progress",
            // Pelo `extra`, e não pelo servidor: é ele que amarra a notificação
            // à requisição em curso.
            params: { progressToken: token, progress: feitos, total, message: mensagem },
          });
        }
        await server.server.sendLoggingMessage({
          level: "debug",
          logger: "yu-book",
          data: { tool, passo: feitos, de: total, mensagem },
        });
      } catch (erro) {
        console.error("[yu-book-mcp] falha ao notificar progresso:", erro);
      }
    },

    async registrar(nivel, dados) {
      try {
        // Sempre por `sendLoggingMessage`, nunca por `extra.sendNotification`
        // com `notifications/message`: a segunda forma **lança** quando a
        // capability `logging` não foi declarada, a primeira apenas não faz
        // nada. Numa tool de escrita, a diferença é entre um log perdido e uma
        // escrita relatada como falha.
        await server.server.sendLoggingMessage({
          level: nivel,
          logger: "yu-book",
          // Objeto, não frase: é o que um cliente consegue filtrar.
          data: { tool, ...dados },
        });
      } catch (erro) {
        console.error("[yu-book-mcp] falha ao registrar log:", erro);
      }
    },
  };
}
