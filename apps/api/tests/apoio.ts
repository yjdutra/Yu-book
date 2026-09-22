import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { signAccessToken } from "../src/lib/tokens.js";

export interface Usuario {
  id: string;
  token: string;
}

const MARCA = "fase2-teste";

export async function criarUsuario(apelido: string): Promise<Usuario> {
  const user = await prisma.user.create({
    data: {
      email: `${MARCA}-${apelido}-${crypto.randomUUID()}@exemplo.test`,
      passwordHash: "nao-usado-nos-testes",
      name: apelido,
    },
  });
  return { id: user.id, token: await signAccessToken(user.id) };
}

/** Some com tudo que os testes criaram — o resto do banco fica intacto. */
export async function limpar(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { contains: MARCA } } });
}

export async function subirApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

interface Requisicao {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  token: string;
  body?: unknown;
  /**
   * Endereço de origem da chamada.
   *
   * O limite de taxa é por IP, e `app.inject` usa o mesmo endereço em toda
   * injeção — então testes de uma rota com limite próprio compartilham o mesmo
   * balde e um derruba o outro. Quem simula sessões diferentes passa IPs
   * diferentes, que é o que aconteceria de verdade.
   */
  ip?: string;
}

export async function chamar(app: FastifyInstance, req: Requisicao) {
  const resposta = await app.inject({
    method: req.method,
    url: req.url,
    headers: { authorization: `Bearer ${req.token}` },
    ...(req.ip !== undefined && { remoteAddress: req.ip }),
    ...(req.body !== undefined && { payload: req.body as object }),
  });

  return {
    status: resposta.statusCode,
    // Cada teste afirma o formato que espera — é parte do que ele verifica.
    body: (resposta.body ? JSON.parse(resposta.body) : null) as unknown,
  };
}

/**
 * Gerador determinístico.
 *
 * O teste de 200 movimentos precisa ser reproduzível: uma falha de ordenação
 * que só acontece com uma sequência específica não pode sumir na próxima
 * execução.
 */
export function sorteio(semente: number) {
  let estado = semente;
  return (limite: number) => {
    estado = (estado * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return Math.floor((estado / 4_294_967_296) * limite);
  };
}
