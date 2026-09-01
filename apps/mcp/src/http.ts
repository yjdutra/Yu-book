import { randomUUID } from "node:crypto";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Express, Request, Response } from "express";
import { env } from "./env.js";
import { rotasDeLogin } from "./auth/rotas.js";
import { ESCOPO_ESCRITA, ESCOPO_LEITURA, provedor } from "./auth/provedor.js";
import { criarServidor } from "./servidor.js";

/**
 * O transporte StreamableHTTP — o degrau que a Parte II do Advanced Topics
 * descreve, e o que quebra a premissa em que o stdio se apoiava.
 *
 * Em stdio há um processo por pessoa: quem está do outro lado é quem iniciou o
 * processo, e a credencial pode morar no ambiente. Aqui um processo atende
 * muitos clientes, e **o servidor deixa de saber quem está perguntando** — daí
 * a sessão, e daí a identidade vir de fora: o token OAuth que o cliente
 * apresenta carrega, cifrado, o `accessToken` da API de quem autorizou, e
 * `erros.ts` o entrega a cada handler. Nada aqui usa credencial do ambiente —
 * o `env.ts` recusa subir em HTTP se ela existir.
 *
 * **Com estado, por decisão.** `sessionIdGenerator` definido é o que mantém o
 * caminho de volta aberto: sem ele o SDK desliga o SSE, e junto vão o progresso,
 * o log e a amostragem. As quatro tools de escrita emitem log, que é a única
 * trilha de auditoria que chega ao usuário — desligá-la para ganhar escala
 * horizontal que ninguém pediu seria trocar o certo pelo genérico.
 *
 * O preço está declarado: **com duas instâncias isto quebra.** O POST de uma
 * chamada e o GET do SSE podem cair em máquinas diferentes, e a máquina que
 * atende o POST não alcança a conexão que precisa receber o progresso. Uma
 * instância, sempre — e se um dia houver duas, é aqui que se olha.
 */

/**
 * Um `McpServer` conecta a **um** transporte, então cada sessão tem o seu par.
 * Este mapa é o estado do modo com estado.
 *
 * **É a peça que falha em silêncio.** Sessão que entra e nunca sai não dá erro
 * nem log: só ocupa memória até o processo morrer, semanas depois, com um
 * sintoma que não aponta para cá. Todo caminho de saída — `DELETE`, queda de
 * conexão, erro de transporte — precisa passar por `esquecer()`.
 */
interface Sessao {
  transporte: StreamableHTTPServerTransport;
  servidor: McpServer;
  /**
   * De quem é esta sessão. Conferido a cada requisição.
   *
   * O motivo mudou, e o mais forte já não vale: as tools **não** usam mais
   * credencial guardada na sessão — a identidade vem do token da requisição, a
   * cada chamada. Quem apresentasse um `mcp-session-id` alheio com o próprio
   * token operaria como si mesmo, não como o dono da sessão, e não veria dado
   * de outra conta.
   *
   * A checagem fica porque a sessão ainda é um lugar: quem entra nela recebe as
   * notificações do SSE de quem estava lá, e vê a superfície de tools que **o
   * dono** consentiu — inclusive as de escrita, congeladas na criação. Ninguém
   * senta na sessão de outra pessoa.
   */
  userId: string;
  ultimoUso: number;
}

const sessoes = new Map<string, Sessao>();

function esquecer(sessionId: string): void {
  const sessao = sessoes.get(sessionId);
  if (!sessao) return;
  sessoes.delete(sessionId);
  // O `McpServer` da sessão morre junto: é uma instância por sessão, e deixá-la
  // viva seria vazar o dobro.
  void sessao.servidor.close().catch(() => {});
  console.error(`[yu-book-mcp] sessão encerrada: ${sessionId} · ativas: ${sessoes.size}`);
}

/**
 * A defesa contra o vazamento que o `onclose` **não** cobre.
 *
 * Verificado no SDK 1.30: `close()` do transporte só é chamado no caminho do
 * `DELETE`. Um cliente que cai de rede, fecha o laptop ou simplesmente some
 * deixa a sessão viva **para sempre** — sem erro, sem log, só ocupando memória
 * até o processo morrer semanas depois com um sintoma que não aponta para cá.
 *
 * Por isso três defesas, e não uma: `onclose` para o encerramento limpo, esta
 * varredura para o cliente que some, e um teto duro para o caso de a varredura
 * não dar conta.
 */
function varrerOciosas(): void {
  const limite = Date.now() - env.MCP_SESSAO_TTL_MS;
  for (const [id, sessao] of sessoes) {
    if (sessao.ultimoUso < limite) {
      console.error(`[yu-book-mcp] sessão ociosa: ${id}`);
      void sessao.transporte.close().catch(() => {});
      esquecer(id);
    }
  }
}

/** Fecha a mais antiga quando o teto estoura, para o vazamento não virar queda. */
function abrirEspaco(): void {
  if (sessoes.size < env.MCP_SESSOES_MAX) return;
  let maisAntiga: string | undefined;
  let quando = Infinity;
  for (const [id, sessao] of sessoes) {
    if (sessao.ultimoUso < quando) {
      quando = sessao.ultimoUso;
      maisAntiga = id;
    }
  }
  if (maisAntiga) {
    console.error(`[yu-book-mcp] teto de ${env.MCP_SESSOES_MAX} sessões: fechando ${maisAntiga}`);
    const sessao = sessoes.get(maisAntiga);
    void sessao?.transporte.close().catch(() => {});
    esquecer(maisAntiga);
  }
}

/** Quantas sessões estão vivas. Existe para a verificação poder provar que o mapa esvazia. */
export function sessoesAtivas(): number {
  return sessoes.size;
}

async function novaSessao(
  req: Request,
  res: Response,
  corpo: unknown,
  userId: string,
  escrita: boolean,
): Promise<void> {
  abrirEspaco();

  const servidor = criarServidor({ escrita });
  let registrada = false;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),

    onsessioninitialized: (sessionId) => {
      registrada = true;
      sessoes.set(sessionId, { transporte: transport, servidor, userId, ultimoUso: Date.now() });
      console.error(`[yu-book-mcp] sessão nova: ${sessionId} · ativas: ${sessoes.size}`);
    },

    // O par de `onsessioninitialized`. Sem ele o mapa só cresce.
    onsessionclosed: (sessionId) => esquecer(sessionId),

  });

  // Só cobre o `DELETE`. **Não** cobre cliente que some — ver `varrerOciosas`.
  transport.onclose = () => {
    if (transport.sessionId) esquecer(transport.sessionId);
  };

  try {
    await servidor.connect(transport);
    await transport.handleRequest(req, res, corpo);
  } finally {
    // O MESMO VAZAMENTO QUE O 404 DE ID DESCONHECIDO FECHA, no ramo irmão.
    //
    // Chegar aqui sem id só é legítimo para um `initialize`, e é o SDK quem
    // confere isso — recusando o resto com 400. Mas a essa altura o
    // `McpServer` e o transporte **já nasceram**: se a recusa acontece, eles
    // nunca entram no mapa, então `esquecer()` não os alcança, `onclose` não
    // dispara (não há `sessionId`), a varredura não os enxerga e o teto não os
    // conta. Um cliente com defeito mandando `tools/list` sem id vazaria um par
    // por tentativa, sem erro e sem log.
    //
    // O `finally` cobre também o corpo malformado, que o SDK recusa antes de
    // olhar o método.
    if (!registrada) {
      await transport.close().catch(() => {});
      await servidor.close().catch(() => {});
    }
  }
}

export function criarAplicacaoHttp(): Express {
  const app = express();
  app.use(express.json());

  // A Railway derruba o serviço se o healthcheck falhar, e a política de
  // reinício é ON_FAILURE — sem esta rota o deploy entra em laço.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transporte: "http", sessoes: sessoes.size });
  });

  /**
   * O transporte roteia os três verbos sozinho, dentro de `handleRequest`:
   * `POST` chama, `GET` abre o SSE da via de volta, `DELETE` encerra. O trabalho
   * daqui é só decidir **qual** transporte atende esta requisição.
   */
  // **Depois** do `/health`, de propósito: o healthcheck da Railway chega com
  // um `Host` que não é o domínio público. Validar antes dele faria o
  // healthcheck tomar 403, e a política ON_FAILURE entraria em laço de
  // reinício — uma falha que parece do app e é da ordem dos middlewares.
  //
  // As opções `allowedHosts`/`allowedOrigins` do transporte fazem o mesmo, mas
  // estão deprecadas no SDK 1.30 em favor deste middleware. Ele compara só o
  // hostname, ignorando a porta.
  if (env.hostsPermitidos) {
    app.use(hostHeaderValidation(env.hostsPermitidos));
  }

  const urlPublica = env.urlPublica ?? `http://localhost:${env.PORT}`;

  // O roteador OAuth **precisa** ficar na raiz: ele monta os `/.well-known`,
  // e um cliente MCP procura por eles exatamente ali.
  app.use(
    mcpAuthRouter({
      provider: provedor,
      issuerUrl: new URL(urlPublica),
      resourceServerUrl: new URL(`${urlPublica}/mcp`),
      resourceName: "Yu-book",
      scopesSupported: env.escritaHabilitada
        ? [ESCOPO_LEITURA, ESCOPO_ESCRITA]
        : [ESCOPO_LEITURA],
    }),
  );
  app.use(rotasDeLogin());

  // O `resourceMetadataUrl` é o que vai no `WWW-Authenticate` do 401 — é assim
  // que o cliente descobre onde se autenticar sem ninguém lhe contar.
  const autenticar = requireBearerAuth({
    verifier: provedor,
    requiredScopes: [ESCOPO_LEITURA],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${urlPublica}/mcp`)),
  });

  app.all("/mcp", autenticar, async (req, res) => {
    const identidade = req.auth?.extra?.["userId"];
    if (typeof identidade !== "string") {
      res.status(401).json({ erro: "Token sem identidade." });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const existente = typeof sessionId === "string" ? sessoes.get(sessionId) : undefined;

    if (existente) {
      // 404 e não 403: confirmar que o id existe já é informação demais.
      if (existente.userId !== identidade) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Sessão desconhecida." },
          id: null,
        });
        return;
      }
      existente.ultimoUso = Date.now();
      await existente.transporte.handleRequest(req, res, req.body);
      return;
    }

    // Id presente e desconhecido é 404, e a recusa acontece **antes** de
    // qualquer construção. Deixar cair no caminho de sessão nova faria um
    // `McpServer` e um transporte nascerem para serem recusados pelo SDK logo
    // em seguida — nunca mapeados, nunca fechados. Um id velho repetido
    // vazaria memória a cada tentativa, e qualquer um consegue mandar um.
    if (typeof sessionId === "string") {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Sessão desconhecida. Inicialize de novo." },
        id: null,
      });
      return;
    }

    // Sem id, só a inicialização é legítima — e é o próprio SDK quem confere
    // se o corpo é mesmo um `initialize`, recusando o resto com 400.
    if (req.method === "POST") {
      // Os escopos congelam na criação: as tools de escrita ou são registradas
      // ou não, e não há como registrá-las no meio de uma sessão.
      const escrita = env.escritaHabilitada && (req.auth?.scopes ?? []).includes(ESCOPO_ESCRITA);
      await novaSessao(req, res, req.body, identidade, escrita);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Sessão ausente" },
      id: null,
    });
  });

  // A cada minuto, ou mais miúdo se o TTL for curto — um TTL de segundos com
  // varredura de minuto seria um TTL de minuto disfarçado, e não daria para
  // provar que ela funciona.
  const intervalo = Math.min(60_000, Math.max(1_000, env.MCP_SESSAO_TTL_MS));
  setInterval(varrerOciosas, intervalo).unref();

  return app;
}
