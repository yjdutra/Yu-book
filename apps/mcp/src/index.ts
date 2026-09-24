import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { env } from "./env.js";
import { mensagemDeErro } from "./erros.js";
import { criarAplicacaoHttp } from "./http.js";
import { criarServidor } from "./servidor.js";

/**
 * Servidor MCP do Yu-book. Dois transportes, uma montagem só.
 *
 *   stdio  desenvolvimento — um processo por pessoa, iniciado pelo cliente MCP
 *   http   serviço hospedado — StreamableHTTP com sessão, muitos clientes
 *
 * O que cada um serve está em `src/servidor.ts`, e é idêntico: as dez tools,
 * os resources e os prompts. Só o canal muda.
 *
 * REGRA QUE NÃO SE QUEBRA — **e que vale só para o stdio**: ali o stdout **é**
 * o canal JSON-RPC, e um `console.log` esquecido injeta lixo no meio de uma
 * mensagem, derrubando o cliente com um erro que não parece ter relação com
 * log. Sob HTTP o stdout é só stdout. Como o mesmo código roda nos dois,
 * **todo diagnóstico continua indo para stderr, sempre** — a regra mais
 * restritiva vence, e assim não há um caminho seguro e outro traiçoeiro.
 */
async function principal(): Promise<void> {
  if (env.ehHttp) {
    const app = criarAplicacaoHttp();
    await new Promise<void>((resolve) => {
      app.listen(env.PORT, "0.0.0.0", () => resolve());
    });
    console.error(`Servidor MCP do Yu-book ouvindo em :${env.PORT} (StreamableHTTP).`);
  } else {
    // Em stdio a instância é uma só, porque a conexão é uma só.
    await criarServidor({ escrita: env.escritaLiberada }).connect(new StdioServerTransport());
    console.error("Servidor MCP do Yu-book conectado por stdio.");
  }

  // Esta linha é o que evita a confusão de estar escrevendo em produção
  // achando que é local — e o contrário.
  console.error(`  API: ${env.YUBOOK_API_URL}`);
  console.error(env.ehHttp ? diagnosticoDeEscritaHttp() : diagnosticoDeEscritaStdio());
}

/**
 * O QUE DECIDE A ESCRITA É OUTRO EM CADA TRANSPORTE, e esta mensagem existe
 * exatamente para evitar a confusão de estar escrevendo em produção achando que
 * é local. Uma mensagem errada aqui é pior que nenhuma, então ela ramifica.
 *
 *   stdio  a URL da API — não há identidade, a credencial vem do `.env`
 *   http   o desligamento global **e** o escopo do token de quem chamou
 *
 * A trava por host local **não participa** do caminho HTTP. Ver
 * `OpcoesDoServidor` em `servidor.ts`: são eixos diferentes de propósito.
 */
function diagnosticoDeEscritaStdio(): string {
  if (env.escritaLiberada) {
    return env.apiEhLocal
      ? "  escrita: habilitada (API local)."
      : "  escrita: habilitada em API REMOTA por YUBOOK_ESCRITA_REMOTA=1.";
  }
  return (
    "  escrita: desligada — a API não é local. As tools create_card, create_note, move_card,\n" +
    "  trash_note e restore_note não foram registradas. Aponte YUBOOK_API_URL para um host local, ou\n" +
    "  declare YUBOOK_ESCRITA_REMOTA=1 sabendo que a escrita alcança dado de verdade."
  );
}

function diagnosticoDeEscritaHttp(): string {
  const publica = `  URL pública: ${env.urlPublica} (é ela que vai no metadata de descoberta)`;

  if (!env.escritaHabilitada) {
    return (
      "  escrita: DESLIGADA por MCP_ESCRITA_HABILITADA=0. Nenhuma sessão registra create_card,\n" +
      "  create_note, move_card, trash_note ou restore_note, mesmo que o token traga\n" +
      "  o escopo.\n" +
      publica
    );
  }
  return (
    "  escrita: por escopo do token. Quem marcar a caixa no consentimento recebe yubook:write e\n" +
    "  vê as dez tools; quem não marcar vê cinco. A trava por host local não vale aqui —\n" +
    "  MCP_ESCRITA_HABILITADA=0 é o desligamento global deste transporte.\n" +
    publica
  );
}

principal().catch((erro) => {
  console.error("Falha ao subir o servidor MCP:", mensagemDeErro(erro));
  process.exit(1);
});
