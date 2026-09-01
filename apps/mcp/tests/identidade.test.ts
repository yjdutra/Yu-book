import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/cliente.js";
import { comErro, comErroDeResource } from "../src/erros.js";
import type { Extra } from "../src/notificacoes.js";

/**
 * A prova de que a identidade de quem chamou chega ao `fetch`.
 *
 * O ambiente de teste é `http` (ver `tests/setup.ts`), que é o transporte onde
 * a pergunta faz sentido: um processo, muitos clientes. Nada aqui toca a rede —
 * o `fetch` global é substituído, e o que se verifica é o cabeçalho
 * `Authorization` que teria saído.
 */

/** Um `extra` do SDK com — ou sem — a identidade que `verifyAccessToken` põe. */
function extraCom(tokenDaApi?: string): Extra {
  return {
    ...(tokenDaApi !== undefined && {
      authInfo: {
        token: "irrelevante",
        clientId: "cliente-1",
        scopes: ["yubook:read"],
        extra: { tokenDaApi },
      },
    }),
  } as unknown as Extra;
}

const chamadas: { url: string; bearer: string | null }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const cabecalhos = new Headers(init?.headers);
    chamadas.push({ url: String(url), bearer: cabecalhos.get("Authorization") });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a identidade de quem chamou", () => {
  it("não se mistura entre duas chamadas em voo ao mesmo tempo", async () => {
    // O TESTE QUE UM PORTADOR MUTÁVEL NÃO PASSARIA. Guardar o token na sessão
    // e atualizá-lo a cada requisição faria a segunda chamada sobrescrever o
    // token da primeira antes de ela terminar — e as duas sairiam com o mesmo
    // `Authorization`. O contexto assíncrono amarra o token ao fluxo.
    const handler = comErro(async () => {
      // Uma pausa no meio, para as duas se sobreporem de verdade.
      await new Promise((r) => setTimeout(r, 10));
      await api.get("/dashboard");
      return { content: [{ type: "text" as const, text: "ok" }] };
    });

    await Promise.all([
      handler({}, extraCom("TOKEN-DA-ANA")),
      handler({}, extraCom("TOKEN-DO-BENTO")),
    ]);

    const bearers = chamadas.map((c) => c.bearer).sort();
    expect(bearers).toEqual(["Bearer TOKEN-DA-ANA", "Bearer TOKEN-DO-BENTO"]);
  });

  it("sob http, chamada sem identidade é recusada e não vira login no ambiente", async () => {
    // A segunda tranca. A primeira é o `superRefine` do `env.ts`, que proíbe
    // YUBOOK_EMAIL sob http — mas se um dia ela cair, esta impede que uma
    // requisição HTTP fale com a API como o dono do `.env`.
    const handler = comErro(async () => {
      await api.get("/dashboard");
      return { content: [{ type: "text" as const, text: "não deveria chegar aqui" }] };
    });

    const resultado = await handler({}, extraCom());

    expect(resultado.isError).toBe(true);
    expect(chamadas).toHaveLength(0);
    expect(chamadas.some((c) => c.url.includes("/auth/login"))).toBe(false);
  });

  it("resource direto — a forma (uri, extra) — também carrega a identidade", async () => {
    const handler = comErroDeResource(async (uri: URL) => {
      await api.get("/notes/titles");
      return { contents: [{ uri: uri.href, text: "ok" }] };
    });

    await handler(new URL("yubook://notas"), extraCom("TOKEN-DA-ANA"));

    expect(chamadas[0]?.bearer).toBe("Bearer TOKEN-DA-ANA");
  });

  it("resource de template — a forma (uri, variables, extra) — idem", async () => {
    // As duas formas importam: o SDK manda o `extra` sempre por último, e um
    // invólucro que o procurasse numa posição fixa acertaria uma e erraria a
    // outra — silenciosamente, porque a chamada ainda funcionaria no stdio.
    const handler = comErroDeResource(async (uri: URL, vars: { id: string }) => {
      await api.get(`/notes/${vars.id}`);
      return { contents: [{ uri: uri.href, text: "ok" }] };
    });

    await handler(new URL("yubook://nota/abc"), { id: "abc" }, extraCom("TOKEN-DO-BENTO"));

    expect(chamadas[0]?.url).toContain("/notes/abc");
    expect(chamadas[0]?.bearer).toBe("Bearer TOKEN-DO-BENTO");
  });
});
