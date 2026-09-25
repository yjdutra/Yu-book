import { createServer } from "node:http";
import type { Server } from "node:http";
import type {
  OpenRouterAccount,
  OpenRouterKeyReport,
  OpenRouterMetrics,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { env } from "../src/env.js";
import { AppError } from "../src/lib/errors.js";
import {
  chaveAtual,
  contaNoProvedor,
  esquecerMetaDoProvedor,
  metricasNoProvedor,
} from "../src/modules/assistente/openrouter-painel.service.js";
import { chamar, criarUsuario, limpar, subirApp } from "./apoio.js";
import type { Usuario } from "./apoio.js";

/**
 * Painel do OpenRouter (`/ajustes/openrouter`): o que o provedor diz sobre a
 * chave e a conta.
 *
 * O que esta suíte protege, acima da conversão de números, é **que nenhuma das
 * duas chaves chega ao navegador** e **que sem chave nada sai**. A management
 * key, no provedor, cria e apaga chaves; ela só pode ir aos caminhos de
 * leitura, e nunca voltar numa resposta.
 *
 * `tests/setup.ts` fixa `OPENROUTER_MANAGEMENT_KEY` em "gestao-de-teste" com
 * sobrescrita: as rotas exercitam o caminho com a chave, e os casos de "sem
 * chave" vão pela injeção do service, que distingue omitir de informar vazio.
 */

/// A mesma de `tests/setup.ts`: `env.ts` congela o endereço na importação.
const PORTA = 39333;

/// O instante fixo dos testes que dependem do dia UTC. Quinze horas, longe da
/// meia-noite, e o mesmo dia do relógio do servidor e do teste.
const AGORA = new Date("2026-09-25T15:00:00.000Z");

interface Recebida {
  metodo: string;
  caminho: string;
  autorizacao: string;
}

interface Dublê {
  server: Server;
  recebidas: Recebida[];
  corpos: Record<string, unknown>[];
  responder: (caminho: string, chave: string) => { status?: number; corpo?: unknown };
}

/**
 * O rótulo padrão do provedor é o prefixo da própria chave. O dublê faz pior:
 * devolve a chave **inteira** no rótulo, para que "o JSON não contém a chave"
 * seja uma afirmação sobre a redação, e não sobre um dublê que nunca a ecoou.
 */
function chaveDoProvedor(chave: string): Record<string, unknown> {
  return {
    label: `sk-or-v1-${chave}`,
    usage: 0.018623914,
    usage_daily: "0.5",
    usage_weekly: 1.25,
    usage_monthly: 3,
    byok_usage: 0,
    byok_usage_monthly: null,
    limit: 20,
    limit_remaining: 16.981376086,
    limit_reset: "monthly",
    include_byok_in_limit: false,
    is_free_tier: true,
    free_model_daily_requests: { used: 3, limit: 50, remaining: 47 },
    expires_at: null,
    /// Identificadores de conta que a resposta nunca pode copiar.
    creator_user_id: "user_criador_secreto",
    organization_id: "org_secreta",
    workspace_id: "ws_secreto",
    rate_limit: { requests: 10, interval: "10s" },
  };
}

/** Linha do `/activity` na forma do provedor: uma por dia, modelo e endpoint. */
function linha(
  date: string,
  model: string,
  provider_name: string,
  usage: number,
  requests: number,
): Record<string, unknown> {
  return {
    date,
    model,
    model_permaslug: `${model}-2026`,
    endpoint_id: `${model}@${provider_name}`,
    provider_name,
    usage,
    byok_usage_inference: 0,
    requests,
    prompt_tokens: requests * 100,
    completion_tokens: requests * 10,
    reasoning_tokens: requests,
  };
}

const META_PADRAO = [
  { name: "request_count", display_format: "number" },
  { name: "total_usage", display_format: "currency" },
  { name: "cache_hit_rate", display_format: "percent" },
  { name: "avg_latency", display_format: "latency" },
  /// Formato que o provedor ainda não tinha quando o código foi escrito.
  { name: "usage_web", display_format: "sparkline" },
  /// Anunciada pelo provedor, mas fora da lista do painel.
  { name: "tokens_prompt", display_format: "number" },
];

function respostaPadrao(caminho: string, chave: string): { status?: number; corpo?: unknown } {
  switch (caminho) {
    case "/api/v1/key":
      return { corpo: { data: chaveDoProvedor(chave) } };
    case "/api/v1/credits":
      return { corpo: { data: { total_credits: 10.1, total_usage: 0.3 } } };
    case "/api/v1/activity":
      return { corpo: { data: [linha("2026-09-24", "estudio/gpt-x", "Estúdio", 0.01, 1)] } };
    case "/api/v1/analytics/meta":
      return { corpo: { data: { metrics: META_PADRAO } } };
    case "/api/v1/analytics/query":
      return {
        corpo: {
          data: {
            data: [
              {
                request_count: "6",
                total_usage: 0.018623914,
                cache_hit_rate: null,
                avg_latency: "1234.5",
                usage_web: 0,
                tokens_prompt: 999,
              },
            ],
            truncated: true,
            warnings: ["ignorado"],
          },
        },
      };
    default:
      return { status: 404, corpo: { error: { message: `caminho inesperado ${caminho}` } } };
  }
}

let app: FastifyInstance;
let dono: Usuario;
let dublê: Dublê;

beforeAll(async () => {
  await limpar();

  const estado: Dublê = {
    server: createServer(),
    recebidas: [],
    corpos: [],
    responder: respostaPadrao,
  };
  estado.server.on("request", (req, res) => {
    const caminho = (req.url ?? "").split("?")[0] ?? "";
    const autorizacao = req.headers.authorization ?? "";
    estado.recebidas.push({ metodo: req.method ?? "", caminho, autorizacao });
    const pedacos: Buffer[] = [];
    req.on("data", (c: Buffer) => pedacos.push(c));
    req.on("end", () => {
      if (pedacos.length > 0) {
        try {
          estado.corpos.push(
            JSON.parse(Buffer.concat(pedacos).toString()) as Record<string, unknown>,
          );
        } catch {
          estado.corpos.push({});
        }
      }
      const chave = autorizacao.replace(/^Bearer /, "");
      const { status = 200, corpo = {} } = estado.responder(caminho, chave);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(corpo));
    });
  });
  await new Promise<void>((ok) => estado.server.listen(PORTA, "127.0.0.1", ok));
  dublê = estado;

  app = await subirApp();
  dono = await criarUsuario("painel-openrouter");
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((ok) => dublê.server.close(() => ok()));
  await limpar();
});

beforeEach(() => {
  dublê.recebidas = [];
  dublê.corpos = [];
  dublê.responder = respostaPadrao;
  /// O meta é cache de módulo: sem esquecer, um teste herda o do anterior.
  esquecerMetaDoProvedor();
});

afterEach(() => {
  vi.useRealTimers();
});

/// Só o `Date`: o `fetch` e o servidor do dublê seguem nos timers de verdade.
function congelarRelogio(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
}

function caminhos(): string[] {
  return dublê.recebidas.map((r) => r.caminho);
}

async function erroDe(promessa: Promise<unknown>): Promise<AppError | null> {
  return promessa.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e : null),
  );
}

describe("sem chave, nada sai", () => {
  test("sem chave de inferência, o bloco da chave diz 'não configurado' sem abrir conexão", async () => {
    // CA-02 e RNF-03: a API funciona sem a variável; o que some é só a IA.
    const relatorio = await chaveAtual({ chave: undefined, chaveDeGestao: undefined });

    expect(relatorio.configured).toBe(false);
    expect(relatorio.managementConfigured).toBe(false);
    expect(relatorio.key).toBeNull();
    expect(dublê.recebidas).toEqual([]);
  });

  test("sem chave de inferência, a presença da management key ainda é informada à tela", async () => {
    // A tela decide aviso ou blocos de conta por este booleano — e ele não
    // pode depender de a chave comum existir.
    const relatorio = await chaveAtual({ chave: undefined, chaveDeGestao: "qualquer" });

    expect(relatorio.configured).toBe(false);
    expect(relatorio.managementConfigured).toBe(true);
    expect(dublê.recebidas).toEqual([]);
  });

  test("sem management key, conta e métricas respondem vazio sem abrir conexão", async () => {
    // O ambiente da suíte TEM management key. Se a injeção cair de volta nele
    // (valor padrão de parâmetro no lugar do `in`), o dublê é procurado e o
    // teste cai — que é a regressão que ele existe para pegar.
    const conta = await contaNoProvedor({ chaveDeGestao: undefined });
    const metricas = await metricasNoProvedor({ chaveDeGestao: undefined });

    expect(conta).toMatchObject({ managementConfigured: false, credits: null, activity: null });
    expect(metricas).toMatchObject({ managementConfigured: false, window: null, items: [] });
    expect(dublê.recebidas).toEqual([]);
  });

  test("management key vazia vale como ausente", async () => {
    // `OPENROUTER_MANAGEMENT_KEY=` no `.env` é string vazia, não `undefined`.
    const conta = await contaNoProvedor({ chaveDeGestao: "" });
    const metricas = await metricasNoProvedor({ chaveDeGestao: "" });
    const relatorio = await chaveAtual({ chave: "chave-comum", chaveDeGestao: "" });

    expect(conta.managementConfigured).toBe(false);
    expect(metricas.managementConfigured).toBe(false);
    expect(relatorio.managementConfigured).toBe(false);
    expect(caminhos()).toEqual(["/api/v1/key"]);
  });
});

describe("a chave de inferência vista pelo provedor", () => {
  test("dinheiro chega em µUSD inteiros, e o rótulo sk-… é redigido", async () => {
    const relatorio = await chaveAtual({ chave: "sk-or-v1-segredo", chaveDeGestao: undefined });
    const chave = relatorio.key;

    expect(relatorio.configured).toBe(true);
    expect(chave).not.toBeNull();
    // 0.018623914 dólar → 18 623,914 µUSD, arredondado para inteiro.
    expect(chave?.usageMicros).toBe(18_624);
    // String numérica também é número para o provedor.
    expect(chave?.usageDailyMicros).toBe(500_000);
    expect(chave?.usageWeeklyMicros).toBe(1_250_000);
    // Campo nulo vira zero, nunca NaN.
    expect(chave?.byokUsageMonthlyMicros).toBe(0);
    expect(chave?.limitMicros).toBe(20_000_000);
    expect(chave?.limitRemainingMicros).toBe(16_981_376);
    expect(chave?.limitReset).toBe("monthly");
    expect(chave?.isFreeTier).toBe(true);
    expect(chave?.freeModelRequests).toEqual({ used: 3, limit: 50, remaining: 47 });
    expect(chave?.expiresAt).toBeNull();
    // O rótulo padrão é o prefixo da chave: sai `null`, e a chave não aparece
    // em lugar nenhum do que iria ao navegador.
    expect(chave?.label).toBeNull();
    expect(JSON.stringify(relatorio)).not.toContain("segredo");
  });

  test("rótulo que a pessoa nomeou passa intacto", async () => {
    dublê.responder = () => ({ corpo: { data: { label: "Yu-book produção" } } });

    const relatorio = await chaveAtual({ chave: "k", chaveDeGestao: undefined });

    expect(relatorio.key?.label).toBe("Yu-book produção");
  });

  test("identificadores de conta do provedor não são copiados para a resposta", async () => {
    const relatorio = await chaveAtual({ chave: "k", chaveDeGestao: undefined });
    const json = JSON.stringify(relatorio);

    for (const proibido of ["user_criador_secreto", "org_secreta", "ws_secreto", "rate_limit"]) {
      expect(json).not.toContain(proibido);
    }
  });

  test("sem teto e com renovação desconhecida, os campos ficam nulos em vez de inventados", async () => {
    dublê.responder = () => ({
      corpo: {
        data: {
          label: "sem teto",
          usage: "abc",
          limit: null,
          limit_remaining: null,
          limit_reset: "yearly",
          free_model_daily_requests: null,
          expires_at: "não é data",
        },
      },
    });

    const chave = (await chaveAtual({ chave: "k", chaveDeGestao: undefined })).key;

    expect(chave?.usageMicros).toBe(0);
    expect(chave?.limitMicros).toBeNull();
    expect(chave?.limitRemainingMicros).toBeNull();
    expect(chave?.limitReset).toBeNull();
    expect(chave?.freeModelRequests).toBeNull();
    expect(chave?.expiresAt).toBeNull();
  });
});

describe("saldo e histórico da conta", () => {
  test("o saldo é comprado menos usado, calculado em µUSD depois da conversão", async () => {
    // 10.1 − 0.3 em ponto flutuante é 9.799999999999999; em micros, exato.
    const conta = await contaNoProvedor({ chaveDeGestao: "gestao-x" });

    expect(conta.managementConfigured).toBe(true);
    expect(conta.credits).toEqual({
      purchasedMicros: 10_100_000,
      usedMicros: 300_000,
      balanceMicros: 9_800_000,
    });
  });

  test("a janela diária tem 30 dias exatos, de D-30 a D-1 em UTC, com zero no dia sem uso", async () => {
    congelarRelogio();
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/activity"
        ? {
            corpo: {
              data: [
                linha("2026-09-24", "estudio/gpt-x", "Estúdio", 0.018623914, 3),
                linha("2026-08-26", "estudio/gpt-x", "Estúdio", 0.001, 1),
                // Fora da janela nas duas pontas: hoje ainda não fechou, e
                // D-31 já saiu.
                linha("2026-09-25", "estudio/intruso", "Intruso", 9, 9),
                linha("2026-08-25", "estudio/intruso", "Intruso", 9, 9),
              ],
            },
          }
        : respostaPadrao(caminho, chave);

    const atividade = (await contaNoProvedor({ chaveDeGestao: "gestao-x" })).activity;
    const diario = atividade?.daily ?? [];

    expect(atividade?.from).toBe("2026-08-26");
    expect(atividade?.to).toBe("2026-09-24");
    expect(diario).toHaveLength(30);
    // Consecutivos, sem buraco nem repetição.
    for (let i = 1; i < diario.length; i++) {
      const anterior = Date.parse(`${diario[i - 1]?.date}T00:00:00Z`);
      expect(Date.parse(`${diario[i]?.date}T00:00:00Z`) - anterior).toBe(86_400_000);
    }
    expect(diario[0]).toEqual({ date: "2026-08-26", costMicros: 1_000, byokMicros: 0, requests: 1 });
    expect(diario[29]).toEqual({
      date: "2026-09-24",
      costMicros: 18_624,
      byokMicros: 0,
      requests: 3,
    });
    expect(diario[15]).toEqual({ date: "2026-09-10", costMicros: 0, byokMicros: 0, requests: 0 });
    // O que ficou fora da janela fica fora dos três cortes.
    expect(atividade?.byModel.map((m) => m.model)).toEqual(["estudio/gpt-x"]);
    expect(atividade?.byProvider.map((p) => p.provider)).toEqual(["Estúdio"]);
  });

  test("por modelo e por provedor somam as linhas de endpoints diferentes, e os três cortes batem", async () => {
    congelarRelogio();
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/activity"
        ? {
            corpo: {
              data: [
                // O mesmo modelo, no mesmo dia, servido por dois endpoints.
                linha("2026-09-24", "estudio/gpt-x", "Estúdio", 0.018623914, 3),
                linha("2026-09-24", "estudio/gpt-x", "Nuvem", 0.001, 1),
                linha("2026-09-20", "anthropic/claude-x", "Estúdio", 0.5, 2),
              ],
            },
          }
        : respostaPadrao(caminho, chave);

    const atividade = (await contaNoProvedor({ chaveDeGestao: "gestao-x" })).activity;

    // Ordenados por custo, maior primeiro.
    expect(atividade?.byModel).toEqual([
      {
        model: "anthropic/claude-x",
        requests: 2,
        promptTokens: 200,
        completionTokens: 20,
        reasoningTokens: 2,
        costMicros: 500_000,
      },
      {
        model: "estudio/gpt-x",
        requests: 4,
        promptTokens: 400,
        completionTokens: 40,
        reasoningTokens: 4,
        costMicros: 19_624,
      },
    ]);
    expect(atividade?.byProvider).toEqual([
      { provider: "Estúdio", requests: 5, costMicros: 518_624 },
      { provider: "Nuvem", requests: 1, costMicros: 1_000 },
    ]);
    const doDia = atividade?.daily.find((d) => d.date === "2026-09-24");
    expect(doDia?.costMicros).toBe(19_624);
    expect(doDia?.requests).toBe(4);

    // Custo convertido por linha, em inteiros: os três totais são o mesmo número.
    const soma = (xs: { costMicros: number }[] | undefined) =>
      (xs ?? []).reduce((t, x) => t + x.costMicros, 0);
    expect(soma(atividade?.daily)).toBe(519_624);
    expect(soma(atividade?.byModel)).toBe(519_624);
    expect(soma(atividade?.byProvider)).toBe(519_624);
  });

  test("a data com hora que o /activity real manda cai no dia certo, e o dia de hoje continua fora", async () => {
    // Formato conferido com a management key real em 2026-09-25: o provedor
    // manda `"AAAA-MM-DD 00:00:00"`, não o `AAAA-MM-DD` da documentação.
    congelarRelogio();
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/activity"
        ? {
            corpo: {
              data: [
                linha("2026-09-22 00:00:00", "estudio/gpt-x", "Estúdio", 0.002, 2),
                linha("2026-08-26 00:00:00", "estudio/gpt-x", "Estúdio", 0.001, 1),
                linha("2026-09-25 00:00:00", "estudio/intruso", "Intruso", 9, 9),
              ],
            },
          }
        : respostaPadrao(caminho, chave);

    const atividade = (await contaNoProvedor({ chaveDeGestao: "gestao-x" })).activity;
    const diario = atividade?.daily ?? [];

    expect(diario).toHaveLength(30);
    expect(diario.find((d) => d.date === "2026-09-22")).toEqual({
      date: "2026-09-22",
      costMicros: 2_000,
      byokMicros: 0,
      requests: 2,
    });
    expect(diario[0]).toEqual({ date: "2026-08-26", costMicros: 1_000, byokMicros: 0, requests: 1 });
    // O dia continua `AAAA-MM-DD` na resposta: a hora do provedor não vaza.
    expect(diario.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(diario.reduce((t, d) => t + d.requests, 0)).toBe(3);
    expect(atividade?.byModel.map((m) => m.model)).toEqual(["estudio/gpt-x"]);
  });

  test("403 em /credits diz que a chave de gerenciamento foi recusada, sem ecoar o provedor", async () => {
    // O provedor costuma pôr a credencial na própria mensagem de recusa.
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/credits"
        ? { status: 403, corpo: { error: { message: `Invalid management key: ${chave}` } } }
        : respostaPadrao(caminho, chave);

    const erro = await erroDe(contaNoProvedor({ chaveDeGestao: "sk-or-v1-gestao-recusada" }));

    expect(erro).not.toBeNull();
    expect(erro?.code).toBe("PROVEDOR_INDISPONIVEL");
    expect(erro?.message).toContain("chave de gerenciamento");
    expect(erro?.message).toContain("/credits");
    // A dica do erro provável: a chave comum colada no lugar da de gestão.
    expect(erro?.message).toContain("management key");
    expect(erro?.message).not.toContain("Invalid");
    expect(erro?.message).not.toContain("gestao-recusada");
  });
});

describe("métricas do provedor", () => {
  test("só vai no corpo o que o meta anuncia e o painel conhece, sem granularidade", async () => {
    congelarRelogio();

    await metricasNoProvedor({ chaveDeGestao: "gestao-x" });

    expect(caminhos()).toEqual(["/api/v1/analytics/meta", "/api/v1/analytics/query"]);
    expect(dublê.corpos).toHaveLength(1);
    const corpo = dublê.corpos[0];
    // Na ordem do painel. `tokens_total` e `usage_cache` o meta não anuncia;
    // `tokens_prompt` o meta anuncia, mas o painel não tem rótulo para ela.
    expect(corpo?.metrics).toEqual([
      "request_count",
      "total_usage",
      "cache_hit_rate",
      "avg_latency",
      "usage_web",
    ]);
    // Uma linha agregada: as taxas saem calculadas pelo provedor sobre a
    // janela, não como média de médias diárias.
    expect(corpo).not.toHaveProperty("granularity");
    expect(corpo?.time_range).toEqual({
      start: "2026-08-26T15:00:00.000Z",
      end: "2026-09-25T15:00:00.000Z",
    });
  });

  test("string numérica vira número, null fica null, e moeda vira µUSD", async () => {
    const metricas = await metricasNoProvedor({ chaveDeGestao: "gestao-x" });

    expect(metricas.managementConfigured).toBe(true);
    expect(metricas.items).toEqual([
      { name: "request_count", format: "number", value: 6 },
      { name: "total_usage", format: "currency", value: 18_624 },
      { name: "cache_hit_rate", format: "percent", value: null },
      { name: "avg_latency", format: "latency", value: 1234.5 },
      // Formato que o código não conhece cai em `number`, em vez de sumir.
      { name: "usage_web", format: "number", value: 0 },
    ]);
  });

  test("o meta fica em cache: a segunda consulta não o pede de novo", async () => {
    await metricasNoProvedor({ chaveDeGestao: "gestao-x" });
    await metricasNoProvedor({ chaveDeGestao: "gestao-x" });

    expect(caminhos()).toEqual([
      "/api/v1/analytics/meta",
      "/api/v1/analytics/query",
      "/api/v1/analytics/query",
    ]);

    esquecerMetaDoProvedor();
    await metricasNoProvedor({ chaveDeGestao: "gestao-x" });
    expect(caminhos().filter((c) => c === "/api/v1/analytics/meta")).toHaveLength(2);
  });

  test("se o meta não anuncia nenhuma métrica do painel, a consulta nem sai", async () => {
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/analytics/meta"
        ? { corpo: { data: { metrics: [{ name: "tokens_prompt", display_format: "number" }] } } }
        : respostaPadrao(caminho, chave);

    const metricas = await metricasNoProvedor({ chaveDeGestao: "gestao-x" });

    expect(metricas.items).toEqual([]);
    expect(metricas.window).not.toBeNull();
    expect(caminhos()).toEqual(["/api/v1/analytics/meta"]);
  });
});

describe("rotas do painel", () => {
  test("as três exigem autenticação", async () => {
    for (const url of ["/ai/openrouter/key", "/ai/openrouter/account", "/ai/openrouter/metrics"]) {
      const resposta = await app.inject({ method: "GET", url });
      expect(resposta.statusCode).toBe(401);
    }
    expect(dublê.recebidas).toEqual([]);
  });

  test("GET /ai/openrouter/key não devolve nenhuma das duas chaves", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/openrouter/key",
      token: dono.token,
      ip: "10.40.0.1",
    });

    expect(status).toBe(200);
    const relatorio = body as OpenRouterKeyReport;
    expect(relatorio.configured).toBe(true);
    expect(relatorio.managementConfigured).toBe(true);
    // O dublê devolveu a chave inteira no rótulo; a redação a tirou.
    expect(relatorio.key?.label).toBeNull();
    const json = JSON.stringify(body);
    expect(json).not.toContain("chave-de-teste");
    expect(json).not.toContain("gestao-de-teste");
    // A chave que a rota de fato usou pode ser a real, se o `.env` tiver uma
    // (`setup.ts` a fixa com `??=`). Comparada como booleano para que uma falha
    // não imprima a chave no terminal.
    const usada = env.OPENROUTER_API_KEY ?? "chave-de-teste";
    expect(json.includes(usada)).toBe(false);
    // A chave comum, e só ela, vai a `/key`.
    expect(dublê.recebidas.map((r) => [r.metodo, r.caminho])).toEqual([["GET", "/api/v1/key"]]);
    expect(dublê.recebidas[0]?.autorizacao === `Bearer ${usada}`).toBe(true);
  });

  test("GET /ai/openrouter/account usa a management key só nos caminhos de leitura, e não a devolve", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/openrouter/account",
      token: dono.token,
      ip: "10.40.0.2",
    });

    expect(status).toBe(200);
    expect((body as OpenRouterAccount).managementConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("gestao-de-teste");
    const ordenadas = [...dublê.recebidas].sort((a, b) => a.caminho.localeCompare(b.caminho));
    expect(ordenadas).toEqual([
      { metodo: "GET", caminho: "/api/v1/activity", autorizacao: "Bearer gestao-de-teste" },
      { metodo: "GET", caminho: "/api/v1/credits", autorizacao: "Bearer gestao-de-teste" },
    ]);
  });

  test("GET /ai/openrouter/metrics só lê: GET no meta e POST de consulta, nada mais", async () => {
    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/openrouter/metrics",
      token: dono.token,
      ip: "10.40.0.3",
    });

    expect(status).toBe(200);
    expect((body as OpenRouterMetrics).items.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("gestao-de-teste");
    expect(dublê.recebidas).toEqual([
      { metodo: "GET", caminho: "/api/v1/analytics/meta", autorizacao: "Bearer gestao-de-teste" },
      { metodo: "POST", caminho: "/api/v1/analytics/query", autorizacao: "Bearer gestao-de-teste" },
    ]);
  });

  test("a recusa da management key chega à tela como 503 sem a chave nem o texto do provedor", async () => {
    dublê.responder = (caminho, chave) =>
      caminho === "/api/v1/credits"
        ? { status: 401, corpo: { error: { message: `Invalid management key: ${chave}` } } }
        : respostaPadrao(caminho, chave);

    const { status, body } = await chamar(app, {
      method: "GET",
      url: "/ai/openrouter/account",
      token: dono.token,
      ip: "10.40.0.4",
    });

    expect(status).toBe(503);
    expect(body).toMatchObject({ error: { code: "PROVEDOR_INDISPONIVEL" } });
    const json = JSON.stringify(body);
    expect(json).toContain("chave de gerenciamento");
    expect(json).not.toContain("gestao-de-teste");
    expect(json).not.toContain("Invalid");
  });
});
