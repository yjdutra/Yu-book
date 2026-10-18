import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FERRAMENTAS_DE_LEITURA, FERRAMENTAS_DO_CHAT } from "@yu-book/shared";
import type { MoodDayItem } from "@yu-book/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * O humor do lado do MCP (frente Ritmo, Ritmo 4 — RF-46): as duas tools nas
 * superfícies certas, o corpo do `PUT` com `origin` e só os campos mandados, e
 * a leitura com o período na busca. Fora do chat, mesmo `get_mood` sendo leitura.
 */

interface Chamada {
  metodo: string;
  caminho: string;
  busca: string;
  corpo: Record<string, unknown> | undefined;
}
const chamadas: Chamada[] = [];
const COMPLETO = identidade(["yubook:read", "yubook:write"]);

function dia(corpo: Record<string, unknown> = {}): MoodDayItem {
  return {
    day: (corpo["day"] as string | undefined) ?? "2026-10-18",
    morning: (corpo["morning"] as number | null | undefined) ?? 4,
    midday: null,
    evening: (corpo["evening"] as number | null | undefined) ?? null,
    note: (corpo["note"] as string | undefined) ?? null,
    ai: { via: "mcp", author: "Claude Code", agentName: null },
    updatedAt: "2026-10-18T15:00:00.000Z",
  };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const corpo =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const endereco = new URL(String(url));
    chamadas.push({ metodo, caminho: endereco.pathname, busca: endereco.search, corpo });
    if (endereco.pathname === "/moods" && metodo === "GET") return json([dia()]);
    if (endereco.pathname === "/moods" && metodo === "PUT") return json(dia(corpo));
    return json({ error: { code: "NOT_FOUND", message: "Não encontrado" } }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const texto = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("o humor no MCP", () => {
  it("get_mood sempre, log_mood só com escrita, e nenhum dos dois no chat", async () => {
    const sem = await abrirCliente({ escrita: false }, COMPLETO);
    const com = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const lidas = (await sem.listarTools()).map((t) => t.name);
      const todas = (await com.listarTools()).map((t) => t.name);
      expect(lidas).toContain("get_mood");
      expect(lidas).not.toContain("log_mood");
      expect(todas).toContain("log_mood");
      expect(FERRAMENTAS_DE_LEITURA).not.toContain("get_mood");
      expect(FERRAMENTAS_DO_CHAT).not.toContain("get_mood");
      expect(FERRAMENTAS_DO_CHAT).not.toContain("log_mood");
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });

  it("get_mood manda o período e dá nome aos números", async () => {
    const cliente = await abrirCliente({ escrita: false }, COMPLETO);
    try {
      const r = await cliente.chamarTool("get_mood", { from: "2026-10-01", to: "2026-10-18" });
      expect(chamadas[0]?.busca).toBe("?from=2026-10-01&to=2026-10-18");
      expect(texto(r)).toContain("manhã 4 bem");
    } finally {
      await cliente.encerrar();
    }
  });

  it("log_mood manda só o que veio, com origin (CA-28)", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("log_mood", { evening: 2, note: "Cansado" });
      expect(r.isError).toBeFalsy();
      expect(chamadas[0]).toMatchObject({ metodo: "PUT", caminho: "/moods" });
      expect(chamadas[0]?.corpo).toEqual({
        evening: 2,
        note: "Cansado",
        origin: expect.objectContaining({ via: "mcp" }),
      });
      expect(texto(r)).toContain("Humor gravado.");
    } finally {
      await cliente.encerrar();
    }
  });

  it("log_mood sem momento nem descrição recusa sem chamar a API", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("log_mood", { day: "2026-10-17" });
      expect(r.isError).toBe(true);
      expect(chamadas).toHaveLength(0);
    } finally {
      await cliente.encerrar();
    }
  });
});
