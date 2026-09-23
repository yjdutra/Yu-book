import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AiHealth } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { diaLocal, TETO_DIARIO_PADRAO_MICROS } from "@yu-book/shared";
import { saude } from "../src/modules/assistente/assistente.service.js";
import { pedirDoProvedor } from "../src/modules/assistente/openrouter.service.js";
import {
  custoDaResposta,
  garantirTeto,
  resumoDoDia,
} from "../src/modules/assistente/custo.service.js";
import { esquecerCatalogo, listarModelos } from "../src/modules/assistente/modelos.service.js";
import { modeloParaTarefa } from "../src/modules/assistente/preferencias.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Etapa A do assistente: transporte e saúde.
 *
 * O que esta suíte protege, acima de tudo, é que **nenhuma conexão saia para o
 * provedor de verdade**. `tests/setup.ts` aponta `OPENROUTER_BASE_URL` para o
 * dublê abaixo; o serviço ainda lança se o host real aparecer em modo de teste.
 */

/**
 * Três modelos que cobrem o que a normalização precisa acertar: preço com
 * muitas casas, preço zero, nome com acento, e um que não sabe chamar
 * ferramenta. Os campos são os do catálogo real, capturado em 2026-09-22.
 */
const MODELOS = [
  {
    id: "estudio/gpt-x",
    name: "Estúdio: GPT-X",
    context_length: 128_000,
    pricing: { prompt: "0.00000435", completion: "0.0000087" },
    supported_parameters: ["temperature", "tools"],
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    reasoning: { mandatory: false, default_effort: "medium" },
    knowledge_cutoff: "2026-02-16",
    benchmarks: {
      artificial_analysis: { intelligence_index: 47.5, coding_index: 61, agentic_index: null },
    },
  },
  {
    id: "estudio/gpt-x:batch",
    name: "Estúdio: GPT-X (batch)",
    context_length: 128_000,
    pricing: { prompt: "0.000002175", completion: "0.00000435" },
    supported_parameters: ["temperature", "tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
  {
    id: "meta/llama-3-8b:free",
    name: "Meta: Llama Programação",
    context_length: 8_192,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["temperature"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
  {
    id: "anthropic/claude-x",
    name: "Anthropic: Claude X",
    context_length: 200_000,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    benchmarks: {
      artificial_analysis: { intelligence_index: 55, coding_index: 70, agentic_index: 60 },
    },
  },
  {
    /// Devolve imagem: a tarefa aqui é texto entra, texto sai.
    id: "estudio/pintor",
    name: "Estúdio: Pintor",
    context_length: 32_000,
    pricing: { prompt: "0.00001", completion: "0.00002" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] },
  },
  {
    /// Apelido que o provedor repõe: o favorito guardaria preço de outro modelo.
    id: "~estudio/gpt-latest",
    name: "Estúdio: GPT (latest)",
    context_length: 128_000,
    pricing: { prompt: "0.00000435", completion: "0.0000087" },
    supported_parameters: ["tools"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    alias_target: { name: "Estúdio: GPT-X", slug: "estudio/gpt-x" },
  },
];

function respostaPadrao(url: string): { status?: number; corpo?: unknown } {
  if (url.endsWith("/models")) return { corpo: { data: MODELOS } };
  return { corpo: { data: { label: "chave de teste" } } };
}

interface Dublê {
  server: Server;
  recebidas: string[];
  responder: (url: string) => { status?: number; corpo?: unknown };
}

/// A porta é a mesma escrita em `tests/setup.ts` — ela é escolhida antes de o
/// `env` da aplicação existir, então não pode ser sorteada aqui.
const PORTA = 39333;

let app: FastifyInstance;
let dono: Usuario;
let dublê: Dublê;

beforeAll(async () => {
  await limpar();

  const estado: Dublê = {
    server: createServer(),
    recebidas: [],
    responder: respostaPadrao,
  };
  estado.server.on("request", (req, res) => {
    estado.recebidas.push(req.url ?? "");
    const { status = 200, corpo = {} } = estado.responder(req.url ?? "");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(corpo));
  });
  await new Promise<void>((ok) => estado.server.listen(PORTA, "127.0.0.1", ok));
  dublê = estado;

  app = await subirApp();
  dono = await criarUsuario("ia-dono");
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((ok) => dublê.server.close(() => ok()));
  await limpar();
});

beforeEach(() => {
  dublê.recebidas = [];
  dublê.responder = respostaPadrao;
  /// O catálogo é cache de módulo: sem esquecer, um teste herda o do anterior.
  esquecerCatalogo();
});

describe("saúde do assistente", () => {
  test("sem chave configurada, responde 'não configurado' sem abrir conexão nenhuma", async () => {
    // CA-02 e RNF-03: a API sobe e funciona sem a variável; o que some é só a IA.
    const resultado = await saude({ chave: undefined });

    expect(resultado.configured).toBe(false);
    expect(resultado.reachable).toBe(false);
    expect(resultado.label).toBeNull();
    // A asserção que importa: o dublê não foi procurado. Se um dia alguém
    // consultar o provedor antes de conferir a chave, é aqui que aparece.
    expect(dublê.recebidas).toEqual([]);
  });

  test("com chave, consulta o provedor sem executar inferência", async () => {
    // RF-08: a saúde pergunta pela chave, nunca gera texto. Se alguém trocar
    // isto por uma chamada de completions, o caminho recebido muda e o teste cai.
    const resultado = await saude({ chave: "chave-de-teste" });

    expect(resultado.configured).toBe(true);
    expect(resultado.reachable).toBe(true);
    expect(resultado.label).toBe("chave de teste");
    expect(dublê.recebidas).toEqual(["/api/v1/key"]);
  });

  test("o erro do provedor diz o caminho e o que ele respondeu", async () => {
    // "respondeu 404" sozinho não diz a ninguém o que fazer — e o 404 mais
    // provável vem de base URL errada, não de recusa do provedor.
    dublê.responder = () => ({
      status: 404,
      corpo: { error: { message: "No endpoints found for this model." } },
    });

    const erro = await pedirDoProvedor<unknown>("/chat/completions", { chave: "x" }).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e : null),
    );

    expect(erro).not.toBeNull();
    expect(erro?.message).toContain("404");
    expect(erro?.message).toContain("/chat/completions");
    expect(erro?.message).toContain("No endpoints found");
  });

  test("provedor fora do ar vira 'não responde', não exceção", async () => {
    dublê.responder = () => ({ status: 503, corpo: { error: "fora do ar" } });

    const resultado = await saude({ chave: "chave-de-teste" });

    expect(resultado.configured).toBe(true);
    expect(resultado.reachable).toBe(false);
  });

  test("chave recusada pelo provedor também vira 'não responde'", async () => {
    dublê.responder = () => ({ status: 401, corpo: { error: "sem credencial" } });

    const resultado = await saude({ chave: "chave-errada" });

    expect(resultado.reachable).toBe(false);
  });
});

describe("GET /ai/health", () => {
  test("exige autenticação, como todo o resto do módulo", async () => {
    const resposta = await app.inject({ method: "GET", url: "/ai/health" });
    expect(resposta.statusCode).toBe(401);
  });

  test("responde o formato de saúde", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/health",
      token: dono.token,
    });

    expect(status).toBe(200);
    const saudeDoCorpo = body as AiHealth;
    expect(saudeDoCorpo.provider).toBe("openrouter");
    expect(typeof saudeDoCorpo.configured).toBe("boolean");
    expect(typeof saudeDoCorpo.reachable).toBe("boolean");
    expect(typeof saudeDoCorpo.checkedAt).toBe("string");
  });
});

describe("catálogo de modelos", () => {
  test("normaliza preço, contexto e as duas bandeiras", async () => {
    const { items, total } = await listarModelos({ sort: "relevance", limit: 30 });

    expect(total).toBe(3);
    const gpt = items.find((m) => m.id === "estudio/gpt-x");
    // "0.00000435" USD por token = US$ 4,35 por milhão = 4350000 µUSD.
    expect(gpt?.promptMicros).toBe(4_350_000);
    expect(gpt?.completionMicros).toBe(8_700_000);
    expect(gpt?.contextLength).toBe(128_000);
    expect(gpt?.supportsTools).toBe(true);
    expect(gpt?.free).toBe(false);
    expect(gpt?.reasoning).toBe(true);
    expect(gpt?.acceptsImage).toBe(true);
    expect(gpt?.knowledgeCutoff).toBe("2026-02-16");
    // Índice ausente é `null`, nunca zero: zero seria uma nota ruim inventada
    // para um modelo que ninguém mediu.
    expect(gpt?.indices).toEqual({ intelligence: 47.5, coding: 61, agentic: null });

    const llama = items.find((m) => m.id === "meta/llama-3-8b:free");
    expect(llama?.free).toBe(true);
    expect(llama?.supportsTools).toBe(false);
    expect(llama?.reasoning).toBe(false);
    expect(llama?.indices).toBeNull();
  });

  test("variante de lote fica fora do catálogo", async () => {
    // Ela responde 404 em /chat/completions — "cannot be used with the
    // chat/completions endpoint" —, custa metade e fica colada na normal na
    // lista. Oferecer é convidar o usuário a escolher o que não funciona.
    const { items, total } = await listarModelos({ sort: "relevance", limit: 30 });

    expect(items.map((m) => m.id)).not.toContain("estudio/gpt-x:batch");
    expect(items.map((m) => m.id)).toContain("estudio/gpt-x");
    expect(total).toBe(3);
  });

  test("modelo que não devolve texto fica fora", async () => {
    // Mesma classe do lote: oferecer no catálogo o que a chamada não aceita.
    const { items } = await listarModelos({ sort: "relevance", limit: 30 });
    expect(items.map((m) => m.id)).not.toContain("estudio/pintor");
  });

  test("forma desconhecida do provedor falha alto, não vira catálogo vazio", async () => {
    // As exclusões leem campo aninhado do provedor. Se essa forma mudar, toda
    // entrada vira descarte — e um catálogo vazio cacheado por uma hora
    // apareceria na tela como "0 de 0", indistinguível de filtro apertado.
    dublê.responder = (url) =>
      url.endsWith("/models")
        ? { corpo: { data: [{ id: "x/y", name: "X", pricing: { prompt: "0", completion: "0" } }] } }
        : respostaPadrao(url);

    await expect(listarModelos({ sort: "relevance", limit: 30 })).rejects.toThrow();
  });

  test("apelido fica fora", async () => {
    // Funciona, mas o favorito guarda cópia de preço e contexto — sob apelido
    // essa cópia fica errada em silêncio no dia em que o alvo muda.
    const { items } = await listarModelos({ sort: "relevance", limit: 30 });
    expect(items.map((m) => m.id)).not.toContain("~estudio/gpt-latest");
  });

  test("o teto de preço corta, e zero é o filtro de gratuitos", async () => {
    const baratos = await listarModelos({ sort: "relevance", limit: 30, maxPrice: 3_000_000 });
    expect(baratos.items.map((m) => m.id).sort()).toEqual([
      "anthropic/claude-x",
      "meta/llama-3-8b:free",
    ]);

    // `0` tem que filtrar, não ser tratado como "sem filtro".
    const gratis = await listarModelos({ sort: "relevance", limit: 30, maxPrice: 0 });
    expect(gratis.items.map((m) => m.id)).toEqual(["meta/llama-3-8b:free"]);
  });

  test("ordenar por índice põe quem não foi medido no fim, nunca no meio", async () => {
    // É a asserção que impede a ordenação de mentir: ausência de medição não é
    // nota baixa, e tratá-la como zero enfileiraria o não medido atrás do pior.
    const { items } = await listarModelos({ sort: "coding", limit: 30 });

    expect(items.map((m) => m.id)).toEqual([
      "anthropic/claude-x",
      "estudio/gpt-x",
      "meta/llama-3-8b:free",
    ]);
  });

  test("ordenar por preço não se limita aos primeiros do provedor", async () => {
    const { items } = await listarModelos({ sort: "price", limit: 2 });
    expect(items.map((m) => m.id)).toEqual(["meta/llama-3-8b:free", "anthropic/claude-x"]);
  });

  test("a busca casa sem acento, como o resto do projeto", async () => {
    // `programacao` tem que achar `Programação` — é a mesma chave que o banco
    // usa. O acento existe **só no nome**: se estivesse também no id, a busca
    // casaria pelo id e este teste passaria com a normalização quebrada.
    const { items, total } = await listarModelos({ sort: "relevance", q: "programacao", limit: 30 });

    expect(total).toBe(1);
    expect(items[0]?.id).toBe("meta/llama-3-8b:free");
  });

  test("tools=true deixa de fora quem não sabe chamar ferramenta", async () => {
    const { items } = await listarModelos({ sort: "relevance", tools: true, limit: 30 });

    expect(items.map((m) => m.id).sort()).toEqual(["anthropic/claude-x", "estudio/gpt-x"]);
  });

  test("total conta o que casou, não o que coube no corte", async () => {
    // Sem isto a tela diria "1 de 1" quando há três — mentira barata e difícil
    // de notar, porque a lista mostrada estaria certa.
    const { items, total } = await listarModelos({ sort: "relevance", limit: 1 });

    expect(items).toHaveLength(1);
    expect(total).toBe(3);
  });

  test("a segunda consulta não toca no provedor", async () => {
    await listarModelos({ sort: "relevance", limit: 30 });
    const depoisDaPrimeira = [...dublê.recebidas];
    await listarModelos({ sort: "relevance", q: "claude", limit: 30 });

    expect(depoisDaPrimeira).toEqual(["/api/v1/models"]);
    expect(dublê.recebidas).toEqual(depoisDaPrimeira);
  });

  test("com cache quente, provedor fora do ar devolve o que tinha e avisa", async () => {
    const primeira = await listarModelos({ sort: "relevance", limit: 30 });
    expect(primeira.stale).toBe(false);

    esquecerCatalogo();
    dublê.responder = () => ({ status: 503, corpo: { error: "fora do ar" } });
    // Recarrega e falha — mas o cache anterior foi esquecido, então este caminho
    // é o de "sem cache": o erro tem que subir.
    await expect(listarModelos({ sort: "relevance", limit: 30 })).rejects.toThrow();
  });

  test("o catálogo não exige chave — sem ela a tela ainda lista modelos", async () => {
    // `GET /models` é público no provedor. Exigir chave aqui faria a tela de
    // ajustes ficar vazia num servidor sem chave, contra RNF-03.
    const { items } = await listarModelos({ sort: "relevance", limit: 30 });

    expect(items.length).toBeGreaterThan(0);
    expect(dublê.recebidas).toEqual(["/api/v1/models"]);
  });
});

describe("GET /ai/models", () => {
  test("devolve o catálogo filtrado pela query", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/models?tools=true&limit=5",
      token: dono.token,
    });

    expect(status).toBe(200);
    const lista = body as { items: { id: string }[]; total: number; stale: boolean };
    expect(lista.total).toBe(2);
    expect(lista.stale).toBe(false);
  });

  test("sem cache e com provedor fora do ar, responde com código estável", async () => {
    dublê.responder = () => ({ status: 503, corpo: { error: "fora do ar" } });

    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/models",
      token: dono.token,
    });

    expect(status).toBe(503);
    expect((body as { error: { code: string } }).error.code).toBe("PROVEDOR_INDISPONIVEL");
  });
});

describe("tabelas de IA", () => {
  /// Uma chamada registrada, com o mínimo que a tabela exige.
  function usoDe(userId: string, extra: Record<string, unknown> = {}) {
    return {
      userId,
      task: "formatar" as const,
      modelId: "estudio/gpt-x",
      costSource: "provedor" as const,
      costMicros: 1_200,
      durationMs: 900,
      ok: true,
      localDay: "2026-09-22",
      ...extra,
    };
  }

  test("a preferência é uma por conta", async () => {
    // É o que deixa o upsert de A5 ser seguro: sem o único, duas leituras
    // concorrentes criariam duas linhas e o teto passaria a depender de qual
    // delas fosse lida.
    const u = await criarUsuario("ia-pref");
    await prisma.aiPreference.create({
      data: { userId: u.id, dailyCapMicros: 200_000, timezone: "America/Sao_Paulo" },
    });

    await expect(
      prisma.aiPreference.create({
        data: { userId: u.id, dailyCapMicros: 500_000, timezone: "UTC" },
      }),
    ).rejects.toThrow();
  });

  test("o mesmo modelo não é favoritado duas vezes", async () => {
    // É onde a idempotência de `POST /ai/favorites` vai se apoiar.
    const u = await criarUsuario("ia-fav");
    const favorito = {
      userId: u.id,
      modelId: "anthropic/claude-x",
      name: "Anthropic: Claude X",
      contextLength: 200_000,
      promptMicros: 3_000_000,
      completionMicros: 15_000_000,
      supportsTools: true,
    };
    await prisma.aiModelFavorite.create({ data: favorito });

    await expect(prisma.aiModelFavorite.create({ data: favorito })).rejects.toThrow();
  });

  test("apagar a conta leva preferência, favoritos, tarefas e uso junto", async () => {
    const u = await criarUsuario("ia-cascata");
    await prisma.aiPreference.create({
      data: { userId: u.id, dailyCapMicros: 200_000, timezone: "America/Sao_Paulo" },
    });
    await prisma.aiTaskModel.create({
      data: { userId: u.id, task: "formatar", modelId: "estudio/gpt-x" },
    });
    await prisma.aiUsage.create({ data: usoDe(u.id) });

    await prisma.user.delete({ where: { id: u.id } });

    expect(await prisma.aiPreference.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.aiTaskModel.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.aiUsage.count({ where: { userId: u.id } })).toBe(0);
  });

  test("apagar a nota não apaga o registro de gasto", async () => {
    // A mais importante das quatro. Com `Cascade` no lugar de `SetNull`, o
    // gasto do dia viraria apagável por exclusão de nota — e o teto diário,
    // contornável sem que nada reclamasse.
    const u = await criarUsuario("ia-gasto");
    const nota = await prisma.note.create({
      data: { userId: u.id, title: `nota de gasto ${crypto.randomUUID()}`, contentMd: "" },
    });
    const uso = await prisma.aiUsage.create({ data: usoDe(u.id, { noteId: nota.id }) });

    await prisma.note.delete({ where: { id: nota.id } });

    const depois = await prisma.aiUsage.findUnique({ where: { id: uso.id } });
    expect(depois).not.toBeNull();
    expect(depois?.noteId).toBeNull();
    expect(depois?.costMicros).toBe(1_200);
  });
});

describe("teto diário e custo", () => {
  const PRECO = { promptMicros: 4_350_000, completionMicros: 8_700_000 };

  async function gravarUso(userId: string, localDay: string, costMicros: number) {
    await prisma.aiUsage.create({
      data: {
        userId,
        task: "formatar",
        modelId: "estudio/gpt-x",
        costSource: "provedor",
        costMicros,
        durationMs: 500,
        ok: true,
        localDay,
      },
    });
  }

  test("o teto corta antes da chamada, com os dois números na mensagem", async () => {
    const u = await criarUsuario("ia-teto");
    const teto = { timezone: "America/Sao_Paulo", dailyCapMicros: 200_000 };
    await gravarUso(u.id, diaLocal(new Date(), teto.timezone), 180_000);

    // 180000 já gastos + 30000 estimados passam de 200000.
    const erro = await garantirTeto(u.id, teto, 30_000).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(Error);
    expect((erro as { code?: string }).code).toBe("TETO_DIARIO_ATINGIDO");
    // A mensagem precisa dizer quanto foi e quanto cabe — recusa sem número é
    // recusa que o usuário não sabe como resolver.
    expect((erro as Error).message).toContain("US$");
    expect((erro as Error).message).toMatch(/0,18/);
    expect((erro as Error).message).toMatch(/0,20/);
  });

  test("abaixo do teto, passa e devolve o gasto do dia", async () => {
    const u = await criarUsuario("ia-teto-ok");
    const teto = { timezone: "America/Sao_Paulo", dailyCapMicros: 200_000 };
    await gravarUso(u.id, diaLocal(new Date(), teto.timezone), 10_000);

    const resumo = await garantirTeto(u.id, teto, 5_000);

    expect(resumo.spentMicros).toBe(10_000);
  });

  test("a janela do dia é a do usuário, não a do processo", async () => {
    // Os dois fusos estão a 26 horas de distância, então a data local deles
    // **nunca** coincide — o que torna o teste determinístico a qualquer hora.
    // Nenhum dos dois é o fuso do processo: usar a hora local do servidor aqui
    // daria zero nas duas somas.
    const u = await criarUsuario("ia-fuso");
    const cedo = "Pacific/Kiritimati"; // UTC+14
    const tarde = "Etc/GMT+12"; // UTC−12
    const agora = new Date();
    expect(diaLocal(agora, cedo)).not.toBe(diaLocal(agora, tarde));

    await gravarUso(u.id, diaLocal(agora, cedo), 7_000);
    await gravarUso(u.id, diaLocal(agora, tarde), 3_000);

    expect((await resumoDoDia(u.id, cedo)).spentMicros).toBe(7_000);
    expect((await resumoDoDia(u.id, tarde)).spentMicros).toBe(3_000);
  });

  test("a cascata de custo grava qual degrau produziu o número", async () => {
    // Degrau 1: o provedor informou o custo. É o caminho normal.
    const doProvedor = custoDaResposta({ cost: 0.000123, prompt_tokens: 10 }, PRECO);
    expect(doProvedor.costSource).toBe("provedor");
    expect(doProvedor.costMicros).toBe(123);

    // Degrau 2: vieram só os tokens — estimamos pelo preço do snapshot.
    const estimado = custoDaResposta({ prompt_tokens: 1_000, completion_tokens: 500 }, PRECO);
    expect(estimado.costSource).toBe("estimado");
    expect(estimado.costMicros).toBe(Math.ceil(4_350 + 4_350));

    // Degrau 3: nem custo nem token. Grava zero — e zero NÃO move o teto, por
    // isso ele precisa ser contado e mostrado na tela.
    const desconhecido = custoDaResposta(undefined, PRECO);
    expect(desconhecido.costSource).toBe("desconhecido");
    expect(desconhecido.costMicros).toBe(0);
  });

  test("chamada sem custo informado é contada no resumo do dia", async () => {
    const u = await criarUsuario("ia-sem-custo");
    const fuso = "America/Sao_Paulo";
    const dia = diaLocal(new Date(), fuso);
    await prisma.aiUsage.create({
      data: {
        userId: u.id,
        task: "formatar",
        modelId: "estudio/gpt-x",
        costSource: "desconhecido",
        costMicros: 0,
        durationMs: 500,
        ok: true,
        localDay: dia,
      },
    });

    const resumo = await resumoDoDia(u.id, fuso);

    expect(resumo.spentMicros).toBe(0);
    expect(resumo.callsWithoutCostToday).toBe(1);
  });
});

describe("ajustes de IA", () => {
  test("GET /ai/settings devolve os padrões sem criar linha nenhuma", async () => {
    const u = await criarUsuario("ia-ajustes");

    const { status, body } = await chamar(app, { method: "GET", url: "/ai/settings", token: u.token });
    const ajustes = body as { dailyCapMicros: number; favorites: unknown[] };

    expect(status).toBe(200);
    expect(ajustes.dailyCapMicros).toBe(TETO_DIARIO_PADRAO_MICROS);
    expect(ajustes.favorites).toEqual([]);
    // Um GET que escreve é surpresa; quem cria a linha é o PATCH.
    expect(await prisma.aiPreference.count({ where: { userId: u.id } })).toBe(0);
  });

  test("favoritar duas vezes devolve o mesmo favorito, com 200 na segunda", async () => {
    const u = await criarUsuario("ia-favoritar");
    const corpo = { modelId: "estudio/gpt-x" };

    const primeira = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: u.token,
      body: corpo,
    });
    const segunda = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: u.token,
      body: corpo,
    });

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(200);
    const a = primeira.body as { favoriteId: string; promptMicros: number };
    const b = segunda.body as { favoriteId: string };
    expect(b.favoriteId).toBe(a.favoriteId);
    // A cópia do catálogo foi junto: é o que a estimativa de custo vai usar.
    expect(a.promptMicros).toBe(4_350_000);
  });

  test("modelo de tarefa precisa ser um favorito", async () => {
    const u = await criarUsuario("ia-tarefa");

    const semFavorito = await chamar(app, {
      method: "PATCH",
      url: "/ai/tasks/formatar",
      token: u.token,
      body: { modelId: "anthropic/claude-x" },
    });
    expect(semFavorito.status).toBe(422);

    await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: u.token,
      body: { modelId: "anthropic/claude-x" },
    });
    const comFavorito = await chamar(app, {
      method: "PATCH",
      url: "/ai/tasks/formatar",
      token: u.token,
      body: { modelId: "anthropic/claude-x" },
    });

    expect(comFavorito.status).toBe(200);
    expect((comFavorito.body as Record<string, string>).formatar).toBe("anthropic/claude-x");
  });

  test("favorito de lote gravado antes do filtro é recusado com motivo", async () => {
    // O provedor recusaria com 404 e uma frase em inglês sobre adaptadores.
    const u = await criarUsuario("ia-lote");
    await prisma.aiModelFavorite.create({
      data: {
        userId: u.id,
        modelId: "estudio/gpt-x:batch",
        name: "Estúdio: GPT-X (batch)",
        contextLength: 128_000,
        promptMicros: 2_175_000,
        completionMicros: 4_350_000,
        supportsTools: true,
      },
    });
    await prisma.aiTaskModel.create({
      data: { userId: u.id, task: "formatar", modelId: "estudio/gpt-x:batch" },
    });

    const erro = await modeloParaTarefa(u.id, "formatar").then(
      () => null,
      (e: unknown) => (e instanceof Error ? e : null),
    );

    expect(erro?.message).toContain("lote");
    expect(erro?.message).toContain("Remova");
  });

  test("favorito de outra conta é 404, não 403", async () => {
    const dona = await criarUsuario("ia-dona");
    const intrusa = await criarUsuario("ia-intrusa");
    const criado = await chamar(app, {
      method: "POST",
      url: "/ai/favorites",
      token: dona.token,
      body: { modelId: "estudio/gpt-x" },
    });
    const { favoriteId } = criado.body as { favoriteId: string };

    const resposta = await chamar(app, {
      method: "DELETE",
      url: `/ai/favorites/${favoriteId}`,
      token: intrusa.token,
    });

    expect(resposta.status).toBe(404);
  });

  test("PATCH /ai/settings cria a linha e o teto passa a valer", async () => {
    const u = await criarUsuario("ia-patch");

    const { status, body } = await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: u.token,
      body: { dailyCapMicros: 50_000, timezone: "UTC" },
    });

    expect(status).toBe(200);
    expect((body as { dailyCapMicros: number }).dailyCapMicros).toBe(50_000);
    expect((body as { timezone: string }).timezone).toBe("UTC");
    expect(await prisma.aiPreference.count({ where: { userId: u.id } })).toBe(1);
  });
});

describe("POST /ai/notes/:id/format", () => {
  /// Um IP por teste: a rota tem limite próprio de 10/min, e sem isto os testes
  /// dividem o mesmo balde — o oitavo derruba o nono por 429.
  let proximoIp = 0;
  const ip = () => `10.0.0.${++proximoIp}`;

  /// Responde catálogo e chave como sempre, e o texto pedido no /chat/completions.
  function responderCom(
    texto: string,
    uso: unknown = { prompt_tokens: 120, completion_tokens: 80, cost: 0.000_25 },
  ) {
    return (url: string) => {
      if (url.endsWith("/chat/completions")) {
        return {
          corpo: {
            id: "gen-teste",
            model: "estudio/gpt-x",
            choices: [{ message: { content: texto } }],
            usage: uso,
          },
        };
      }
      return respostaPadrao(url);
    };
  }

  /// Usuário com um modelo favoritado e escolhido para a tarefa, mais uma nota.
  async function comModelo(apelido: string, modelId = "estudio/gpt-x", corpo = "# nota\ntexto") {
    const u = await criarUsuario(apelido);
    await chamar(app, { method: "POST", url: "/ai/favorites", token: u.token, body: { modelId } });
    await chamar(app, {
      method: "PATCH",
      url: "/ai/tasks/formatar",
      token: u.token,
      body: { modelId },
    });
    const nota = await prisma.note.create({
      data: { userId: u.id, title: `nota ia ${crypto.randomUUID()}`, contentMd: corpo },
    });
    return { u, nota };
  }

  test("o teto atingido recusa sem abrir conexão com o provedor", async () => {
    const meuIp = ip();
    // O teste central do marco: prova que o corte acontece ANTES do provedor.
    const { u, nota } = await comModelo("ia-fmt-teto");
    await chamar(app, {
      method: "PATCH",
      url: "/ai/settings",
      token: u.token,
      body: { dailyCapMicros: 1 },
    });
    dublê.recebidas = [];
    dublê.responder = responderCom("qualquer coisa");

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: "texto para formatar" },
    });

    expect(status).toBe(402);
    expect((body as { error: { code: string } }).error.code).toBe("TETO_DIARIO_ATINGIDO");
    expect(dublê.recebidas.filter((x) => x.endsWith("/chat/completions"))).toEqual([]);
  });

  test("os wikilinks sobrevivem à formatação", async () => {
    const meuIp = ip();
    const corpo = "veja [[Alpha]] e [[Beta]] e também [[Gama]]";
    const { u, nota } = await comModelo("ia-fmt-wiki", "estudio/gpt-x", corpo);
    dublê.responder = responderCom(`## Referências\n\n- veja [[Alpha]]\n- e [[Beta]]\n- e também [[Gama]]`);

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: corpo },
    });

    expect(status).toBe(200);
    const resultado = body as { contentMd: string };
    expect(resultado.contentMd).toContain("[[Alpha]]");
    expect(resultado.contentMd).toContain("[[Beta]]");
    expect(resultado.contentMd).toContain("[[Gama]]");
  });

  test("modelo que altera um wikilink é recusado, e a chamada é registrada mesmo assim", async () => {
    const meuIp = ip();
    const corpo = "veja [[Alpha]]";
    const { u, nota } = await comModelo("ia-fmt-quebra", "estudio/gpt-x", corpo);
    // `note_link` é derivada: reescrever o alvo faria o backlink sumir calado.
    dublê.responder = responderCom("veja [[Alpha Corrigido]]");

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: corpo },
    });

    expect(status).toBe(502);
    expect((body as { error: { code: string } }).error.code).toBe("RESPOSTA_INVALIDA");
    // A chamada custou dinheiro; não registrar seria o teto perdendo o rastro.
    const usos = await prisma.aiUsage.findMany({ where: { userId: u.id } });
    expect(usos).toHaveLength(1);
    expect(usos[0]?.ok).toBe(false);
    expect(usos[0]?.costMicros).toBe(250);
  });

  test("reordenar e trocar a caixa dos wikilinks não é alteração", async () => {
    const meuIp = ip();
    // `note_link` é um CONJUNTO de alvos: ordem e repetição não existem nela, e
    // o índice do banco é sem acento e sem caixa. Formatar reordena itens por
    // natureza — recusar por isso custaria uma chamada paga por nada.
    const corpo = "veja [[Alpha]] e depois [[Beta]]";
    const { u, nota } = await comModelo("ia-fmt-ordem", "estudio/gpt-x", corpo);
    dublê.responder = responderCom("- [[beta]]\n- [[ Alpha ]]");

    const { status } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: corpo },
    });

    expect(status).toBe(200);
  });

  test("perder um alvo continua sendo alteração", async () => {
    const meuIp = ip();
    // O que a guarda protege de verdade: um alvo que some do conjunto some do
    // grafo de backlinks, e some calado.
    const corpo = "veja [[Alpha]] e [[Beta]]";
    const { u, nota } = await comModelo("ia-fmt-perda", "estudio/gpt-x", corpo);
    dublê.responder = responderCom("veja [[Alpha]]");

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: corpo },
    });

    expect(status).toBe(502);
    expect((body as { error: { code: string } }).error.code).toBe("RESPOSTA_INVALIDA");
  });

  test("nota de outra conta é 404", async () => {
    const meuIp = ip();
    const { nota } = await comModelo("ia-fmt-dona");
    const { u: intrusa } = await comModelo("ia-fmt-intrusa");
    dublê.responder = responderCom("texto");

    const { status } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: intrusa.token,
      ip: meuIp,
      body: { contentMd: "texto" },
    });

    expect(status).toBe(404);
  });

  test("sem modelo escolhido para a tarefa, 422 e nada sai", async () => {
    const meuIp = ip();
    const u = await criarUsuario("ia-fmt-sem-modelo");
    const nota = await prisma.note.create({
      data: { userId: u.id, title: `nota ia ${crypto.randomUUID()}`, contentMd: "x" },
    });
    dublê.recebidas = [];
    dublê.responder = responderCom("texto");

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: "x" },
    });

    expect(status).toBe(422);
    expect((body as { error: { code: string } }).error.code).toBe("MODELO_NAO_ESCOLHIDO");
    expect(dublê.recebidas.filter((x) => x.endsWith("/chat/completions"))).toEqual([]);
  });

  test("corpo maior que o contexto do modelo é recusado antes de chamar", async () => {
    const meuIp = ip();
    // O modelo pequeno da amostra tem contexto de 8192 tokens.
    const grande = "a".repeat(40_000);
    const { u, nota } = await comModelo("ia-fmt-grande", "meta/llama-3-8b:free", "x");
    dublê.recebidas = [];
    dublê.responder = responderCom("texto");

    const { status, body } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: grande },
    });

    expect(status).toBe(422);
    // A mensagem precisa dizer o tamanho e o limite — recusa sem número não
    // diz ao usuário o que fazer.
    expect((body as { error: { message: string } }).error.message).toContain("8192");
    expect(dublê.recebidas.filter((x) => x.endsWith("/chat/completions"))).toEqual([]);
  });

  test("o sucesso grava uma linha de uso com o custo do provedor", async () => {
    const meuIp = ip();
    const { u, nota } = await comModelo("ia-fmt-ok");
    dublê.responder = responderCom("# Título\n\ntexto arrumado");

    const { status } = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: "texto bagunçado" },
    });

    expect(status).toBe(200);
    const uso = await prisma.aiUsage.findFirst({ where: { userId: u.id } });
    expect(uso?.ok).toBe(true);
    expect(uso?.costSource).toBe("provedor");
    expect(uso?.costMicros).toBe(250);
    expect(uso?.noteId).toBe(nota.id);
    expect(uso?.generationId).toBe("gen-teste");
  });

  test("cerca de código é desembrulhada, mas não em nota que já era um bloco", async () => {
    const meuIp = ip();
    const { u, nota } = await comModelo("ia-fmt-cerca");

    dublê.responder = responderCom("```markdown\n# Título\n\ntexto\n```");
    const normal = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: "texto solto" },
    });
    expect((normal.body as { contentMd: string }).contentMd).toBe("# Título\n\ntexto");

    // A nota já era um bloco de código: desembrulhar aqui destruiria o conteúdo.
    const codigo = "```js\nconst a = 1;\n```";
    dublê.responder = responderCom(codigo);
    const preservada = await chamar(app, {
      method: "POST",
      url: `/ai/notes/${nota.id}/format`,
      token: u.token,
      ip: meuIp,
      body: { contentMd: codigo },
    });
    expect((preservada.body as { contentMd: string }).contentMd).toBe(codigo);
  });
});
