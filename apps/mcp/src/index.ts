import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mensagemDeErro } from "./erros.js";
import { registrarToolsDeKanban } from "./tools/kanban.js";
import { registrarToolsDeNotas } from "./tools/notas.js";

/**
 * Servidor MCP do Yu-book — Etapa 1: só leitura, transporte stdio.
 *
 * REGRA QUE NÃO SE QUEBRA: em stdio, o stdout **é** o canal do protocolo. Um
 * `console.log` esquecido injeta lixo no meio de uma mensagem JSON-RPC e o
 * cliente desconecta com um erro que não parece ter relação nenhuma com o log.
 * Todo diagnóstico vai para stderr, sempre.
 */
const server = new McpServer({
  name: "yu-book",
  version: "0.1.0",
});

registrarToolsDeNotas(server);
registrarToolsDeKanban(server);

async function principal(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP do Yu-book conectado por stdio.");
}

principal().catch((erro) => {
  console.error("Falha ao subir o servidor MCP:", mensagemDeErro(erro));
  process.exit(1);
});
