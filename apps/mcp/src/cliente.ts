import { AsyncLocalStorage } from "node:async_hooks";
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

/**
 * DE QUEM É A CREDENCIAL DESTA CHAMADA.
 *
 * Sob HTTP um processo atende muitos clientes, e a identidade tem que ser a de
 * **quem fez a requisição** — não a de uma variável de módulo, que seria a
 * mesma para todo mundo. Ela entra aqui em `erros.ts`, nos invólucros que
 * envolvem todo handler, lendo o `authInfo` que o SDK anexa à requisição.
 *
 * Contexto assíncrono, e não um portador mutável guardado na sessão: a sessão
 * MCP vive 30 minutos e o token 14, e duas requisições concorrentes da mesma
 * sessão sobrescreveriam o portador uma da outra. O `AsyncLocalStorage` amarra
 * o token ao fluxo da requisição, então chamadas paralelas não se enxergam.
 */
const identidadeDaRequisicao = new AsyncLocalStorage<string>();

/** Roda `fn` com o token da API de quem fez a requisição. Ver `erros.ts`. */
export function comIdentidadeDaApi<T>(tokenDaApi: string, fn: () => T): T {
  return identidadeDaRequisicao.run(tokenDaApi, fn);
}

/**
 * A credencial do ambiente, que só existe no stdio — ali há um processo por
 * pessoa e o processo é dela, então a conta no `.env` **é** a identidade.
 */
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
 * De onde sai o `Bearer` desta chamada. A decisão é total de propósito — os
 * três casos estão aqui, e não há um quarto.
 *
 *   contexto presente     a identidade de quem chamou. Não há senha para logar
 *   sem contexto, http    **recusa** — nunca a conta do ambiente
 *   sem contexto, stdio   a conta do `.env`, que ali é a identidade correta
 *
 * A recusa é a segunda tranca. A primeira é o `superRefine` de `env.ts`, que
 * proíbe `YUBOOK_EMAIL` sob HTTP. Uma bastaria; as duas juntas tornam
 * impossível uma requisição HTTP falar com a API como o dono do `.env`.
 */
async function credencialDaChamada(): Promise<string> {
  const daRequisicao = identidadeDaRequisicao.getStore();
  if (daRequisicao) return daRequisicao;

  if (env.ehHttp) {
    throw new ErroDaApi(
      500,
      "SEM_IDENTIDADE",
      "Esta chamada chegou à API sem a identidade de quem pediu. É defeito do servidor MCP, " +
        "não do pedido: alguma chamada está acontecendo fora de comErro/comErroDeResource.",
    );
  }

  if (!accessToken) await entrar();
  if (!accessToken) throw new ErroDaApi(500, "SEM_IDENTIDADE", "Login no Yu-book não produziu token.");
  return accessToken;
}

/**
 * Uma requisição à `apps/api`, com a credencial de quem pediu.
 *
 * No stdio o servidor entra com email e senha e reentra quando o token de 15
 * min expira — a conta é uma só e as credenciais estão no ambiente. Sob HTTP
 * nada disso existe: o token vem de dentro do token OAuth que o cliente
 * apresentou (ver `auth/segredos.ts`), e **não há senha aqui** para reentrar.
 */
async function requisitar<T>(
  metodo: string,
  caminho: string,
  opcoes: { busca?: URLSearchParams; corpo?: unknown } = {},
): Promise<T> {
  const credencial = await credencialDaChamada();

  const { busca, corpo } = opcoes;
  const url = `${env.YUBOOK_API_URL}${caminho}${busca?.size ? `?${busca}` : ""}`;
  // Serializado uma vez só: o retry de 401 reenvia a mesma string. É seguro
  // porque a primeira tentativa foi recusada na autenticação, antes de chegar
  // ao service — nenhuma escrita aconteceu para ser repetida.
  const conteudo = corpo === undefined ? undefined : JSON.stringify(corpo);

  const enviar = (bearer: string) =>
    fetch(url, {
      method: metodo,
      headers: {
        "X-Yu-Book-Client": "web",
        ...(conteudo !== undefined && { "Content-Type": "application/json" }),
        Authorization: `Bearer ${bearer}`,
      },
      ...(conteudo !== undefined && { body: conteudo }),
    });

  let resposta = await enviar(credencial);

  // O RETRY DE 401 SÓ EXISTE NO STDIO, e não é economia de código tê-lo aqui
  // sozinho: sob HTTP **não há como reentrar**, porque o servidor não tem a
  // senha de ninguém — e é isso que esta fase existe para garantir.
  //
  // Pelo compasso de `auth/provedor.ts`, o token do MCP morre 60 s antes do
  // token da API que ele carrega, então o 401 devia cair na fronteira HTTP,
  // onde o cliente sabe renovar. Um 401 chegando aqui é anomalia; vira erro com
  // instrução, e `erros.ts` traduz por transporte.
  //
  // TOKEN_EXPIRED e UNAUTHORIZED são distintos de propósito na API (INV-05),
  // mas daqui os dois levam ao mesmo lugar.
  if (resposta.status === 401 && !identidadeDaRequisicao.getStore()) {
    accessToken = null;
    await entrar();
    if (accessToken) resposta = await enviar(accessToken);
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
 * Os quatro verbos que o servidor usa, e nenhum deles recebe identidade por
 * parâmetro — ela vem do contexto assíncrono, aberto em `erros.ts`.
 *
 * Foi o que permitiu a identidade por requisição entrar sem tocar em **nenhum**
 * dos 16 sítios de chamada. O preço é que ela fica ambiente: uma chamada de API
 * escrita fora de `comErro`/`comErroDeResource` não toma erro de compilação —
 * toma a recusa de `credencialDaChamada`, em tempo de execução e só sob HTTP.
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
