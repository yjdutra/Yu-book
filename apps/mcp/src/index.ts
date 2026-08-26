import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { env } from "./env.js";
import { mensagemDeErro } from "./erros.js";
import { registrarPrompts } from "./prompts/revisao.js";
import { registrarCatalogos } from "./resources/catalogos.js";
import { registrarConteudo } from "./resources/conteudo.js";
import { registrarEscritaDeKanban } from "./tools/kanban-escrita.js";
import { registrarToolsDeKanban } from "./tools/kanban.js";
import { registrarEscritaDeNotas } from "./tools/notas-escrita.js";
import { registrarToolsDeNotas } from "./tools/notas.js";

/**
 * Servidor MCP do Yu-book — as três primitivas do protocolo sobre stdio,
 * agora com escrita (Etapa 3).
 *
 * A diferença entre as três é **quem aciona**, não o dado:
 *   tool     o modelo decide chamar, no meio da resposta
 *   resource o usuário anexa, antes de perguntar (o menu do `@`)
 *   prompt   o usuário invoca (o menu do `/`)
 *
 * Por isso `get_board` e `yubook://board/{id}` coexistem devolvendo o mesmo
 * texto: a superfície é que se duplica de propósito, nunca a implementação.
 *
 * A escrita nasce **desligada** fora de um host local. Enquanto o servidor só
 * lia, apontar o `.env` para produção era inofensivo; com `create_card` e
 * `trash_note` registradas, um pedido mal interpretado cria ou remove dado de
 * verdade, e não existe desfazer deste lado. Ver `env.escritaLiberada`.
 *
 * REGRA QUE NÃO SE QUEBRA: em stdio, o stdout **é** o canal do protocolo. Um
 * `console.log` esquecido injeta lixo no meio de uma mensagem JSON-RPC e o
 * cliente desconecta com um erro que não parece ter relação nenhuma com o log.
 * Todo diagnóstico vai para stderr, sempre.
 */
const server = new McpServer(
  {
    name: "yu-book",
    version: "0.4.0",
  },
  // A capability `logging` precisa ser declarada **aqui**, na construção.
  // Sem ela `sendLoggingMessage` não lança nem avisa: apenas não faz nada, e
  // o log das escritas somem em silêncio. Declarar depois não adianta — o
  // handler de `logging/setLevel` só é registrado no construtor.
  { capabilities: { logging: {} } },
);

registrarToolsDeNotas(server);
registrarToolsDeKanban(server);
registrarCatalogos(server);
registrarConteudo(server);
registrarPrompts(server);

if (env.escritaLiberada) {
  registrarEscritaDeKanban(server);
  registrarEscritaDeNotas(server);
}

async function principal(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr, sempre: stdout é do protocolo. Esta linha é o que evita a confusão
  // de estar escrevendo em produção achando que é local — e o contrário.
  console.error(`Servidor MCP do Yu-book conectado por stdio. API: ${env.YUBOOK_API_URL}`);
  if (env.escritaLiberada) {
    console.error(
      env.apiEhLocal
        ? "  escrita: habilitada (API local)."
        : "  escrita: habilitada em API REMOTA por YUBOOK_ESCRITA_REMOTA=1.",
    );
  } else {
    console.error(
      "  escrita: desligada — a API não é local. As tools create_card, move_card, trash_note e\n" +
        "  restore_note não foram registradas. Aponte YUBOOK_API_URL para um host local, ou\n" +
        "  declare YUBOOK_ESCRITA_REMOTA=1 sabendo que a escrita alcança dado de verdade.",
    );
  }
}

principal().catch((erro) => {
  console.error("Falha ao subir o servidor MCP:", mensagemDeErro(erro));
  process.exit(1);
});
