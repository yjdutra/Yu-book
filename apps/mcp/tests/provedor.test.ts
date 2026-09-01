import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { provedor, registroDeClientes } from "../src/auth/provedor.js";
import { abrir, assinarToken, selar, verificarToken } from "../src/auth/segredos.js";
import { renovarNaApi, sairDaApi } from "../src/auth/sessao-api.js";
import { ErroDaApi } from "../src/cliente.js";

/**
 * `renovarNaApi` e `sairDaApi` são as fronteiras de rede deste caminho, e é
 * exatamente o que precisa ser contado: os testes desta suíte provam **quantas
 * vezes** cada uma é chamada, e com qual cookie. O resto do módulo fica
 * original.
 */
vi.mock("../src/auth/sessao-api.js", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("../src/auth/sessao-api.js")>()),
  renovarNaApi: vi.fn(),
  sairDaApi: vi.fn(),
}));

const CLIENTE = { client_id: "cliente-1", redirect_uris: ["https://app.invalid/cb"] } as
  OAuthClientInformationFull;
const REDIRECT = "https://app.invalid/cb";

/**
 * Um código de autorização selado à mão. É o mesmo envelope que `emitirCodigo`
 * produz — construí-lo aqui evita ter que fazer um login de verdade na API só
 * para exercitar uma subtração.
 */
function codigoSelado(apiExpEmSegundos: number, apiTok = "TOKEN-DA-API"): string {
  return selar({
    jti: randomUUID(),
    clientId: CLIENTE.client_id,
    redirectUri: REDIRECT,
    codeChallenge: "desafio",
    userId: "usuario-1",
    refresh: "cookie-opaco",
    escopos: ["yubook:read"],
    exp: Date.now() + 60_000,
    apiTok,
    apiExp: Math.floor(Date.now() / 1000) + apiExpEmSegundos,
  }, "codigo");
}

const trocar = (codigo: string) =>
  provedor.exchangeAuthorizationCode(CLIENTE, codigo, undefined, REDIRECT);

afterEach(() => {
  vi.useRealTimers();
});

describe("o compasso com a API", () => {
  it("deriva a vida do token do prazo da API, em vez de fixá-la", async () => {
    // O defeito da Etapa B: `VIDA_DO_TOKEN_S = 3600`, fixo, enquanto o token da
    // API dura 900. O token do MCP sobrevivia ao que carregava, e o 401 caía
    // dentro de uma tool. Um número fixo faz este teste falhar.
    //
    // O relógio fica parado porque `codigoSelado` e `emitirTokens` leem
    // `Date.now()` em momentos diferentes: cruzando a fronteira do segundo, a
    // subtração daria 839 e o portão ficaria vermelho sem nada ter mudado.
    vi.useFakeTimers({ toFake: ["Date"] });

    expect((await trocar(codigoSelado(900))).expires_in).toBe(840);
    expect((await trocar(codigoSelado(300))).expires_in).toBe(240);
  });

  it("entrega o token da API dentro do token do MCP, cifrado", async () => {
    const par = await trocar(codigoSelado(900, "TOKEN-ESPECIFICO-DESTE-TESTE"));

    // Em lugar nenhum do token emitido o segredo aparece legível — o corpo de
    // um JWT é base64url, e quem tem o token lê tudo o que não estiver cifrado.
    expect(par.access_token).not.toContain("TOKEN-ESPECIFICO-DESTE-TESTE");
    const legivel = Buffer.from(par.access_token.split(".")[1] ?? "", "base64url").toString("utf8");
    expect(legivel).not.toContain("TOKEN-ESPECIFICO-DESTE-TESTE");

    // E o servidor, que tem a chave, continua alcançando o conteúdo.
    const corpo = verificarToken(par.access_token);
    expect(corpo).not.toBeNull();
    expect(abrir<string>(corpo!.atk, "credencial")).toBe("TOKEN-ESPECIFICO-DESTE-TESTE");
  });

  it("na última fração de vida do token do MCP, o da API ainda tem a margem", async () => {
    // O critério de pronto da etapa. O token do MCP tem que morrer **antes** do
    // que ele carrega, e com folga suficiente para o cliente renovar sem que a
    // chamada seguinte caia num 401 vindo de dentro de uma tool.
    const par = await trocar(codigoSelado(900));
    const corpo = verificarToken(par.access_token)!;

    // Um segundo antes de o token do MCP expirar.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((corpo.exp - 1) * 1000);

    // Ele ainda vale...
    expect(verificarToken(par.access_token)).not.toBeNull();
    // ...e o token da API lá dentro ainda tem a margem inteira, menos o segundo.
    expect(corpo.axp - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(59);
  });

  it("recusa emitir um token curto demais para servir", async () => {
    // O piso. Por construção não dispara; existe para o dia em que alguém
    // esticar a vida do código de autorização e o servidor passar a entregar
    // tokens de cinco segundos sem ninguém perceber.
    await expect(trocar(codigoSelado(100))).rejects.toThrow(/Autorize de novo/);
  });

  it("recusa um código de autorização apresentado como refresh token", async () => {
    // O desvio, no nível do provedor. Antes do rótulo do envelope, esta chamada
    // devolvia um token com `yubook:read yubook:write` — contornando de uma vez
    // o uso único, o `exp` de 60 s e o PKCE, que são as três defesas que o
    // código de autorização declara ter.
    const codigo = codigoSelado(900);
    await expect(provedor.exchangeRefreshToken(CLIENTE, codigo)).rejects.toThrow(
      /Refresh token inválido/,
    );
  });

  it("mantém o código de autorização de uso único", async () => {
    // Regressão da Etapa B: um código interceptado não vale duas vezes.
    const codigo = codigoSelado(900);
    await trocar(codigo);
    await expect(trocar(codigo)).rejects.toThrow(/já usado/);
  });
});

describe("a janela de idempotência da renovação", () => {
  /** Um refresh token selado à mão, com o `jti` que a janela usa como chave. */
  function refreshSelado(): string {
    return selar(
      {
        jti: randomUUID(),
        clientId: CLIENTE.client_id,
        userId: "usuario-1",
        refresh: "R0",
        escopos: ["yubook:read"],
        apiTok: "TOKEN-VELHO",
        apiExp: Math.floor(Date.now() / 1000) + 900,
      },
      "refresh",
    );
  }

  const renovar = vi.mocked(renovarNaApi);

  /** O que a API devolveria numa renovação bem-sucedida. */
  const credencial = () => ({
    accessToken: "TOKEN-NOVO",
    refresh: "R1",
    expiraEm: Date.now() + 900_000,
  });

  beforeEach(() => {
    renovar.mockReset();
  });

  it("duas renovações simultâneas custam UMA chamada à API", async () => {
    // Sem a janela, as duas apresentariam o mesmo cookie `yb_refresh` à API. A
    // rotação de lá é atômica, então uma das duas tomaria 401 — o cliente
    // perderia uma renovação por ter pedido duas coisas ao mesmo tempo.
    renovar.mockResolvedValue(credencial());
    const token = refreshSelado();

    const [a, b] = await Promise.all([
      provedor.exchangeRefreshToken(CLIENTE, token),
      provedor.exchangeRefreshToken(CLIENTE, token),
    ]);

    expect(renovar).toHaveBeenCalledTimes(1);
    expect(a.access_token).toBe(b.access_token);
    expect(a.refresh_token).toBe(b.refresh_token);
  });

  it("repetir o pedido depois da resposta devolve o mesmo par, sem nova chamada", async () => {
    // O acidente que a janela existe para cobrir: a resposta se perdeu no
    // caminho de volta e o cliente repetiu. O cookie da API já foi consumido —
    // sem a janela isto seria 401, e um agente autônomo pararia pedindo
    // navegador.
    renovar.mockResolvedValue(credencial());
    const token = refreshSelado();

    const primeiro = await provedor.exchangeRefreshToken(CLIENTE, token);
    const repetido = await provedor.exchangeRefreshToken(CLIENTE, token);

    expect(renovar).toHaveBeenCalledTimes(1);
    expect(repetido.access_token).toBe(primeiro.access_token);
  });

  it("uma falha não gruda na janela: a tentativa seguinte alcança a API", async () => {
    // Reter a rejeição travaria o cliente por dois minutos por causa de um blip.
    renovar.mockRejectedValueOnce(new ErroDaApi(503, "INTERNAL_ERROR", "fora do ar"));
    renovar.mockResolvedValue(credencial());
    const token = refreshSelado();

    await expect(provedor.exchangeRefreshToken(CLIENTE, token)).rejects.toThrow();
    await expect(provedor.exchangeRefreshToken(CLIENTE, token)).resolves.toHaveProperty(
      "access_token",
    );
    expect(renovar).toHaveBeenCalledTimes(2);
  });
});

describe("o que o cliente deve fazer quando a renovação falha", () => {
  function refreshSelado(dados: Record<string, unknown> = {}): string {
    return selar(
      {
        jti: randomUUID(),
        clientId: CLIENTE.client_id,
        userId: "usuario-1",
        refresh: "R0",
        escopos: ["yubook:read"],
        apiTok: "TOKEN-VELHO",
        apiExp: Math.floor(Date.now() / 1000) + 900,
        ...dados,
      },
      "refresh",
    );
  }

  const renovar = vi.mocked(renovarNaApi);
  // As chaves não são estilo: sem elas a arrow devolve o próprio mock, e o
  // Vitest trata retorno de `beforeEach` como função de limpeza — ele chamaria
  // o mock depois de cada teste, gerando uma rejeição que ninguém trata.
  beforeEach(() => {
    renovar.mockReset();
  });

  /**
   * O código OAuth da recusa — que é o contrato de fio, e o que o cliente lê
   * para decidir entre reautorizar e retentar. Um ajudante porque
   * `toMatchObject({ errorCode })` não funciona: `errorCode` é getter de
   * protótipo no SDK, e o matcher só olha propriedade própria.
   */
  async function codigoDaRecusa(promessa: Promise<unknown>): Promise<string> {
    try {
      await promessa;
      return "não recusou";
    } catch (erro) {
      return (erro as { errorCode?: string }).errorCode ?? `sem código (${String(erro)})`;
    }
  }

  it("401 da API vira invalid_grant — a autorização morreu, abra o navegador", async () => {
    renovar.mockRejectedValue(new ErroDaApi(401, "UNAUTHORIZED", "Sessão expirada"));
    const codigo = await codigoDaRecusa(provedor.exchangeRefreshToken(CLIENTE, refreshSelado()));
    expect(codigo).toBe("invalid_grant");
  });

  it("5xx da API vira server_error — volte daqui a pouco, não reautorize", async () => {
    // A distinção importa: `invalid_grant` é o único código que faz um cliente
    // OAuth abrir o navegador. Emiti-lo porque a API piscou gasta a atenção do
    // operador com um problema que se resolve sozinho.
    renovar.mockRejectedValue(new ErroDaApi(503, "INTERNAL_ERROR", "fora do ar"));
    const codigo = await codigoDaRecusa(provedor.exchangeRefreshToken(CLIENTE, refreshSelado()));
    expect(codigo).toBe("server_error");
  });

  it("queda de rede vira server_error, e não invalid_grant", async () => {
    renovar.mockRejectedValue(new TypeError("fetch failed"));
    const codigo = await codigoDaRecusa(provedor.exchangeRefreshToken(CLIENTE, refreshSelado()));
    expect(codigo).toBe("server_error");
  });

  it("refresh token de uma versão anterior é recusado sem tocar na API", async () => {
    // Sem `jti`, `undefined` viraria chave de mapa compartilhada entre usuários
    // diferentes — e um deles receberia o par do outro.
    const semJti = selar(
      {
        clientId: CLIENTE.client_id,
        userId: "usuario-1",
        refresh: "R0",
        escopos: ["yubook:read"],
        apiTok: "T",
        apiExp: Math.floor(Date.now() / 1000) + 900,
      },
      "refresh",
    );

    expect(await codigoDaRecusa(provedor.exchangeRefreshToken(CLIENTE, semJti))).toBe(
      "invalid_grant",
    );
    expect(renovar).not.toHaveBeenCalled();
  });
});

describe("o servidor sem estado", () => {
  // `revokeToken` é opcional na interface do SDK. Conferir aqui, uma vez, vale
  // mais que espalhar `!` pelos testes: se ele sumir do provedor, a suíte diz
  // isso em vez de estourar num ponto qualquer.
  const revogar = provedor.revokeToken;
  if (!revogar) throw new Error("o provedor precisa implementar revokeToken");

  /** Um refresh token selado à mão, como o que o cliente teria em mãos. */
  function refreshSelado(refresh: string): string {
    return selar(
      {
        jti: randomUUID(),
        clientId: CLIENTE.client_id,
        userId: "usuario-1",
        refresh,
        escopos: ["yubook:read"],
        apiTok: "TOKEN-DA-API",
        apiExp: Math.floor(Date.now() / 1000) + 900,
      },
      "refresh",
    );
  }

  it("verifica um token sem que nenhuma autorização tenha acontecido aqui", async () => {
    // O ponto da etapa. Este token foi assinado agora, do nada — nenhum
    // `authorize`, nenhum `/login`, nada guardado em lugar nenhum. Antes de a
    // etapa apagar o mapa de sessões, isto respondia "Sessão do Yu-book não
    // está mais viva": era o que fazia um reinício do processo derrubar todo
    // token vivo.
    const token = assinarToken(
      {
        sub: "usuario-nunca-visto",
        cid: CLIENTE.client_id,
        scope: "yubook:read yubook:write",
        aud: "https://mcp.teste.invalid",
        atk: selar("TOKEN-DA-API", "credencial"),
        axp: Math.floor(Date.now() / 1000) + 900,
      },
      840,
    );

    const info = await provedor.verifyAccessToken(token);

    expect(info.extra).toMatchObject({ userId: "usuario-nunca-visto", tokenDaApi: "TOKEN-DA-API" });
    expect(info.scopes).toEqual(["yubook:read", "yubook:write"]);
  });

  it("recusa token sem a credencial da API dentro", async () => {
    // A guarda que a C.1 pôs não pode ter saído junto com o mapa: sem ela,
    // `abrir(undefined)` estoura e o cliente recebe 500 em vez do 401 que o
    // faria renovar.
    const { atk: _atk, ...semCredencial } = {
      sub: "u1",
      cid: CLIENTE.client_id,
      scope: "yubook:read",
      aud: "https://mcp.teste.invalid",
      atk: selar("T", "credencial"),
      axp: Math.floor(Date.now() / 1000) + 900,
    };
    const token = assinarToken(semCredencial as Parameters<typeof assinarToken>[0], 840);

    await expect(provedor.verifyAccessToken(token)).rejects.toThrow();
  });

  it("revoga usando o cookie do envelope, o único dono que sobrou", async () => {
    // Enquanto havia um mapa, `revokeToken` preferia a sessão guardada e só
    // caía no envelope se não achasse — dois donos para o mesmo cookie.
    const sair = vi.mocked(sairDaApi);
    sair.mockClear();

    await revogar(CLIENTE, { token: refreshSelado("R-DO-ENVELOPE") });

    expect(sair).toHaveBeenCalledExactlyOnceWith("R-DO-ENVELOPE");
  });

  it("revogar limpa a entrada retida na janela de idempotência", async () => {
    const renovar = vi.mocked(renovarNaApi);
    renovar.mockReset();
    renovar.mockResolvedValue({
      accessToken: "TOKEN-NOVO",
      refresh: "R1",
      expiraEm: Date.now() + 900_000,
    });
    const token = refreshSelado("R0");

    const primeiro = await provedor.exchangeRefreshToken(CLIENTE, token);
    await revogar(CLIENTE, { token });
    const depois = await provedor.exchangeRefreshToken(CLIENTE, token);

    // Sem a limpeza, o segundo pedido receberia o par retido sem tocar na API.
    expect(renovar).toHaveBeenCalledTimes(2);
    expect(depois.access_token).not.toBe(primeiro.access_token);
  });
});

describe("o registro de clientes", () => {
  /** O cadastro que o handler de DCR do SDK entrega. */
  const cadastro = (uri: string) =>
    ({ client_id: "descartado", redirect_uris: [uri] }) as unknown as OAuthClientInformationFull;

  it("devolve como client_id o envelope apresentado, não o que ficou dentro dele", async () => {
    // O DEFEITO QUE ISTO FIXA: `registerClient` sela o cadastro enquanto
    // `client_id` ainda é `""` — a atribuição do envelope vem depois. Sem a
    // correção, `getClient` devolvia `""` para **todo** cliente, e as três
    // comparações de `clientId` do provedor viravam `"" !== ""`: tautologia.
    // O fluxo feliz funcionava idêntico nos dois casos, porque quem valida o
    // `redirect_uri` é o SDK. O que se perdia era a ligação refresh↔cliente.
    const a = await registroDeClientes.registerClient!(cadastro("https://a.invalid/cb"));
    const b = await registroDeClientes.registerClient!(cadastro("https://b.invalid/cb"));

    const abertoA = await registroDeClientes.getClient(a.client_id);
    const abertoB = await registroDeClientes.getClient(b.client_id);

    expect(abertoA?.client_id).toBe(a.client_id);
    expect(abertoB?.client_id).toBe(b.client_id);
    expect(abertoA?.client_id).not.toBe(abertoB?.client_id);
    // E o resto do cadastro continua intacto — é ele que o SDK valida.
    expect(abertoA?.redirect_uris).toEqual(["https://a.invalid/cb"]);
  });

  it("um refresh token de um cliente não vale no outro", async () => {
    // A consequência prática do defeito acima, com registro dinâmico aberto:
    // um refresh token vazado valeria em qualquer cliente registrado.
    const a = await registroDeClientes.registerClient!(cadastro("https://a.invalid/cb"));
    const b = await registroDeClientes.registerClient!(cadastro("https://b.invalid/cb"));

    const doA = selar(
      {
        jti: randomUUID(),
        clientId: a.client_id,
        userId: "usuario-1",
        refresh: "R0",
        escopos: ["yubook:read"],
        apiTok: "T",
        apiExp: Math.floor(Date.now() / 1000) + 900,
      },
      "refresh",
    );

    const clienteB = (await registroDeClientes.getClient(b.client_id))!;
    await expect(provedor.exchangeRefreshToken(clienteB, doA)).rejects.toThrow(
      /Refresh token inválido/,
    );
  });
});
