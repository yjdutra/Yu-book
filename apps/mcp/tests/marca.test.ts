import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AUTOR_IA } from "@yu-book/shared";
import { registroDeClientes } from "../src/auth/provedor.js";
import { abrirCliente, identidade } from "./arnes.js";

/**
 * A marca de conteúdo gerado (Etapa C da frente de IA), do lado do MCP.
 *
 * O que a API grava ela prova nos testes dela. O que só este pacote pode errar
 * é o **corpo** que ele manda: sem `origin`, a nota ou o card nasce sem marca e
 * vira indistinguível do que o usuário escreveu — e nada falha. Por isso a
 * asserção é sobre o JSON que sai no `fetch`, não sobre o texto de volta.
 */

interface Chamada {
  metodo: string;
  url: string;
  corpo: Record<string, unknown> | undefined;
}

const chamadas: Chamada[] = [];

const NOTA_ID = "44444444-4444-4444-8444-444444444444";
const COLUNA_ID = "22222222-2222-4222-8222-222222222222";

const AGORA = "2026-09-24T15:00:00.000Z";

function nota(corpo: Record<string, unknown>) {
  return {
    id: NOTA_ID,
    title: corpo["title"],
    kind: corpo["kind"] ?? "livre",
    workspaceId: null,
    workspaceName: null,
    isFavorite: false,
    tags: [],
    updatedAt: AGORA,
    createdAt: AGORA,
    deletedAt: null,
    ai: { generatedAt: AGORA, via: "mcp", author: null, conversationId: null, revisedAt: null },
    contentMd: corpo["contentMd"],
    meta: {},
    sourceUrl: null,
    occurredAt: null,
    backlinks: [],
    cards: [],
  };
}

function card(corpo: Record<string, unknown>) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    columnId: COLUNA_ID,
    title: corpo["title"],
    position: 0,
    dueDate: null,
    priority: "media",
    checklistDone: 0,
    checklistTotal: 0,
    tags: [],
    note: null,
    updatedAt: AGORA,
    ai: { generatedAt: AGORA, via: "mcp", author: null, conversationId: null, revisedAt: null },
    boardId: "11111111-1111-4111-8111-111111111111",
    boardName: "Quadro",
    columnName: "Fazer",
    descriptionMd: "",
    checklist: [],
    archived: false,
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
    chamadas.push({ metodo, url: String(url), corpo });

    if (String(url).includes("/ai/settings")) return json({ timezone: "America/Sao_Paulo" });
    if (metodo === "POST" && String(url).endsWith("/notes")) {
      if (corpo?.["title"] === "Repetida") {
        return json(
          { error: { code: "TITULO_DUPLICADO", message: 'Já existe uma nota chamada "Repetida"' } },
          409,
        );
      }
      return json(nota(corpo ?? {}), 201);
    }
    if (metodo === "POST" && String(url).endsWith("/cards")) return json(card(corpo ?? {}), 201);
    return json([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Um cadastro OAuth de verdade: o `client_id` é o envelope, e o nome sai dele. */
async function clienteOAuth(nome: string | undefined): Promise<string> {
  const registrado = await registroDeClientes.registerClient!({
    redirect_uris: ["https://cliente.invalid/cb"],
    ...(nome !== undefined && { client_name: nome }),
  } as Parameters<NonNullable<typeof registroDeClientes.registerClient>>[0]);
  return registrado.client_id;
}

function comCliente(clientId: string) {
  return { ...identidade(["yubook:read", "yubook:write"]), clientId };
}

function post(caminho: string): Chamada | undefined {
  return chamadas.find((c) => c.metodo === "POST" && c.url.endsWith(caminho));
}

const texto = (r: { content: unknown }) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("o autor da marca de IA", () => {
  it("create_card envia origin com o client_name do cadastro OAuth", async () => {
    const id = await clienteOAuth("Claude Desktop");
    const cliente = await abrirCliente({ escrita: true }, comCliente(id));
    try {
      const r = await cliente.chamarTool("create_card", { columnId: COLUNA_ID, title: "Ler" });
      expect(r.isError).toBeFalsy();
      expect(post("/cards")?.corpo?.["origin"]).toEqual({ via: "mcp", author: "Claude Desktop" });
    } finally {
      await cliente.encerrar();
    }
  });

  it("create_note envia origin com o client_name do cadastro OAuth", async () => {
    const id = await clienteOAuth("Claude Desktop");
    const cliente = await abrirCliente({ escrita: true }, comCliente(id));
    try {
      const r = await cliente.chamarTool("create_note", { title: "Resumo", contentMd: "corpo" });
      expect(r.isError).toBeFalsy();
      expect(post("/notes")?.corpo).toMatchObject({
        title: "Resumo",
        contentMd: "corpo",
        origin: { via: "mcp", author: "Claude Desktop" },
      });
      expect(texto(r)).toContain(`trash_note com id ${NOTA_ID}`);
    } finally {
      await cliente.encerrar();
    }
  });

  it("sem client_name no cadastro, recua para o clientInfo do initialize", async () => {
    const id = await clienteOAuth(undefined);
    const cliente = await abrirCliente(
      { escrita: true, nomeDoCliente: "Cursor" },
      comCliente(id),
    );
    try {
      await cliente.chamarTool("create_note", { title: "Resumo", contentMd: "" });
      expect(post("/notes")?.corpo?.["origin"]).toEqual({ via: "mcp", author: "Cursor" });
    } finally {
      await cliente.encerrar();
    }
  });

  it("sem nome nenhum, o autor é 'cliente MCP'; nome longo é cortado no limite", async () => {
    const semNome = await abrirCliente(
      { escrita: true, nomeDoCliente: "   " },
      identidade(["yubook:read", "yubook:write"]),
    );
    try {
      await semNome.chamarTool("create_card", { columnId: COLUNA_ID, title: "Ler" });
      expect(post("/cards")?.corpo?.["origin"]).toEqual({ via: "mcp", author: "cliente MCP" });
    } finally {
      await semNome.encerrar();
    }

    chamadas.length = 0;
    const id = await clienteOAuth("x".repeat(300));
    const longo = await abrirCliente({ escrita: true }, comCliente(id));
    try {
      await longo.chamarTool("create_card", { columnId: COLUNA_ID, title: "Ler" });
      const autor = (post("/cards")?.corpo?.["origin"] as { author: string }).author;
      expect(autor).toHaveLength(MAX_AUTOR_IA);
    } finally {
      await longo.encerrar();
    }
  });
});

describe("create_note", () => {
  it("só existe com a escrita liberada", async () => {
    const token = identidade(["yubook:read", "yubook:write"]);
    const sem = await abrirCliente({ escrita: false }, token);
    const com = await abrirCliente({ escrita: true }, token);
    try {
      expect((await sem.listarTools()).map((t) => t.name)).not.toContain("create_note");
      expect((await com.listarTools()).map((t) => t.name)).toContain("create_note");
    } finally {
      await sem.encerrar();
      await com.encerrar();
    }
  });

  it("título duplicado vira instrução de escolher outro, e diz que nada foi criado", async () => {
    const cliente = await abrirCliente({ escrita: true }, identidade(["yubook:read", "yubook:write"]));
    try {
      const r = await cliente.chamarTool("create_note", { title: "Repetida", contentMd: "x" });
      expect(r.isError).toBe(true);
      expect(texto(r)).toContain("Nada foi criado");
      expect(texto(r)).toContain("Escolha outro título");
    } finally {
      await cliente.encerrar();
    }
  });
});
