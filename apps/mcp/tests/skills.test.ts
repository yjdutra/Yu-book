import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FERRAMENTAS_DO_CHAT, nivelDaSkill } from "@yu-book/shared";
import type { SkillItem } from "@yu-book/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * As skills do lado do MCP (frente Ritmo, Ritmo 5 — RF-53): as três tools nas
 * superfícies certas e fora do chat, o `upsert` que escolhe criar ou editar
 * pelo `skillId`, e o uso com `origin`.
 */

interface Chamada {
  metodo: string;
  caminho: string;
  corpo: Record<string, unknown> | undefined;
}
const chamadas: Chamada[] = [];
const COMPLETO = identidade(["yubook:read", "yubook:write"]);
const SKILL_ID = "77777777-7777-4777-8777-777777777777";

function skill(corpo: Record<string, unknown> = {}, usos = 14): SkillItem {
  return {
    id: SKILL_ID,
    name: (corpo["name"] as string | undefined) ?? "Pausa tática",
    description: "",
    whenToUse: "",
    emblem: "ampulheta",
    color: "violeta",
    position: 0,
    archived: false,
    uses: usos,
    usesToday: 0,
    lastUsedAt: null,
    level: nivelDaSkill(usos),
    createdAt: "2026-10-18T15:00:00.000Z",
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
    const caminho = new URL(String(url)).pathname;
    chamadas.push({ metodo, caminho, corpo });
    if (caminho === "/skills" && metodo === "GET") return json([skill()]);
    if (caminho === "/skills" && metodo === "POST") return json(skill(corpo, 0), 201);
    if (caminho === `/skills/${SKILL_ID}` && metodo === "PATCH") return json(skill(corpo));
    if (caminho === `/skills/${SKILL_ID}/uses`) {
      return json(
        {
          use: { id: "u1", skillId: SKILL_ID, usedAt: "", day: "2026-10-18", ai: null },
          skill: skill({}, 15),
          levelUp: nivelDaSkill(15),
        },
        201,
      );
    }
    return json({ error: { code: "NOT_FOUND", message: "Não encontrado" } }, 404);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const texto = (r: CallToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("as skills no MCP", () => {
  it("list_skills sempre, as de escrita só com escrita, e nenhuma no chat", async () => {
    const sem = await abrirCliente({ escrita: false }, COMPLETO);
    const com = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const lidas = (await sem.listarTools()).map((t) => t.name);
      const todas = (await com.listarTools()).map((t) => t.name);
      expect(lidas).toContain("list_skills");
      for (const nome of ["upsert_skill", "log_skill_use"]) {
        expect(lidas).not.toContain(nome);
        expect(todas).toContain(nome);
      }
      for (const nome of ["list_skills", "upsert_skill", "log_skill_use"]) {
        expect(FERRAMENTAS_DO_CHAT).not.toContain(nome);
      }
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });

  it("upsert_skill sem id cria (POST) e com id edita (PATCH) (CA-34)", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const criada = await cliente.chamarTool("upsert_skill", {
        name: "Arranque",
        emblem: "foguete",
      });
      expect(texto(criada)).toContain("Skill criada.");
      expect(chamadas[0]).toMatchObject({ metodo: "POST", caminho: "/skills" });
      expect(chamadas[0]?.corpo).toEqual({ name: "Arranque", emblem: "foguete" });
      await cliente.chamarTool("upsert_skill", { skillId: SKILL_ID, archived: true });
      expect(chamadas[1]).toMatchObject({ metodo: "PATCH", corpo: { archived: true } });
      const semNome = await cliente.chamarTool("upsert_skill", { emblem: "raio" });
      expect(semNome.isError).toBe(true);
      expect(chamadas).toHaveLength(2);
    } finally {
      await cliente.encerrar();
    }
  });

  it("log_skill_use manda origin e conta a subida de nível", async () => {
    const cliente = await abrirCliente({ escrita: true }, COMPLETO);
    try {
      const r = await cliente.chamarTool("log_skill_use", { skillId: SKILL_ID });
      expect(chamadas[0]?.corpo).toEqual({ origin: expect.objectContaining({ via: "mcp" }) });
      expect(texto(r)).toContain("Subiu para Prata!");
      expect(texto(r)).toContain("faltam 35 para Ouro");
    } finally {
      await cliente.encerrar();
    }
  });
});
