import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID } from "node:crypto";
import { ErroDaApi } from "../cliente.js";
import { ESCOPO_ESCRITA, ESCOPO_LEITURA } from "../autorizacao.js";
import { env } from "../env.js";
import { CABECALHOS_DA_PAGINA, paginaDeLogin } from "./pagina.js";
import { abrir, assinarToken, selar, verificarToken } from "./segredos.js";
import { renovarNaApi, sairDaApi, type CredencialDaApi } from "./sessao-api.js";

/**
 * O servidor de autorização do Yu-book, para o MCP.
 *
 * Ele **emite** o token, não repassa um. A diferença não é estilo: a
 * especificação do MCP chama de anti-padrão aceitar token que não foi emitido
 * para este servidor ("token passthrough"), porque quem aceita não consegue
 * distinguir um token destinado a ele de um roubado do navegador. Daí o `aud`
 * conferido em `verificarToken`.
 *
 * Todo o estado durável vive **dentro** dos identificadores, cifrado — ver
 * `segredos.ts`. O que fica em memória é o que pode ser perdido sem custo.
 */

const VIDA_DO_CODIGO_MS = 60_000;

/**
 * O COMPASSO. Nenhum destes dois números é um prazo arbitrário do MCP.
 *
 * O token que este servidor emite **carrega dentro dele** o `accessToken` da
 * `apps/api`, que dura `ACCESS_TOKEN_TTL_SECONDS` (900 s). Se o token do MCP
 * vivesse mais que o que ele carrega, o 401 da API cairia **dentro de uma
 * tool** — onde o cliente MCP não sabe reagir, e o modelo recebe um erro que
 * ele vai tentar contornar sozinho. Vivendo menos, o 401 cai na fronteira
 * HTTP, que é onde o cliente sabe renovar.
 *
 * E **igualar** os dois em 900 não bastaria: o token da API nasce no
 * `POST /auth/login` e o do MCP nasce na troca do código, até
 * `VIDA_DO_CODIGO_MS` depois. Com a mesma duração e partidas diferentes, o do
 * MCP ainda morre por último. Por isso a vida é **derivada** de quando o token
 * da API vence, e não fixada.
 */
const MARGEM_S = 60;

/**
 * Piso: abaixo disto não vale a pena emitir. Por construção nunca dispara — o
 * código de autorização vive 60 s, então na troca sobram ao menos
 * `900 − 60 − 60 = 780 s`; e no caminho do refresh a renovação acabou de
 * acontecer, então sobram 840. Existe como tripwire: se alguém esticar a vida
 * do código de autorização, isto recusa em vez de entregar um token de cinco
 * segundos.
 */
const PISO_S = 120;

interface Pedido {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  resource?: string;
  exp: number;
}

interface Codigo {
  jti: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  refresh: string;
  escopos: string[];
  exp: number;
  /** O `accessToken` da API. O envelope inteiro é cifrado, então vai em claro aqui. */
  apiTok: string;
  /** Quando esse token vence, em epoch/segundos. É daqui que sai a vida do token do MCP. */
  apiExp: number;
}

interface Refresh {
  /** Identidade deste refresh token. É a chave da janela de idempotência. */
  jti: string;
  clientId: string;
  userId: string;
  refresh: string;
  escopos: string[];
  apiTok: string;
  apiExp: number;
}

/**
 * Códigos já trocados. Vive em memória de propósito: o código dura 60 s, então
 * um reinício nessa janela custa um login repetido — e guardar isso em disco
 * seria dar banco ao pacote por causa de um minuto.
 */
const codigosUsados = new Set<string>();

/**
 * Quanto tempo o resultado de uma renovação fica disponível para quem repetir o
 * pedido. Curto de propósito: é a duração de um acidente de rede, não de uma
 * sessão.
 */
const VIDA_DA_RENOVACAO_MS = 120_000;

/**
 * A JANELA DE IDEMPOTÊNCIA, por `jti` do refresh token.
 *
 * O acidente que ela cobre: a renovação acontece a cada ~14 minutos, para
 * sempre, sem ninguém olhando. Se a resposta se perder no caminho de volta, o
 * cliente repete o pedido com o mesmo refresh token — e o cookie da API já foi
 * consumido. Sem esta janela isso vira 401, e um agente autônomo para no meio
 * do trabalho pedindo navegador.
 *
 * Guarda a **promessa**, não o resultado, e é isso que faz ela cobrir os dois
 * casos com um mecanismo só: o pedido concorrente encontra a promessa em voo, e
 * o pedido repetido encontra a mesma promessa já resolvida.
 *
 * Em memória de propósito, como `codigosUsados`: a janela dura segundos, e um
 * reinício dentro dela custa uma reautorização — não a revogação em massa, que
 * é o que importa evitar.
 */
const renovacoes = new Map<string, Promise<OAuthTokens>>();

/**
 * O registro de clientes, sem armazenamento.
 *
 * O `client_id` **é** o envelope cifrado do cadastro inteiro. Registro dinâmico
 * passa a sobreviver a redeploy sem nada persistido, e o mapa não cresce — que
 * é o que evita o outro vazamento silencioso deste desenho.
 */
export const registroDeClientes: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    const dados = abrir<OAuthClientInformationFull>(clientId, "cliente");
    if (!dados) return undefined;
    if (dados.client_secret_expires_at && dados.client_secret_expires_at < Date.now() / 1000) {
      return undefined;
    }
    // O `client_id` DEVOLVIDO É O ENVELOPE APRESENTADO, e não o que ficou
    // dentro dele — que é `""`, porque a selagem acontece antes de haver id
    // para selar (ver `registerClient`). Sem esta linha, `getClient` devolvia
    // `client_id: ""` para **todo** cliente, e as três comparações de
    // `clientId` em `challengeForAuthorizationCode`, `exchangeAuthorizationCode`
    // e `exchangeRefreshToken` viravam `"" !== ""` — tautologia.
    //
    // O fluxo feliz funcionava idêntico nos dois casos, porque quem valida o
    // `redirect_uri` é o SDK e essa parte do cadastro sobrevivia intacta. O que
    // se perdia era a ligação código↔cliente e refresh↔cliente: com registro
    // dinâmico aberto, um refresh token vazado valeria em qualquer cliente.
    return { ...dados, client_id: clientId };
  },

  registerClient(cliente) {
    // O handler do SDK já gerou um `client_id`; a interface permite devolver
    // uma versão modificada, e é o que fazemos. O id que ele gerou é
    // descartado: a identidade deste cliente **é** o envelope.
    const completo = { ...cliente, client_id: "" } as OAuthClientInformationFull;
    completo.client_id = selar(completo, "cliente");
    return completo;
  },
};

/** O que a rota `POST /login` precisa saber para concluir a autorização. */
export function abrirPedido(envelope: string): Pedido | null {
  const pedido = abrir<Pedido>(envelope, "pedido");
  if (!pedido || pedido.exp < Date.now()) return null;
  return pedido;
}

/** Cria o código de autorização depois que o login na API deu certo. */
export function emitirCodigo(
  pedido: Pedido,
  sessao: CredencialDaApi & { userId: string },
  escrita: boolean,
): string {
  const codigo: Codigo = {
    jti: randomUUID(),
    clientId: pedido.clientId,
    redirectUri: pedido.redirectUri,
    codeChallenge: pedido.codeChallenge,
    userId: sessao.userId,
    refresh: sessao.refresh,
    // O login acabou de acontecer em `POST /login`: o token e o prazo já estão
    // na mão, e guardá-los aqui não custa requisição nenhuma.
    apiTok: sessao.accessToken,
    apiExp: Math.floor(sessao.expiraEm / 1000),
    // A concessão é decidida **aqui**, pela caixa da tela, e não pelo `scope`
    // que o cliente pediu: o Claude Code não manda `scope` nenhum, e se
    // dependêssemos do pedido a escrita nunca seria concedida.
    //
    // E o `escritaHabilitada` entra na conta porque a caixa some da tela quando
    // ele é falso, mas um POST direto em `/login` ainda mandaria `escrita=1`.
    // Conceder um escopo que nenhuma sessão vai honrar é prometer o que não se
    // cumpre — o token diria `yubook:write` e as tools não existiriam.
    escopos:
      escrita && env.escritaHabilitada
        ? [ESCOPO_LEITURA, ESCOPO_ESCRITA]
        : [ESCOPO_LEITURA],
    exp: Date.now() + VIDA_DO_CODIGO_MS,
  };
  return selar(codigo, "codigo");
}

/**
 * Recebe tudo **menos** o `jti`, e gera um novo. Assim nenhum sítio de chamada
 * consegue esquecer de gerar, nem reaproveitar sem querer o `jti` do envelope
 * anterior — o que faria dois refresh tokens diferentes disputarem a mesma
 * entrada da janela de idempotência.
 */
function emitirTokens(dados: Omit<Refresh, "jti">): OAuthTokens {
  const restante = dados.apiExp - Math.floor(Date.now() / 1000) - MARGEM_S;
  if (restante < PISO_S) {
    throw new InvalidGrantError("A sessão do Yu-book está no fim. Autorize de novo.");
  }

  const completo: Refresh = { ...dados, jti: randomUUID() };

  return {
    access_token: assinarToken(
      {
        sub: dados.userId,
        cid: dados.clientId,
        scope: dados.escopos.join(" "),
        aud: env.urlPublica ?? "",
        // Selado, e não em claro: ver o comentário de `atk` em `segredos.ts`.
        atk: selar(dados.apiTok, "credencial"),
        axp: dados.apiExp,
      },
      restante,
    ),
    token_type: "Bearer",
    expires_in: restante,
    scope: dados.escopos.join(" "),
    refresh_token: selar(completo, "refresh"),
  };
}

/**
 * A REGRA DE CLASSIFICAÇÃO DO ERRO, e ela decide o que o cliente faz a seguir.
 *
 *   401 da API   →  `invalid_grant`  →  a autorização morreu, abra o navegador
 *   5xx ou rede  →  `server_error`   →  volte daqui a pouco
 *
 * Antes desta função, `renovarNaApi` lançava `Error` simples e o handler do SDK
 * embrulhava tudo em `ServerError`: uma sessão de verdade morta virava 500, e o
 * cliente retentava para sempre sem nunca reautorizar. `invalid_grant` é o
 * único código que faz um cliente OAuth abrir o navegador — emiti-lo por engano
 * gasta a atenção do operador com uma API que só piscou, e não emiti-lo nunca
 * deixa o cliente girando em falso.
 */
async function renovarTraduzindoOErro(refresh: string): Promise<CredencialDaApi> {
  try {
    return await renovarNaApi(refresh);
  } catch (erro) {
    if (erro instanceof ErroDaApi && erro.status === 401) {
      throw new InvalidGrantError("A sessão do Yu-book expirou. Autorize de novo.");
    }
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new ServerError(`Não foi possível falar com a API do Yu-book: ${detalhe}`);
  }
}

/** O corpo da renovação, separado para a janela poder guardar a promessa dele. */
async function renovarEEmitir(dados: Refresh, escoposPedidos?: string[]): Promise<OAuthTokens> {
  // UMA renovação do MCP é UMA renovação da API, e é o que mantém o compasso:
  // o cookie do envelope rotaciona exatamente quando o token do MCP é
  // reemitido, então o envelope nunca fica obsoleto. É também o que faz um
  // redeploy da Railway não expulsar ninguém sem nada persistido em disco.
  const credencial = await renovarTraduzindoOErro(dados.refresh);

  // Escopo pedido só pode **reduzir** o concedido, nunca ampliar.
  const escopos = escoposPedidos?.length
    ? dados.escopos.filter((e) => escoposPedidos.includes(e))
    : dados.escopos;

  return emitirTokens({
    ...dados,
    escopos,
    refresh: credencial.refresh,
    apiTok: credencial.accessToken,
    apiExp: Math.floor(credencial.expiraEm / 1000),
  });
}

export const provedor: OAuthServerProvider = {
  get clientsStore() {
    return registroDeClientes;
  },

  /**
   * Não valida credencial e **não vê senha nenhuma** — o SDK não entrega o
   * `req` aqui, só `(client, params, res)`. Por isso o formulário não pode
   * postar de volta para `/authorize`: ele posta para `/login`, que é rota
   * nossa. O `redirect_uri` já foi validado contra os registrados pelo handler
   * do SDK antes de chegar aqui; não revalidar.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const pedido: Pedido = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state !== undefined && { state: params.state }),
      ...(params.resource !== undefined && { resource: params.resource.href }),
      exp: Date.now() + 10 * 60_000,
    };

    res
      .set(CABECALHOS_DA_PAGINA)
      .send(
        paginaDeLogin({
          pedido: selar(pedido, "pedido"),
          nomeDoCliente: client.client_name ?? "Um cliente MCP",
        }),
      );
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const codigo = abrir<Codigo>(authorizationCode, "codigo");
    if (!codigo || codigo.clientId !== client.client_id || codigo.exp < Date.now()) {
      throw new InvalidGrantError("Código de autorização inválido ou expirado.");
    }
    return codigo.codeChallenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _verificador, redirectUri) {
    const codigo = abrir<Codigo>(authorizationCode, "codigo");
    if (!codigo || codigo.clientId !== client.client_id) {
      throw new InvalidGrantError("Código de autorização inválido.");
    }
    if (codigo.exp < Date.now()) throw new InvalidGrantError("Código de autorização expirado.");
    if (redirectUri !== undefined && redirectUri !== codigo.redirectUri) {
      throw new InvalidGrantError("redirect_uri não confere com o da autorização.");
    }
    // Uso único: um código interceptado não vale duas vezes.
    if (codigosUsados.has(codigo.jti)) {
      throw new InvalidGrantError("Código de autorização já usado.");
    }
    codigosUsados.add(codigo.jti);
    setTimeout(() => codigosUsados.delete(codigo.jti), VIDA_DO_CODIGO_MS).unref();

    return emitirTokens({
      clientId: codigo.clientId,
      userId: codigo.userId,
      refresh: codigo.refresh,
      escopos: codigo.escopos,
      apiTok: codigo.apiTok,
      apiExp: codigo.apiExp,
    });
  },

  async exchangeRefreshToken(client, refreshToken, escoposPedidos) {
    const dados = abrir<Refresh>(refreshToken, "refresh");
    if (!dados || dados.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token inválido.");
    }
    // Envelope emitido antes da janela de idempotência existir. Com o mesmo
    // `MCP_SEGREDO` ele abre, e não tem `jti` — sem esta guarda, `undefined`
    // vira uma chave de mapa **compartilhada entre usuários diferentes**, e um
    // deles receberia o par do outro.
    if (typeof dados.jti !== "string") {
      throw new InvalidGrantError("Refresh token de uma versão anterior. Autorize de novo.");
    }

    const emAndamento = renovacoes.get(dados.jti);
    if (emAndamento) return emAndamento;

    // A ORDEM AQUI É O ASSUNTO INTEIRO DESTA JANELA.
    //
    // A promessa entra no mapa **antes** de qualquer `await`. O corpo de uma
    // função `async` roda síncrono até o primeiro `await`, então chamar sem
    // esperar e guardar em seguida é o que faz um pedido concorrente encontrar
    // a promessa em voo em vez de disparar uma segunda renovação — que
    // apresentaria o mesmo cookie duas vezes à API.
    //
    // Trocar isto por `const par = await renovarEEmitir(...)` e só então
    // guardar reabre a corrida inteira, em silêncio.
    const promessa = renovarEEmitir(dados, escoposPedidos);
    renovacoes.set(dados.jti, promessa);

    promessa.then(
      // Deu certo: fica retido, e quem repetir o pedido recebe o mesmo par sem
      // custar uma chamada nova à API.
      () => void setTimeout(() => renovacoes.delete(dados.jti), VIDA_DA_RENOVACAO_MS).unref(),
      // Falhou: sai na hora. Reter uma rejeição travaria o cliente por dois
      // minutos por causa de um blip de rede.
      () => void renovacoes.delete(dados.jti),
    );

    return promessa;
  },

  async revokeToken(_client, requisicao: OAuthTokenRevocationRequest) {
    const dados = abrir<Refresh>(requisicao.token, "refresh");
    if (!dados) return; // Token desconhecido: o padrão manda não fazer nada.

    // Revogar um token já trocado não pode deixar o par retido acessível pela
    // janela de idempotência.
    if (typeof dados.jti === "string") renovacoes.delete(dados.jti);

    // O cookie do envelope é o dono certo: ele é o que o cliente tem em mãos, e
    // desde que o mapa de sessões morreu não existe um segundo dono para ele.
    await sairDaApi(dados.refresh);
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const corpo = verificarToken(token);
    if (!corpo) throw new InvalidTokenError("Token inválido ou expirado.");

    // NENHUMA CONSULTA A ESTADO AQUI, e é deliberado. Tudo o que a
    // verificação precisa está dentro do token, então um reinício do processo
    // não invalida nada — antes, o mapa vazio recusava todo token vivo e
    // obrigava o cliente a renovar.
    //
    // O preço, declarado: revogar mata o refresh token na hora, mas um token de
    // acesso já emitido vale até expirar — no máximo 840 s, pelo compasso.
    // Cobrir esses catorze minutos exigiria trazer estado de volta.
    //
    // O token da API sai daqui decifrado e segue no `extra` até o handler, onde
    // `erros.ts` o põe no contexto assíncrono que o `cliente.ts` lê. **É este o
    // fio inteiro da identidade**: do consentimento no navegador até o
    // `Authorization` da chamada à `apps/api`.
    const tokenDaApi = abrir<string>(corpo.atk, "credencial");
    if (!tokenDaApi) throw new InvalidTokenError("Token sem credencial do Yu-book.");

    return {
      token,
      clientId: corpo.cid,
      scopes: corpo.scope.split(" ").filter(Boolean),
      expiresAt: corpo.exp,
      extra: { userId: corpo.sub, tokenDaApi },
    };
  },
};
