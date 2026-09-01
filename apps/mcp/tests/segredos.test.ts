import { describe, expect, it } from "vitest";
import { abrir, assinarToken, selar, verificarToken } from "../src/auth/segredos.js";

const AUD = "https://mcp.teste.invalid";

/** Um corpo válido, para cada teste mexer só no campo que lhe interessa. */
function corpo(ajustes: Partial<Parameters<typeof assinarToken>[0]> = {}) {
  const agora = Math.floor(Date.now() / 1000);
  return {
    sub: "usuario-1",
    cid: "cliente-1",
    scope: "yubook:read",
    aud: AUD,
    atk: selar("TOKEN-DA-API-EM-CLARO", "credencial"),
    axp: agora + 900,
    ...ajustes,
  };
}

describe("envelope", () => {
  it("volta igual ao que entrou", () => {
    const dados = { userId: "u1", refresh: "cookie-opaco" };
    expect(abrir(selar(dados, "refresh"), "refresh")).toEqual(dados);
  });

  it("recusa envelope adulterado em vez de devolver lixo", () => {
    const envelope = selar({ userId: "u1" }, "refresh");
    const [iv, tag, texto] = envelope.split(".") as [string, string, string];
    // Vira um bit do corpo cifrado: o `authTag` do GCM tem que perceber.
    const virado = Buffer.from(texto, "base64url");
    virado[0] = (virado[0] ?? 0) ^ 0x01;
    expect(abrir(`${iv}.${tag}.${virado.toString("base64url")}`, "refresh")).toBeNull();
  });
});

describe("o rótulo do envelope", () => {
  it("recusa um envelope apresentado como se fosse de outro tipo", () => {
    // O DESVIO QUE ISTO FECHA, confirmado contra o servidor de pé: `Codigo` tem
    // todos os campos de `Refresh`, então um código de autorização se abria como
    // refresh token válido. Cifra igual, forma compatível — só o rótulo separa.
    const codigo = { userId: "u1", refresh: "R0", clientId: "c1", escopos: ["yubook:write"] };
    const envelope = selar(codigo, "codigo");

    expect(abrir(envelope, "codigo")).toEqual(codigo);
    expect(abrir(envelope, "refresh")).toBeNull();
    expect(abrir(envelope, "cliente")).toBeNull();
  });
});

describe("token de acesso", () => {
  it("não expõe o token da API para quem tem o token do MCP", () => {
    // O ataque que este teste fixa: o corpo de um JWT é base64url, não cifra.
    // Se o token da API viajasse legível, o cliente MCP falaria direto com a
    // `apps/api`, contornando todo escopo que este servidor confere.
    const token = assinarToken(corpo(), 840);
    const legivel = Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8");

    expect(legivel).not.toContain("TOKEN-DA-API-EM-CLARO");

    const verificado = verificarToken(token);
    expect(verificado).not.toBeNull();
    // E o servidor, que tem a chave, continua alcançando o conteúdo.
    expect(abrir<string>(verificado!.atk, "credencial")).toBe("TOKEN-DA-API-EM-CLARO");
  });

  it("recusa token cujo `axp` já passou", () => {
    // Por construção não acontece — `exp` é derivado de `axp` menos a margem.
    // O teste existe para o dia em que alguém trocar a derivação por um número
    // fixo: o desalinhamento tem que aparecer como 401 na fronteira.
    const agora = Math.floor(Date.now() / 1000);
    const token = assinarToken(corpo({ axp: agora - 1 }), 840);
    expect(verificarToken(token)).toBeNull();
  });

  it("recusa token emitido para outro servidor", () => {
    const token = assinarToken(corpo({ aud: "https://outro.invalid" }), 840);
    expect(verificarToken(token)).toBeNull();
  });

  it("recusa assinatura adulterada", () => {
    const token = assinarToken(corpo(), 840);
    const [cabecalho, corpoB64] = token.split(".") as [string, string, string];
    expect(verificarToken(`${cabecalho}.${corpoB64}.assinatura-inventada`)).toBeNull();
  });

  it("recusa token de uma versão anterior, que não carregava a credencial", () => {
    // Com o mesmo `MCP_SEGREDO`, um token da Etapa B passa pela assinatura —
    // é o que faz um redeploy não expulsar ninguém. Ele precisa virar 401, e
    // não 500: só o 401 faz o cliente renovar.
    const { atk: _atk, axp: _axp, ...semCredencial } = corpo();
    const token = assinarToken(semCredencial as ReturnType<typeof corpo>, 840);
    expect(verificarToken(token)).toBeNull();
  });

  it("recusa token vencido", () => {
    expect(verificarToken(assinarToken(corpo(), -1))).toBeNull();
  });
});
