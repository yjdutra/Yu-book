import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registrarPrompts } from "./prompts/revisao.js";
import { registrarCatalogos } from "./resources/catalogos.js";
import { registrarConteudo } from "./resources/conteudo.js";
import { registrarEscritaDeKanban } from "./tools/kanban-escrita.js";
import { registrarToolsDeKanban } from "./tools/kanban.js";
import { registrarEscritaDeNotas } from "./tools/notas-escrita.js";
import { registrarToolsDeNotas } from "./tools/notas.js";

/**
 * A montagem do servidor MCP, separada do transporte.
 *
 * Existe como **fábrica**, e não como instância única, por uma restrição do
 * protocolo: um `McpServer` conecta a **um** transporte. No stdio isso é
 * invisível — há um processo e uma conexão. Sob StreamableHTTP com estado, cada
 * sessão é uma conexão, então cada sessão precisa da sua própria instância.
 *
 * O que **não** muda entre os dois transportes é tudo o que importa: as nove
 * tools, os resources, os prompts e as capabilities. Duplicar esse registro
 * entre dois caminhos seria a forma mais fácil de fazer o servidor hospedado
 * divergir do local em silêncio.
 *
 * A diferença entre as três primitivas continua sendo **quem aciona**, não o
 * dado:
 *   tool     o modelo decide chamar, no meio da resposta
 *   resource o usuário anexa, antes de perguntar (o menu do `@`)
 *   prompt   o usuário invoca (o menu do `/`)
 */
export interface OpcoesDoServidor {
  /**
   * Se as quatro tools de escrita entram no `tools/list`.
   *
   * Em stdio vem de `env.escritaLiberada` — a trava por URL, que continua certa
   * ali porque não existe identidade: a credencial vem do `.env`. Em HTTP vem
   * do **escopo do token**, decidido no consentimento. São eixos diferentes
   * para transportes diferentes, e não é engano.
   */
  escrita: boolean;
}

export function criarServidor({ escrita }: OpcoesDoServidor): McpServer {
  const server = new McpServer(
    {
      name: "yu-book",
      version: "0.5.0",
    },
    // A capability `logging` precisa ser declarada **aqui**, na construção.
    // Sem ela `sendLoggingMessage` não lança nem avisa: apenas não faz nada, e
    // o log das escritas some em silêncio. Declarar depois não adianta — o
    // handler de `logging/setLevel` só é registrado no construtor.
    { capabilities: { logging: {} } },
  );

  registrarToolsDeNotas(server);
  registrarToolsDeKanban(server);
  registrarCatalogos(server);
  registrarConteudo(server);
  registrarPrompts(server);

  if (escrita) {
    registrarEscritaDeKanban(server);
    registrarEscritaDeNotas(server);
  }

  return server;
}
