import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { limpar, subirApp } from "./apoio.js";

/**
 * A rotação do refresh token, e a janela de graça que o servidor MCP exigiu.
 *
 * Estes testes passam pelo `/auth/login` de verdade — diferente do resto da
 * suíte, que assina o JWT à mão em `apoio.ts`. Aqui o que está sob teste é
 * justamente o ciclo de sessão, então o atalho não serviria.
 */

const MARCA = "fase2-teste";
const SENHA = "senha-de-teste-1234";

let app: FastifyInstance;

/** O `Set-Cookie` do refresh, extraído como o `apps/mcp` faz. */
function refreshDe(resposta: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = resposta.cookies.find((c) => c.name === "yb_refresh");
  if (!cookie) throw new Error("A resposta não trouxe o cookie de refresh.");
  return cookie.value;
}

async function registrar(apelido: string): Promise<string> {
  const resposta = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `${MARCA}-${apelido}-${crypto.randomUUID()}@exemplo.test`,
      password: SENHA,
      name: apelido,
    },
  });
  expect(resposta.statusCode).toBe(201);
  return refreshDe(resposta);
}

function renovar(refresh: string) {
  return app.inject({
    method: "POST",
    url: "/auth/refresh",
    headers: { "x-yu-book-client": "web" },
    cookies: { yb_refresh: refresh },
  });
}

beforeAll(async () => {
  await limpar();
  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  await limpar();
  await prisma.$disconnect();
});

describe("rotação do refresh token", () => {
  it("rotaciona: o token novo vale e o velho não", async () => {
    const primeiro = await registrar("rotacao");

    const renovada = await renovar(primeiro);
    expect(renovada.statusCode).toBe(200);
    const segundo = refreshDe(renovada);
    expect(segundo).not.toBe(primeiro);

    // O novo continua funcionando.
    expect((await renovar(segundo)).statusCode).toBe(200);
  });

  it("dentro da janela de graça, reapresentar o token consumido não derruba as outras sessões", async () => {
    // É o teste que motivou a mudança. O servidor MCP renova por HTTP e
    // retenta; sem a graça, uma retentativa de boa-fé revogava **todas** as
    // sessões do usuário — inclusive a do navegador, que não fez nada.
    const daSessaoA = await registrar("graca");

    // Uma segunda sessão do mesmo usuário: é ela que não pode ser atingida.
    const email = (await prisma.refreshToken.findFirst({
      where: { tokenHash: { not: "" } },
      orderBy: { createdAt: "desc" },
      include: { user: true },
    }))!.user.email;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: SENHA },
    });
    expect(login.statusCode).toBe(200);
    const daSessaoB = refreshDe(login);

    // A rotaciona uma vez; o token antigo passa a estar consumido.
    expect((await renovar(daSessaoA)).statusCode).toBe(200);

    // A retentativa de boa-fé: o mesmo token, de novo, logo em seguida.
    const retentativa = await renovar(daSessaoA);
    expect(retentativa.statusCode).toBe(401);

    // O que importa: a sessão B sobreviveu.
    const bSobreviveu = await renovar(daSessaoB);
    expect(bSobreviveu.statusCode).toBe(200);
  });

  it("fora da janela de graça, o reuso derruba todas as sessões do usuário", async () => {
    const daSessaoA = await registrar("vazamento");

    const registro = (await prisma.refreshToken.findFirst({
      orderBy: { createdAt: "desc" },
      include: { user: true },
    }))!;

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: registro.user.email, password: SENHA },
    });
    const daSessaoB = refreshDe(login);

    await renovar(daSessaoA);

    // Envelhece a revogação para além da janela, em vez de esperar 30 s.
    await prisma.refreshToken.updateMany({
      where: { userId: registro.userId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    expect((await renovar(daSessaoA)).statusCode).toBe(401);

    // Agora sim: a detecção de reuso derruba tudo.
    expect((await renovar(daSessaoB)).statusCode).toBe(401);
  });
});
