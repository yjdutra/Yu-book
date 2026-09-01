import type { ApiErrorBody, AuthResponse } from "@yu-book/shared";
import { ErroDaApi } from "../cliente.js";
import { env } from "../env.js";

/**
 * As três operações de sessão contra a `apps/api`, e nenhum estado entre elas.
 *
 *   entrarNaApi   email e senha  →  token, cookie e prazo
 *   renovarNaApi  cookie         →  token, cookie novo e prazo
 *   sairDaApi     cookie         →  revoga de verdade, no banco da API
 *
 * Aqui houve um objeto de sessão de longa duração, com voo único e um cookie
 * jar. Ele morreu, e o motivo importa: **o estado migrou para dentro do token
 * do MCP**, cifrado (ver `segredos.ts`), e a proteção contra renovação dupla
 * migrou para a janela de idempotência de `provedor.ts`, chaveada pelo `jti`.
 * O voo único protegia um objeto de sessão contra ele mesmo e não cobria a
 * troca de refresh do OAuth, que renovava por fora dele; a janela cobre o
 * caminho inteiro. Guardar sessão aqui hoje só recriaria um segundo dono para
 * o mesmo cookie.
 *
 * O refresh do Yu-book é opaco, rotaciona a cada uso e vive num cookie
 * `httpOnly` restrito a `/auth`. Nada disso atrapalha servidor-a-servidor: não
 * há navegador, então `SameSite` e `Path` não são aplicados — basta mandar o
 * cabeçalho `Cookie` à mão. **A `apps/api` não muda uma linha.**
 */

const COOKIE = "yb_refresh";

function extrairRefresh(resposta: Response): string | null {
  for (const bruto of resposta.headers.getSetCookie()) {
    const par = bruto.split(";", 1)[0] ?? "";
    const [nome, ...resto] = par.split("=");
    if (nome?.trim() === COOKIE) return resto.join("=");
  }
  return null;
}

/** O que a API devolve num login ou numa renovação: token, cookie novo e prazo. */
export interface CredencialDaApi {
  accessToken: string;
  refresh: string;
  expiraEm: number;
}

/** Faz o login uma vez. A senha existe só como argumento e não é guardada. */
export async function entrarNaApi(
  email: string,
  senha: string,
): Promise<CredencialDaApi & { userId: string }> {
  const resposta = await fetch(`${env.YUBOOK_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Yu-Book-Client": "web" },
    body: JSON.stringify({ email, password: senha }),
  });

  if (!resposta.ok) {
    // Mesmo erro tipado de `renovarNaApi` e do `cliente.ts`: quem chama ramifica
    // por `status` e `code`, não por texto. Aqui o chamador é a rota `/login`,
    // que precisa distinguir "senha errada" de "a API caiu".
    const corpo = (await resposta.json().catch(() => null)) as ApiErrorBody | null;
    throw new ErroDaApi(
      resposta.status,
      corpo?.error.code ?? "INTERNAL_ERROR",
      corpo?.error.message ?? `A API respondeu ${resposta.status}.`,
      corpo?.error.issues,
    );
  }

  const refresh = extrairRefresh(resposta);
  if (!refresh) throw new Error("A API não devolveu o cookie de sessão.");

  const dados = (await resposta.json()) as AuthResponse;
  return {
    userId: dados.user.id,
    accessToken: dados.accessToken,
    refresh,
    expiraEm: Date.now() + dados.expiresIn * 1000,
  };
}

/**
 * Uma renovação contra a API: entra o cookie, saem o token, o cookie novo e o
 * prazo. Devolve os três porque `exchangeRefreshToken` precisa do **prazo** —
 * é dele que sai a vida do token do MCP, pelo compasso de `provedor.ts`.
 *
 * CUIDADO QUE VIAJA COM ESTA FUNÇÃO: a `apps/api` faz detecção de reuso de
 * refresh token. Apresentar duas vezes o mesmo `yb_refresh` — fora da janela de
 * graça de 30 s de `refresh()` em `apps/api/src/modules/auth/auth.service.ts` —
 * faz ela concluir que o token vazou e **revogar todas as sessões do usuário**,
 * inclusive a do navegador dele.
 *
 * Quem protege contra isso é a janela de idempotência de `provedor.ts`, chaveada
 * pelo `jti` do refresh token — **e ela protege por 120 s**, não para sempre.
 * Chamar esta função por fora dela é reabrir o buraco.
 *
 * O que fica em aberto, declarado: o cliente que guardou um refresh token
 * anterior e o reapresenta depois da janela — reinício, laptop fechado,
 * retentativa no dia seguinte — chega aqui com um `yb_refresh` consumido há
 * muito, cai fora da graça de 30 s da API e **derrubaria todas as sessões do
 * usuário**. Fechar isso exigiria estado no servidor, que é justamente o que
 * este desenho não tem.
 */
export async function renovarNaApi(refresh: string): Promise<CredencialDaApi> {
  const resposta = await fetch(`${env.YUBOOK_API_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "X-Yu-Book-Client": "web",
      Cookie: `${COOKIE}=${refresh}`,
    },
  });
  if (!resposta.ok) {
    // O STATUS PRECISA SOBREVIVER AO ERRO, e é por isso que aqui não vai um
    // `Error` qualquer. Quem chama ramifica por ele: 401 significa que a cadeia
    // de refresh morreu e o cliente tem que reautorizar; 5xx e queda de rede
    // significam "volte daqui a pouco". Um erro sem status colapsa os dois no
    // mesmo 500, e o cliente fica retentando uma sessão que nunca vai voltar.
    const corpo = (await resposta.json().catch(() => null)) as ApiErrorBody | null;
    throw new ErroDaApi(
      resposta.status,
      corpo?.error.code ?? "INTERNAL_ERROR",
      corpo?.error.message ?? "A sessão do Yu-book expirou. Autorize de novo.",
      corpo?.error.issues,
    );
  }

  const novo = extrairRefresh(resposta);
  const dados = (await resposta.json()) as AuthResponse;
  return {
    accessToken: dados.accessToken,
    // A API rotaciona: o cookie que voltou é o único que vale daqui em diante.
    // Se ela não mandou um, o velho segue sendo o corrente.
    refresh: novo ?? refresh,
    expiraEm: Date.now() + dados.expiresIn * 1000,
  };
}

/**
 * Revoga a sessão no banco da API — é o que faz `revokeToken` do OAuth
 * significar alguma coisa em vez de só esquecer localmente.
 *
 * Silencioso de propósito: revogação que falha não pode virar erro para quem
 * pediu para sair. E há um limite conhecido — a API revoga por
 * `updateMany ... where tokenHash = ?`, então um cookie de rotações atrás
 * responde sem revogar nada (`count = 0`, sem erro). Consertar isso exige uma
 * coluna `replacedById` no schema da API, para o logout andar a cadeia.
 */
export async function sairDaApi(refresh: string): Promise<void> {
  await fetch(`${env.YUBOOK_API_URL}/auth/logout`, {
    method: "POST",
    headers: { "X-Yu-Book-Client": "web", Cookie: `${COOKIE}=${refresh}` },
  }).catch(() => {});
}
