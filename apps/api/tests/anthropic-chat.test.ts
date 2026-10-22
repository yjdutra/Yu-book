import type { ChatEvent, FormatNoteResult } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { paraAnthropic } from "../src/modules/assistente/anthropic-fluxo.js";
import {
  FOLGA_PENSAMENTO_TOKENS,
  precoParaEstimativa,
} from "../src/modules/assistente/custo.service.js";
import { esquecerCatalogo } from "../src/modules/assistente/modelos.service.js";
import {
  derrubarDubleAnthropic,
  respostaPadraoAnthropic,
  subirDubleAnthropic,
} from "./anthropic.js";
import type { DubleAnthropic } from "./anthropic.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * A Anthropic como segundo provedor, Fase 2 (docs/plano-provedor-anthropic.md):
 * gerar texto por ela — formatar nota, o laço do chat e a busca na web —,
 * com o provedor seguindo o modelo escolhido.
 *
 * O que a suíte protege: a conversão de formato na borda (o resto do Yu-book
 * não muda), o pensamento que volta intacto **dentro** do laço e some do
 * histórico gravado, o custo pela tabela com cache e busca, e os 200 que não
 * são sucesso — recusa e saída cortada.
 */

let app: FastifyInstance;
let duble: DubleAnthropic;

/// O custo de um turno do dublê no Opus 5.5, pela tabela de 2026-10-21:
/// 1.000 de entrada a US$ 4/M, 500 de saída a US$ 20/M, 10.000 lidos do cache
/// a US$ 0,20/M e 2.000 escritos a US$ 5/M — 4.000 + 10.000 + 2.000 + 10.000.
const CUSTO_DO_TURNO = 26_000;

beforeAll(async () => {
  await limpar();
  duble = await subirDubleAnthropic();
  app = await subirApp();
});

afterAll(async () => {
  await app.close();
  await derrubarDubleAnthropic(duble);
  await limpar();
});

beforeEach(() => {
  duble.recebidas = [];
  duble.cabecalhos = [];
  duble.corpos = [];
  duble.roteiro = [];
  duble.responder = respostaPadraoAnthropic;
  esquecerCatalogo();
});

/** Um usuário com o Opus 5.5 favoritado e escolhido para `chat` e `formatar`. */
async function comClaude(apelido: string): Promise<Usuario> {
  const usuario = await criarUsuario(apelido);
  await prisma.aiModelFavorite.create({
    data: {
      userId: usuario.id,
      modelId: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      contextLength: 1_000_000,
      promptMicros: 4_000_000,
      completionMicros: 20_000_000,
      supportsTools: true,
      provider: "anthropic",
    },
  });
  await prisma.aiTaskModel.createMany({
    data: [
      { userId: usuario.id, task: "chat", modelId: "claude-opus-5-5" },
      { userId: usuario.id, task: "formatar", modelId: "claude-opus-5-5" },
    ],
  });
  return usuario;
}

/** Os corpos de `POST /v1/messages`, na ordem. */
function pedidosDeMensagem(): Record<string, unknown>[] {
  return duble.corpos.filter((_, i) => duble.recebidas[i]?.startsWith("POST /v1/messages"));
}

let proximoIp = 0;

async function enviar(
  usuario: Usuario,
  conversationId: string,
  content: string,
): Promise<ChatEvent[]> {
  const resposta = await app.inject({
    method: "POST",
    url: `/ai/conversations/${conversationId}/messages`,
    headers: { authorization: `Bearer ${usuario.token}` },
    remoteAddress: `10.1.0.${(proximoIp += 1) % 250}`,
    payload: { content },
  });
  return resposta.body
    .split("\n\n")
    .map((bloco) => bloco.replace(/^data: /, "").trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => JSON.parse(linha) as ChatEvent);
}

async function novaConversa(usuario: Usuario, agentId?: string): Promise<string> {
  const { body } = await chamar(app, {
    method: "POST",
    url: "/ai/conversations",
    token: usuario.token,
    body: { title: "Conversa", ...(agentId !== undefined && { agentId }) },
  });
  return (body as { id: string }).id;
}

describe("conversão para o formato da Anthropic", () => {
  test("system à parte, tool_calls em tool_use e resultados seguidos num só user", () => {
    const { system, messages } = paraAnthropic([
      { role: "system", content: "instruções" },
      { role: "user", content: "oi" },
      {
        role: "assistant",
        content: "vou procurar",
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "search_notes", arguments: '{"q":"x"}' },
          },
          { id: "b", type: "function", function: { name: "list_boards", arguments: "" } },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "nada" },
      { role: "tool", tool_call_id: "b", content: "dois quadros" },
      { role: "assistant", content: "" },
    ]);

    expect(system).toBe("instruções");
    expect(messages).toEqual([
      { role: "user", content: "oi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "vou procurar" },
          { type: "tool_use", id: "a", name: "search_notes", input: { q: "x" } },
          { type: "tool_use", id: "b", name: "list_boards", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "nada" },
          { type: "tool_result", tool_use_id: "b", content: "dois quadros" },
        ],
      },
      // A fala vazia some: a API a recusaria.
    ]);
  });

  test("a fala com conteúdo nativo volta como veio, pensamento incluído", () => {
    const nativo = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "t", name: "list_boards", input: {} },
    ];
    const { messages } = paraAnthropic([
      { role: "user", content: "oi" },
      { role: "assistant", content: "", tool_calls: [], nativo },
    ]);

    expect(messages[1]).toEqual({ role: "assistant", content: nativo });
  });
});

describe("formatar nota pela Anthropic", () => {
  test("o pedido vai no formato dela; o uso grava provedor, cache e custo", async () => {
    const usuario = await comClaude("claude-formatar");
    const nota = await prisma.note.create({
      data: { userId: usuario.id, title: "Rascunho", kind: "livre", contentMd: "texto solto" },
    });
    duble.roteiro = [{ tipo: "texto", texto: "## Texto\n\ntexto solto" }];

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: usuario.token,
      body: { contentMd: "texto solto" },
    });

    expect(status, JSON.stringify(body)).toBe(200);
    const resultado = body as FormatNoteResult;
    expect(resultado.contentMd).toBe("## Texto\n\ntexto solto");
    expect(resultado.usage).toMatchObject({
      modelId: "claude-opus-5-5",
      promptTokens: 1_000,
      completionTokens: 500,
      costMicros: CUSTO_DO_TURNO,
      costSource: "estimado",
    });

    const pedido = pedidosDeMensagem()[0];
    expect(pedido).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "texto solto" }],
    });
    // No formatar o cache seria sobretaxa: a nota não é relida igual.
    expect(pedido).not.toHaveProperty("cache_control");
    expect(typeof pedido?.["system"]).toBe("string");
    expect(pedido?.["max_tokens"]).toBeGreaterThan(FOLGA_PENSAMENTO_TOKENS);
    // A política de dados é coisa do OpenRouter, e não vai para a Anthropic.
    expect(pedido).not.toHaveProperty("provider");

    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso).toMatchObject({
      provider: "anthropic",
      task: "formatar",
      ok: true,
      promptTokens: 1_000,
      completionTokens: 500,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2_000,
      costMicros: CUSTO_DO_TURNO,
      costSource: "estimado",
    });
  });

  test("saída cortada por max_tokens não vira nota pela metade", async () => {
    const usuario = await comClaude("claude-cortada");
    const nota = await prisma.note.create({
      data: { userId: usuario.id, title: "Longa", kind: "livre", contentMd: "muito texto" },
    });
    duble.roteiro = [{ tipo: "cortada", texto: "## Muito" }];

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: usuario.token,
      body: { contentMd: "muito texto" },
    });

    expect(status).toBe(502);
    expect((body as { error: { message: string } }).error.message).toContain("cortada");
    // Foi paga: a linha leva o custo, com `ok: false`.
    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso).toMatchObject({
      ok: false,
      errorCode: "RESPOSTA_INVALIDA",
      costMicros: CUSTO_DO_TURNO,
    });
  });

  test("crédito acabado vira 402 COTA_EXCEDIDA, com a linha de uso da falha", async () => {
    const usuario = await comClaude("claude-sem-credito");
    const nota = await prisma.note.create({
      data: { userId: usuario.id, title: "Qualquer", kind: "livre", contentMd: "x" },
    });
    duble.roteiro = [
      { tipo: "erro", status: 400, mensagem: "Your credit balance is too low to access the API." },
    ];

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: usuario.token,
      body: { contentMd: "x" },
    });

    expect(status).toBe(402);
    expect((body as { error: { code: string } }).error.code).toBe("COTA_EXCEDIDA");
    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso).toMatchObject({ provider: "anthropic", ok: false, errorCode: "COTA_EXCEDIDA" });
  });
});

describe("o laço do chat pela Anthropic", () => {
  test("o pensamento volta intacto no passo seguinte, com o resultado num user", async () => {
    const usuario = await comClaude("claude-laco");
    const conversa = await novaConversa(usuario);
    duble.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"fuso"}' },
      { tipo: "texto", texto: "Não achei nada sobre fuso." },
    ];

    const eventos = await enviar(usuario, conversa, "o que anotei sobre fuso?");

    expect(eventos.map((e) => e.tipo)).toContain("ferramenta");
    expect(eventos.at(-1)?.tipo).toBe("fim");

    const [primeiro, segundo] = pedidosDeMensagem();
    // No laço, cache automático em todo passo.
    expect(primeiro?.["cache_control"]).toEqual({ type: "ephemeral" });
    // As ferramentas vão no formato da Anthropic, com o schema em `input_schema`.
    const ferramentas = primeiro?.["tools"] as { name: string; input_schema?: unknown }[];
    expect(ferramentas.some((f) => f.name === "search_notes" && f.input_schema)).toBe(true);
    expect(typeof primeiro?.["system"]).toBe("string");

    const mensagens = segundo?.["messages"] as { role: string; content: unknown }[];
    expect(mensagens.at(-2)).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "assinatura-do-pensamento" },
        { type: "tool_use", id: "toolu_01", name: "search_notes", input: { q: "fuso" } },
      ],
    });
    const resultado = mensagens.at(-1);
    expect(resultado?.role).toBe("user");
    expect(resultado?.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_01" }),
    ]);

    const usos = await prisma.aiUsage.findMany({ where: { userId: usuario.id } });
    expect(usos).toHaveLength(2);
    expect(usos.every((u) => u.provider === "anthropic" && u.ok)).toBe(true);
  });

  test("na mensagem seguinte, o histórico gravado volta sem o pensamento", async () => {
    // Tirar todos os blocos de pensamento é forma válida para a API; o que ela
    // recusa é reenviar parte deles depois de editar o que veio antes.
    const usuario = await comClaude("claude-historico");
    const conversa = await novaConversa(usuario);
    duble.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"fuso"}' },
      { tipo: "texto", texto: "Nada." },
      { tipo: "texto", texto: "De nada." },
    ];

    await enviar(usuario, conversa, "procure fuso");
    await enviar(usuario, conversa, "obrigado");

    const terceiro = pedidosDeMensagem()[2];
    const mensagens = terceiro?.["messages"] as { role: string; content: unknown }[];
    const comFerramenta = mensagens.find(
      (m) => m.role === "assistant" && Array.isArray(m.content),
    );
    expect(comFerramenta?.content).toEqual([
      { type: "tool_use", id: "toolu_01", name: "search_notes", input: { q: "fuso" } },
    ]);
    expect(JSON.stringify(mensagens)).not.toContain("thinking");
  });

  test("recusa do modelo vira erro, e a linha de uso guarda o que foi pago", async () => {
    const usuario = await comClaude("claude-recusa");
    const conversa = await novaConversa(usuario);
    duble.roteiro = [{ tipo: "recusa" }];

    const eventos = await enviar(usuario, conversa, "algo recusável");

    const erro = eventos.find((e) => e.tipo === "erro");
    expect(erro).toMatchObject({ tipo: "erro", code: "RESPOSTA_INVALIDA" });
    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso).toMatchObject({
      provider: "anthropic",
      ok: false,
      errorCode: "RECUSA_DO_MODELO",
      costMicros: CUSTO_DO_TURNO,
    });
  });

  test("agente com busca: uma busca do servidor só, e a citação vira fonte", async () => {
    const usuario = await comClaude("claude-busca");
    const { status, body } = await chamar(app, {
      method: "POST",
      url: "/ai/agents",
      token: usuario.token,
      body: { name: "Pesquisador", webSearch: true },
    });
    expect(status, JSON.stringify(body)).toBe(201);
    const conversa = await novaConversa(usuario, (body as { id: string }).id);
    duble.roteiro = [
      {
        tipo: "busca",
        texto: "O Yu-book é um segundo cérebro.",
        url: "https://exemplo.com/yu-book",
        titulo: "Sobre o Yu-book",
      },
    ];

    const eventos = await enviar(usuario, conversa, "o que é o yu-book?");

    const ferramentas = pedidosDeMensagem()[0]?.["tools"] as Record<string, unknown>[];
    expect(ferramentas).toContainEqual({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 1,
    });
    const fontes = eventos.filter((e) => e.tipo === "fontes");
    expect(JSON.stringify(fontes)).toContain("https://exemplo.com/yu-book");

    // O turno mais uma busca, a US$ 10 por mil.
    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso.costMicros).toBe(CUSTO_DO_TURNO + 10_000);
  });

  test("busca ligada: a ferramenta fica igual em todas as voltas do laço", async () => {
    // O pensamento reenviado pelo `nativo` só vale com o mesmo conjunto de
    // ferramentas do passo que o produziu. Tirar a busca no passo 2 é 400 em
    // conta fiscalizada — e o dublê não fiscaliza, então o teste afirma o corpo.
    const usuario = await comClaude("claude-busca-laco");
    const { body } = await chamar(app, {
      method: "POST",
      url: "/ai/agents",
      token: usuario.token,
      body: { name: "Pesquisador", webSearch: true, tools: ["search_notes"] },
    });
    const conversa = await novaConversa(usuario, (body as { id: string }).id);
    duble.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"x"}' },
      { tipo: "texto", texto: "Pronto." },
    ];

    const eventos = await enviar(usuario, conversa, "pesquise");

    const [primeiro, segundo] = pedidosDeMensagem();
    expect(segundo?.["tools"]).toEqual(primeiro?.["tools"]);
    // O evento de busca continua saindo uma vez só, do primeiro passo.
    expect(eventos.filter((e) => e.tipo === "busca")).toHaveLength(1);
  });

  test("pause_turn vira erro com a linha paga, não meia fala gravada como ok", async () => {
    const usuario = await comClaude("claude-pausa");
    const conversa = await novaConversa(usuario);
    duble.roteiro = [{ tipo: "pausa", texto: "Buscando" }];

    const eventos = await enviar(usuario, conversa, "algo");

    expect(eventos.find((e) => e.tipo === "erro")).toMatchObject({ code: "RESPOSTA_INVALIDA" });
    const uso = await prisma.aiUsage.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(uso).toMatchObject({ ok: false, costMicros: CUSTO_DO_TURNO });
  });

  test("tool_use cortado por max_tokens não é executado", async () => {
    const usuario = await comClaude("claude-tool-cortado");
    const conversa = await novaConversa(usuario);
    duble.roteiro = [
      { tipo: "ferramenta", nome: "search_notes", argumentos: '{"q":"fu', cortada: true },
    ];

    const eventos = await enviar(usuario, conversa, "procure");

    expect(eventos.map((e) => e.tipo)).not.toContain("ferramenta");
    expect(eventos.find((e) => e.tipo === "erro")).toMatchObject({ code: "RESPOSTA_INVALIDA" });
    expect(pedidosDeMensagem()).toHaveLength(1);
  });
});

describe("estimativa do teto na Anthropic", () => {
  test("conta a escrita de cache e a faixa longa do Haiku 5.5", () => {
    const opus = {
      provider: "anthropic" as const,
      id: "claude-opus-5-5",
      promptMicros: 4_000_000,
      completionMicros: 20_000_000,
    };
    // Com cache, a entrada orça pela escrita (US$ 5/M), não pela leitura base.
    expect(precoParaEstimativa(opus, 1_000, true).promptMicros).toBe(5_000_000);
    expect(precoParaEstimativa(opus, 1_000, false).promptMicros).toBe(4_000_000);

    const haiku = {
      provider: "anthropic" as const,
      id: "claude-haiku-5-5",
      promptMicros: 100_000,
      completionMicros: 500_000,
    };
    expect(precoParaEstimativa(haiku, 200_000, false)).toMatchObject({
      promptMicros: 500_000,
      completionMicros: 2_500_000,
    });
    // O OpenRouter não muda.
    const outro = { promptMicros: 1, completionMicros: 2 };
    expect(precoParaEstimativa(outro, 200_000, true)).toBe(outro);
  });
});

