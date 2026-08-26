import type { ApiErrorBody, AuthResponse, FieldIssue } from "@yu-book/shared";
import { env } from "./env.js";

/**
 * Erro da API preservando o `code` estável. Espelha `ApiError` de
 * `apps/web/src/lib/api.ts`: quem chama ramifica por `code`, nunca por
 * `message` — a mensagem é para humano, o código é o contrato.
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * O detalhe da recusa de validação. A API responde a `ZodError` com
     * `message: "Dados inválidos"` e joga tudo o que interessa em `issues`
     * (`apps/api/src/app.ts`). Guardar só a mensagem daria ao modelo uma frase
     * sem informação — tolerável enquanto o servidor só lia, inútil agora que
     * ele escreve e erra por campo.
     */
    readonly issues?: FieldIssue[],
  ) {
    super(message);
    this.name = "ErroDaApi";
  }
}

let accessToken: string | null = null;
/**
 * Uma renovação de cada vez. Duas tools chamadas em paralelo tomam 401 juntas;
 * sem isto, cada uma dispararia um login. Mesmo motivo do voo único de
 * `refreshSession()` no front.
 */
let entrando: Promise<void> | null = null;

async function entrar(): Promise<void> {
  entrando ??= (async () => {
    try {
      const resposta = await fetch(`${env.YUBOOK_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Yu-Book-Client": "web" },
        body: JSON.stringify({ email: env.YUBOOK_EMAIL, password: env.YUBOOK_PASSWORD }),
      });

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as ApiErrorBody | null;
        throw new ErroDaApi(
          resposta.status,
          corpo?.error.code ?? "INTERNAL_ERROR",
          corpo?.error.message ?? "Não foi possível entrar na API do Yu-book.",
          corpo?.error.issues,
        );
      }

      const dados = (await resposta.json()) as AuthResponse;
      accessToken = dados.accessToken;
    } finally {
      entrando = null;
    }
  })();

  await entrando;
}

/**
 * O refresh token vive num cookie httpOnly restrito ao path `/auth`, e o fetch
 * do Node não guarda cookie. Em vez de manter um cookie jar, o servidor
 * simplesmente entra de novo quando o token de 15 min expira — a conta é uma
 * só e as credenciais já estão no ambiente. Quando o transporte virar HTTP e a
 * autenticação sair do `.env` (Advanced Topics), isto é o primeiro a mudar.
 */
async function requisitar<T>(
  metodo: string,
  caminho: string,
  opcoes: { busca?: URLSearchParams; corpo?: unknown } = {},
): Promise<T> {
  if (!accessToken) await entrar();

  const { busca, corpo } = opcoes;
  const url = `${env.YUBOOK_API_URL}${caminho}${busca?.size ? `?${busca}` : ""}`;
  // Serializado uma vez só: o retry de 401 reenvia a mesma string. É seguro
  // porque a primeira tentativa foi recusada na autenticação, antes de chegar
  // ao service — nenhuma escrita aconteceu para ser repetida.
  const conteudo = corpo === undefined ? undefined : JSON.stringify(corpo);

  const enviar = () =>
    fetch(url, {
      method: metodo,
      headers: {
        "X-Yu-Book-Client": "web",
        ...(conteudo !== undefined && { "Content-Type": "application/json" }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      ...(conteudo !== undefined && { body: conteudo }),
    });

  let resposta = await enviar();

  // TOKEN_EXPIRED e UNAUTHORIZED são distintos de propósito na API (INV-05),
  // mas daqui os dois levam ao mesmo lugar: entrar de novo e repetir uma vez.
  if (resposta.status === 401) {
    accessToken = null;
    await entrar();
    resposta = await enviar();
  }

  if (!resposta.ok) {
    const corpoDoErro = (await resposta.json().catch(() => null)) as ApiErrorBody | null;
    throw new ErroDaApi(
      resposta.status,
      corpoDoErro?.error.code ?? "INTERNAL_ERROR",
      corpoDoErro?.error.message ?? `A API respondeu ${resposta.status}.`,
      corpoDoErro?.error.issues,
    );
  }

  // `DELETE /notes/:id` responde 204 sem corpo, e `.json()` de corpo vazio
  // lança. Quem chama nesse caminho tipa como `void` e ignora o retorno.
  if (resposta.status === 204) return undefined as T;

  return (await resposta.json()) as T;
}

/**
 * Os quatro verbos que o servidor usa. `get` mantém a assinatura antiga de
 * propósito: as cinco tools de leitura e os resources chamam `api.get(caminho,
 * busca)` e não deveriam mudar por causa da escrita.
 */
export const api = {
  get: <T>(caminho: string, busca?: URLSearchParams): Promise<T> =>
    requisitar<T>("GET", caminho, { busca }),
  post: <T>(caminho: string, corpo?: unknown): Promise<T> =>
    requisitar<T>("POST", caminho, { corpo }),
  patch: <T>(caminho: string, corpo: unknown): Promise<T> =>
    requisitar<T>("PATCH", caminho, { corpo }),
  remover: (caminho: string): Promise<void> => requisitar<void>("DELETE", caminho),
};
