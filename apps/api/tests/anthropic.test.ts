import type { AiFavorite, AiHealth, AiModelList } from "@yu-book/shared";
import { custoAnthropicMicros, PRECOS_ANTHROPIC, precoAnthropic } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { AppError } from "../src/lib/errors.js";
import {
  clienteAnthropic,
  saudeAnthropic,
  traduzirErroAnthropic,
} from "../src/modules/assistente/anthropic.service.js";
import { registrarUso } from "../src/modules/assistente/custo.service.js";
import { esquecerCatalogo, listarModelos } from "../src/modules/assistente/modelos.service.js";
import {
  derrubarDubleAnthropic,
  MODELOS_ANTHROPIC,
  respostaPadraoAnthropic,
  subirDubleAnthropic,
} from "./anthropic.js";
import type { DubleAnthropic } from "./anthropic.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * A Anthropic como segundo provedor, Fase 1 (docs/plano-provedor-anthropic.md):
 * o servidor a conhece — saúde, catálogo com preço, favorito com provedor e
 * linha de uso com provedor e cache —, sem ainda gerar texto por ela.
 *
 * Como no OpenRouter, o que a suíte protege acima de tudo é que nenhuma
 * conexão saia para a Anthropic de verdade: `tests/setup.ts` aponta
 * `ANTHROPIC_BASE_URL` para o dublê, e o serviço lança se outro host aparecer.
 */

let app: FastifyInstance;
let dono: Usuario;
let duble: DubleAnthropic;

beforeAll(async () => {
  await limpar();
  duble = await subirDubleAnthropic();
  app = await subirApp();
  dono = await criarUsuario("anthropic-dono");
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
  duble.responder = respostaPadraoAnthropic;
  esquecerCatalogo();
});

/** O erro que uma chamada real do SDK ao dublê produz, já traduzido. */
async function erroTraduzido(status: number, mensagem: string): Promise<unknown> {
  duble.responder = () => ({
    status,
    corpo: { type: "error", error: { type: "qualquer_erro", message: mensagem } },
  });
  try {
    await clienteAnthropic({ orcamentoMs: 2_000 }).models.list({ limit: 1 });
    return null;
  } catch (erro) {
    return traduzirErroAnthropic(erro);
  }
}

describe("saúde da Anthropic", () => {
  test("sem chave, responde 'não configurado' sem abrir conexão", async () => {
    // RNF-03: sem a variável, só os modelos da Anthropic somem.
    const resultado = await saudeAnthropic({ chave: undefined });

    expect(resultado).toMatchObject({ provider: "anthropic", configured: false, reachable: false });
    expect(duble.recebidas).toEqual([]);
  });

  test("com chave, lista um modelo e não executa inferência", async () => {
    // RF-08: a saúde nunca chama `/v1/messages`. A chave vai no `x-api-key`.
    const resultado = await saudeAnthropic({ chave: "chave-injetada" });

    expect(resultado).toMatchObject({ provider: "anthropic", configured: true, reachable: true });
    expect(resultado.label).toBeNull();
    expect(duble.recebidas).toEqual(["GET /v1/models?limit=1"]);
    expect(duble.cabecalhos[0]?.["x-api-key"]).toBe("chave-injetada");
  });

  test("chave recusada vira 'não responde', não exceção", async () => {
    duble.responder = () => ({
      status: 401,
      corpo: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      },
    });

    const resultado = await saudeAnthropic({ chave: "chave-errada" });

    expect(resultado.configured).toBe(true);
    expect(resultado.reachable).toBe(false);
  });

  test("GET /ai/health?provider=anthropic responde pela Anthropic", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/health?provider=anthropic",
      token: dono.token,
    });

    expect(status).toBe(200);
    expect((body as AiHealth).provider).toBe("anthropic");
    expect((body as AiHealth).reachable).toBe(true);
  });
});

describe("erros da Anthropic com código estável", () => {
  test("crédito acabado (400 'credit balance') vira COTA_EXCEDIDA", async () => {
    // A Anthropic não usa 402: diz pela mensagem. É o caso mais provável de
    // quem gasta os créditos mensais do plano, e precisa dizer o que fazer.
    const erro = await erroTraduzido(
      400,
      "Your credit balance is too low to access the Anthropic API.",
    );

    expect(erro).toBeInstanceOf(AppError);
    expect((erro as AppError).code).toBe("COTA_EXCEDIDA");
    expect((erro as AppError).statusCode).toBe(402);
    expect((erro as AppError).message).toContain("créditos");
  });

  test("429 vira COTA_EXCEDIDA", async () => {
    const erro = await erroTraduzido(429, "Number of request tokens has exceeded your rate limit");
    expect((erro as AppError).code).toBe("COTA_EXCEDIDA");
  });

  test("401 vira PROVEDOR_INDISPONIVEL sem ecoar a mensagem do provedor", async () => {
    // É onde a mensagem pode trazer pedaço da chave.
    const erro = await erroTraduzido(401, "invalid x-api-key sk-ant-api03-SEGREDO");

    expect((erro as AppError).code).toBe("PROVEDOR_INDISPONIVEL");
    expect((erro as AppError).message).not.toContain("SEGREDO");
  });

  test("sobrecarga (529) vira PROVEDOR_INDISPONIVEL com o status", async () => {
    const erro = await erroTraduzido(529, "Overloaded");

    expect((erro as AppError).code).toBe("PROVEDOR_INDISPONIVEL");
    expect((erro as AppError).message).toContain("529");
  });

  test("erro que não é do SDK volta como veio", () => {
    const nosso = new TypeError("defeito nosso");
    expect(traduzirErroAnthropic(nosso)).toBe(nosso);
  });
});

describe("catálogo da Anthropic", () => {
  test("lista só os modelos com preço na tabela, com o preço dela", async () => {
    const { items, total } = await listarModelos({
      provider: "anthropic",
      sort: "relevance",
      limit: 30,
    });

    // O terceiro modelo do dublê não está em PRECOS_ANTHROPIC: sem preço, o
    // teto diário mentiria, e ele fica fora.
    expect(total).toBe(2);
    expect(items.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);

    const opus = items[0];
    expect(opus).toMatchObject({
      provider: "anthropic",
      name: "Claude Opus 5.5",
      contextLength: 1_000_000,
      promptMicros: 4_000_000,
      completionMicros: 20_000_000,
      supportsTools: true,
      free: false,
      reasoning: true,
      acceptsImage: true,
      indices: null,
    });
    expect(items[1]?.acceptsImage).toBe(false);
  });

  test("o catálogo do OpenRouter e o da Anthropic não se misturam no cache", async () => {
    // Um cache por provedor: pedir a Anthropic não pode responder o do outro.
    await listarModelos({ provider: "anthropic", sort: "relevance", limit: 30 });
    await listarModelos({ provider: "anthropic", sort: "relevance", limit: 30 });

    expect(duble.recebidas.filter((r) => r.startsWith("GET /v1/models"))).toHaveLength(1);
  });

  test("API que lista e tabela que não reconhece nada falha alto, com o remédio", async () => {
    duble.responder = () => ({
      corpo: {
        data: MODELOS_ANTHROPIC.filter((m) => !precoAnthropic(m.id)),
        has_more: false,
        first_id: null,
        last_id: null,
      },
    });

    const erro = await listarModelos({ provider: "anthropic", sort: "relevance", limit: 30 }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(AppError);
    expect((erro as AppError).message).toContain("PRECOS_ANTHROPIC");
  });

  test("GET /ai/models?provider=anthropic responde pela rota", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/models?provider=anthropic",
      token: dono.token,
    });

    expect(status).toBe(200);
    expect((body as AiModelList).items.every((m) => m.provider === "anthropic")).toBe(true);
  });
});

describe("favorito da Anthropic", () => {
  test("favoritar grava o provedor e a cópia do preço da tabela", async () => {
    const { status, body } = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: dono.token,
      body: { modelId: "claude-opus-5-5", provider: "anthropic" },
    });

    expect(status).toBe(201);
    expect(body as AiFavorite).toMatchObject({
      id: "claude-opus-5-5",
      provider: "anthropic",
      promptMicros: 4_000_000,
      completionMicros: 20_000_000,
    });

    const linha = await prisma.aiModelFavorite.findUnique({
      where: { userId_modelId: { userId: dono.id, modelId: "claude-opus-5-5" } },
    });
    expect(linha?.provider).toBe("anthropic");
  });

  test("modelo fora do catálogo da Anthropic é recusado com 422", async () => {
    const { status } = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: dono.token,
      body: { modelId: "claude-sem-preco-9", provider: "anthropic" },
    });

    expect(status).toBe(422);
  });

  test("sem `provider` no corpo, procura no OpenRouter, como antes", async () => {
    // O web de hoje não manda o campo. O id da Anthropic não existe lá, então
    // o pedido vira 422 em vez de favoritar no provedor errado. O OpenRouter
    // desta suíte não está no ar, e a recusa vem do catálogo indisponível.
    const { status } = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: dono.token,
      body: { modelId: "claude-haiku-5-5" },
    });

    expect(status).not.toBe(201);
    expect(duble.recebidas).toEqual([]);
  });
});

describe("custo e uso da Anthropic", () => {
  test("a conta usa a tabela, com cache e busca", () => {
    const opus = PRECOS_ANTHROPIC["claude-opus-5-5"];
    if (!opus) throw new Error("tabela sem o Opus 5.5");

    // 1 milhão de entrada a US$ 4 + 1 milhão de saída a US$ 20.
    expect(
      custoAnthropicMicros(opus, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearches: 0,
      }),
    ).toBe(24_000_000);

    // Leitura de cache a US$ 0,20, escrita a US$ 5, e duas buscas a US$ 0,01.
    expect(
      custoAnthropicMicros(opus, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        webSearches: 2,
      }),
    ).toBe(200_000 + 5_000_000 + 20_000);
  });

  test("o Haiku 5.5 muda de faixa acima de 100 mil tokens de prompt, contando o cache", () => {
    const haiku = PRECOS_ANTHROPIC["claude-haiku-5-5"];
    if (!haiku) throw new Error("tabela sem o Haiku 5.5");

    const curto = {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    // 100 mil a US$ 0,10/M = US$ 0,01.
    expect(custoAnthropicMicros(haiku, { ...curto, webSearches: 0 })).toBe(10_000);
    // Um token de cache a mais passa o prompt do limite: tudo à faixa longa,
    // 100 mil a US$ 0,50/M = US$ 0,05, mais o token lido a US$ 0,05/M.
    expect(custoAnthropicMicros(haiku, { ...curto, cacheReadTokens: 1, webSearches: 0 })).toBe(
      50_001,
    );
  });

  test("a linha de uso grava provedor e cache; sem provedor, é do OpenRouter", async () => {
    const comum = {
      userId: dono.id,
      task: "chat" as const,
      modelId: "claude-opus-5-5",
      promptTokens: 10,
      completionTokens: 20,
      costMicros: 1,
      costSource: "estimado" as const,
      durationMs: 5,
      ok: true,
      localDay: "2026-10-21",
    };
    await registrarUso({
      ...comum,
      provider: "anthropic",
      cacheReadTokens: 300,
      cacheWriteTokens: 40,
    });
    await registrarUso({ ...comum, modelId: "estudio/conversa" });

    const linhas = await prisma.aiUsage.findMany({
      where: { userId: dono.id },
      orderBy: { createdAt: "asc" },
    });
    expect(linhas.map((l) => [l.provider, l.cacheReadTokens, l.cacheWriteTokens])).toEqual([
      ["anthropic", 300, 40],
      ["openrouter", 0, 0],
    ]);
  });
});
