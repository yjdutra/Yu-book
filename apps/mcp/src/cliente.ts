import type { ApiErrorBody, AuthResponse } from "@yu-book/shared";
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
async function requisitar<T>(caminho: string, busca?: URLSearchParams): Promise<T> {
  if (!accessToken) await entrar();

  const url = `${env.YUBOOK_API_URL}${caminho}${busca?.size ? `?${busca}` : ""}`;

  const enviar = () =>
    fetch(url, {
      headers: {
        "X-Yu-Book-Client": "web",
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
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
    const corpo = (await resposta.json().catch(() => null)) as ApiErrorBody | null;
    throw new ErroDaApi(
      resposta.status,
      corpo?.error.code ?? "INTERNAL_ERROR",
      corpo?.error.message ?? `A API respondeu ${resposta.status}.`,
    );
  }

  return (await resposta.json()) as T;
}

export const api = {
  get: requisitar,
};
