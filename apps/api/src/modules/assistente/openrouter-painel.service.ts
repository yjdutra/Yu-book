import {
  dolaresParaMicros,
  OPENROUTER_LIMIT_RESETS,
  OPENROUTER_METRIC_FORMATS,
} from "@yu-book/shared";
import type {
  OpenRouterAccount,
  OpenRouterDailyCost,
  OpenRouterKeyInfo,
  OpenRouterKeyReport,
  OpenRouterLimitReset,
  OpenRouterMetric,
  OpenRouterMetricFormat,
  OpenRouterMetrics,
  OpenRouterModelActivity,
  OpenRouterProviderActivity,
} from "@yu-book/shared";
import { env } from "../../env.js";
import { pedirDoProvedor, rotuloPublico, temChave } from "./openrouter.service.js";
import type { OpcoesDoProvedor } from "./openrouter.service.js";

/**
 * Painel do OpenRouter em `/ajustes/openrouter`: o que **o provedor** diz sobre a
 * chave e a conta. Só consulta — nada é gravado, nenhuma inferência, e o teto
 * diário não entra, porque nenhuma destas chamadas é cobrada.
 *
 * Nenhuma função recebe `userId`, como `saude()`: o dado é do servidor, igual
 * para todo mundo. As rotas continuam exigindo autenticação.
 *
 * **Duas chaves.** A de inferência (`OPENROUTER_API_KEY`) responde `GET /key`. A
 * de gerenciamento (`OPENROUTER_MANAGEMENT_KEY`) responde o resto — e no
 * provedor ela **cria e apaga chaves**. Aqui ela só lê, e só pelos caminhos de
 * `CAMINHOS_DE_GESTAO`: `pedirComGestao` não aceita outro, e o compilador barra
 * um `/keys` escrito por engano. Nenhuma das duas chaves entra numa resposta.
 */

/// O mesmo orçamento de `saude()`: leitura de metadado, não vale esperar 8 s.
const ORCAMENTO_CHAVE_MS = 5_000;

/// O meta das métricas muda quando o provedor lança métrica, não a cada visita.
const TTL_META_MS = 60 * 60 * 1000;

/// A janela que o provedor usa em `/activity`, e a que o painel pede às métricas.
const DIAS_DA_JANELA = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Leitura, e só leitura. `/analytics/query` é `POST` porque o filtro vai no
 * corpo, mas é consulta — não muda nada no provedor.
 */
const CAMINHOS_DE_GESTAO = {
  creditos: { caminho: "/credits", metodo: "GET" },
  atividade: { caminho: "/activity", metodo: "GET" },
  meta: { caminho: "/analytics/meta", metodo: "GET" },
  consulta: { caminho: "/analytics/query", metodo: "POST" },
} as const;
type LeituraDeGestao = keyof typeof CAMINHOS_DE_GESTAO;

/**
 * As métricas do painel, na ordem da tela. Fixas: o meta do provedor lista
 * dezenas, e a tela tem rótulo em português só para estas.
 */
const METRICAS_DO_PAINEL = [
  "request_count",
  "total_usage",
  "tokens_total",
  "cache_hit_rate",
  "avg_latency",
  "usage_web",
  "usage_cache",
] as const;

/**
 * Injeção para teste, no padrão de `saude()`: objeto com checagem de `in`, que
 * distingue "não informei" (usa o ambiente) de "informei que não há". Parâmetro
 * com valor padrão cairia de volta no ambiente com `undefined`, e o teste de
 * "sem chave" passaria testando outra coisa.
 */
export interface OpcoesDoPainel {
  chave?: string | undefined;
  chaveDeGestao?: string | undefined;
}

function chaveDeInferencia(opcoes: OpcoesDoPainel): string | undefined {
  return "chave" in opcoes ? opcoes.chave : env.OPENROUTER_API_KEY;
}

function chaveDeGestao(opcoes: OpcoesDoPainel): string | undefined {
  return "chaveDeGestao" in opcoes ? opcoes.chaveDeGestao : env.OPENROUTER_MANAGEMENT_KEY;
}

/**
 * Uma leitura com a chave de gerenciamento.
 *
 * A dica da recusa existe porque o erro mais provável é colar a chave comum no
 * lugar dela: o provedor responde 401/403, e "recusou a chave configurada"
 * mandaria conferir a chave errada. O detalhe do provedor continua fora desse
 * ramo (`abrirNoProvedor`) — é onde ele ecoa a credencial.
 */
function pedirComGestao<T>(
  leitura: LeituraDeGestao,
  chave: string,
  extra: Pick<OpcoesDoProvedor, "corpo"> = {},
): Promise<T> {
  const { caminho, metodo } = CAMINHOS_DE_GESTAO[leitura];
  return pedirDoProvedor<T>(caminho, {
    metodo,
    chave,
    nomeDaChave: "de gerenciamento",
    dicaSeRecusada: "Confira se OPENROUTER_MANAGEMENT_KEY é uma management key.",
    ...extra,
  });
}

/// Número finito, ou `null`. O provedor manda número, string numérica
/// (`"request_count": "6"` no cookbook das métricas) ou `null`.
function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/// Dólares do provedor em µUSD. Campo ausente ou estranho vira 0, nunca `NaN`.
function micros(v: unknown): number {
  const n = numero(v);
  return n === null ? 0 : dolaresParaMicros(n);
}

/// Como `micros`, mas a ausência significa algo — "sem teto" — e fica `null`.
function microsOuNulo(v: unknown): number | null {
  const n = numero(v);
  return n === null ? null : dolaresParaMicros(n);
}

function inteiro(v: unknown): number {
  const n = numero(v);
  return n === null ? 0 : Math.round(n);
}

function instanteOuNulo(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const data = new Date(v);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function ehLimitReset(v: unknown): v is OpenRouterLimitReset {
  return typeof v === "string" && (OPENROUTER_LIMIT_RESETS as readonly string[]).includes(v);
}

function ehFormato(v: unknown): v is OpenRouterMetricFormat {
  return typeof v === "string" && (OPENROUTER_METRIC_FORMATS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- GET /key

interface ChaveDoProvedor {
  label?: unknown;
  usage?: unknown;
  usage_daily?: unknown;
  usage_weekly?: unknown;
  usage_monthly?: unknown;
  byok_usage?: unknown;
  byok_usage_monthly?: unknown;
  limit?: unknown;
  limit_remaining?: unknown;
  limit_reset?: unknown;
  include_byok_in_limit?: unknown;
  is_free_tier?: unknown;
  free_model_daily_requests?: { used?: unknown; limit?: unknown; remaining?: unknown } | null;
  expires_at?: unknown;
}

/**
 * Campo a campo, e só os que a tela usa. `creator_user_id`, `organization_id`,
 * `workspace_id` e o `rate_limit` (deprecated no provedor) ficam de fora de
 * propósito: identificador de conta não tem o que fazer no navegador.
 */
function paraChave(dados: ChaveDoProvedor): OpenRouterKeyInfo {
  const gratis = dados.free_model_daily_requests;
  return {
    label: rotuloPublico(dados.label),
    usageMicros: micros(dados.usage),
    usageDailyMicros: micros(dados.usage_daily),
    usageWeeklyMicros: micros(dados.usage_weekly),
    usageMonthlyMicros: micros(dados.usage_monthly),
    byokUsageMicros: micros(dados.byok_usage),
    byokUsageMonthlyMicros: micros(dados.byok_usage_monthly),
    limitMicros: microsOuNulo(dados.limit),
    limitRemainingMicros: microsOuNulo(dados.limit_remaining),
    limitReset: ehLimitReset(dados.limit_reset) ? dados.limit_reset : null,
    includeByokInLimit: dados.include_byok_in_limit === true,
    isFreeTier: dados.is_free_tier === true,
    freeModelRequests:
      gratis && typeof gratis === "object"
        ? {
            used: inteiro(gratis.used),
            limit: inteiro(gratis.limit),
            remaining: inteiro(gratis.remaining),
          }
        : null,
    expiresAt: instanteOuNulo(dados.expires_at),
  };
}

/**
 * A chave de inferência vista pelo provedor: gasto, teto e cota gratuita.
 *
 * Ao contrário de `saude()`, o erro do provedor **sobe**: aqui não há "fora do
 * ar" para desenhar, e o bloco da tela mostra a mensagem.
 */
export async function chaveAtual(opcoes: OpcoesDoPainel = {}): Promise<OpenRouterKeyReport> {
  const chave = chaveDeInferencia(opcoes);
  const managementConfigured = temChave(chaveDeGestao(opcoes));
  const checkedAt = new Date().toISOString();

  /// Sem chave não há o que perguntar, e nenhuma conexão é aberta (CA-02).
  if (!temChave(chave)) {
    return { configured: false, managementConfigured, key: null, checkedAt };
  }

  const resposta = await pedirDoProvedor<{ data?: ChaveDoProvedor }>("/key", {
    orcamentoMs: ORCAMENTO_CHAVE_MS,
    chave,
  });
  return { configured: true, managementConfigured, key: paraChave(resposta.data ?? {}), checkedAt };
}

// ------------------------------------------------- GET /credits, /activity

interface LinhaDeAtividade {
  date?: unknown;
  model?: unknown;
  model_permaslug?: unknown;
  provider_name?: unknown;
  requests?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  reasoning_tokens?: unknown;
  usage?: unknown;
  byok_usage_inference?: unknown;
}

function diaUtc(instanteMs: number): string {
  return new Date(instanteMs).toISOString().slice(0, 10);
}

function texto(v: unknown, reserva: string): string {
  return typeof v === "string" && v !== "" ? v : reserva;
}

/**
 * Agrega o `/activity` — uma linha por dia, modelo e endpoint — nos três cortes
 * da tela.
 *
 * A janela é D-30 a D-1 em UTC: o provedor só entrega dia completo, e o de hoje
 * aparece amanhã. Linha fora da janela fica fora **dos três** cortes, para o
 * total por dia e o total por modelo baterem. O custo é convertido por linha,
 * em µUSD inteiros, pelo mesmo motivo: somar inteiros não diverge entre cortes.
 */
function agregarAtividade(
  linhas: LinhaDeAtividade[],
  agoraMs: number,
): NonNullable<OpenRouterAccount["activity"]> {
  const hojeMs = Date.parse(`${diaUtc(agoraMs)}T00:00:00.000Z`);
  const porDia = new Map<string, OpenRouterDailyCost>();
  for (let i = DIAS_DA_JANELA; i >= 1; i--) {
    const date = diaUtc(hojeMs - i * DIA_MS);
    porDia.set(date, { date, costMicros: 0, byokMicros: 0, requests: 0 });
  }

  const porModelo = new Map<string, OpenRouterModelActivity>();
  const porProvedor = new Map<string, OpenRouterProviderActivity>();

  for (const linha of linhas) {
    /// Dia UTC do próprio provedor: fatiar é seguro aqui, não é prazo local.
    const dia = porDia.get(typeof linha.date === "string" ? linha.date.slice(0, 10) : "");
    if (!dia) continue;

    const custo = micros(linha.usage);
    const requisicoes = inteiro(linha.requests);
    dia.costMicros += custo;
    dia.byokMicros += micros(linha.byok_usage_inference);
    dia.requests += requisicoes;

    const model = texto(linha.model, texto(linha.model_permaslug, "desconhecido"));
    const doModelo = porModelo.get(model) ?? {
      model,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      costMicros: 0,
    };
    doModelo.requests += requisicoes;
    doModelo.promptTokens += inteiro(linha.prompt_tokens);
    doModelo.completionTokens += inteiro(linha.completion_tokens);
    doModelo.reasoningTokens += inteiro(linha.reasoning_tokens);
    doModelo.costMicros += custo;
    porModelo.set(model, doModelo);

    const provider = texto(linha.provider_name, "desconhecido");
    const doProvedor = porProvedor.get(provider) ?? { provider, requests: 0, costMicros: 0 };
    doProvedor.requests += requisicoes;
    doProvedor.costMicros += custo;
    porProvedor.set(provider, doProvedor);
  }

  const porCusto = <T extends { costMicros: number; requests: number }>(a: T, b: T) =>
    b.costMicros - a.costMicros || b.requests - a.requests;

  const daily = [...porDia.values()];
  return {
    from: daily[0]?.date ?? diaUtc(hojeMs - DIAS_DA_JANELA * DIA_MS),
    to: daily[daily.length - 1]?.date ?? diaUtc(hojeMs - DIA_MS),
    daily,
    byModel: [...porModelo.values()].sort(porCusto),
    byProvider: [...porProvedor.values()].sort(porCusto),
  };
}

/**
 * Saldo e histórico de 30 dias da conta. Sem management key, nenhuma conexão:
 * a tela mostra o aviso de como configurá-la.
 */
export async function contaNoProvedor(opcoes: OpcoesDoPainel = {}): Promise<OpenRouterAccount> {
  const chave = chaveDeGestao(opcoes);
  const checkedAt = new Date().toISOString();
  if (!chave) {
    return { managementConfigured: false, credits: null, activity: null, checkedAt };
  }

  const [creditos, atividade] = await Promise.all([
    pedirComGestao<{ data?: { total_credits?: unknown; total_usage?: unknown } }>(
      "creditos",
      chave,
    ),
    pedirComGestao<{ data?: unknown }>("atividade", chave),
  ]);

  /// Subtração depois da conversão: em µUSD inteiros, sem resto de ponto flutuante.
  const purchasedMicros = micros(creditos.data?.total_credits);
  const usedMicros = micros(creditos.data?.total_usage);
  const linhas = Array.isArray(atividade.data) ? (atividade.data as LinhaDeAtividade[]) : [];

  return {
    managementConfigured: true,
    credits: { purchasedMicros, usedMicros, balanceMicros: purchasedMicros - usedMicros },
    activity: agregarAtividade(linhas, Date.now()),
    checkedAt,
  };
}

// --------------------------------------- GET /analytics/meta, POST /query

interface MetaDoProvedor {
  emMs: number;
  formatos: Map<string, OpenRouterMetricFormat>;
}

let meta: MetaDoProvedor | null = null;

async function buscarMeta(chave: string): Promise<Map<string, OpenRouterMetricFormat>> {
  const resposta = await pedirComGestao<{ data?: { metrics?: unknown } }>("meta", chave);
  const formatos = new Map<string, OpenRouterMetricFormat>();
  const metricas = resposta.data?.metrics;
  if (!Array.isArray(metricas)) return formatos;
  for (const item of metricas as { name?: unknown; display_format?: unknown }[]) {
    if (typeof item?.name !== "string") continue;
    /// Formato novo que o provedor lance cai em `number`: a tela mostra o valor
    /// cru em vez de perder a métrica.
    formatos.set(item.name, ehFormato(item.display_format) ? item.display_format : "number");
  }
  return formatos;
}

/// Mesmo desenho de `catalogo` em `modelos.service.ts`: com cache, provedor fora
/// do ar não derruba o meta; sem cache, o erro sobe.
async function formatosDoProvedor(chave: string): Promise<Map<string, OpenRouterMetricFormat>> {
  const agora = Date.now();
  if (!meta || agora - meta.emMs > TTL_META_MS) {
    try {
      meta = { emMs: agora, formatos: await buscarMeta(chave) };
    } catch (erro) {
      if (!meta) throw erro;
    }
  }
  return meta.formatos;
}

/**
 * Esquece o meta em memória. Existe para o teste trocar o que o dublê anuncia
 * sem esperar uma hora. Produção nunca chama.
 */
export function esquecerMetaDoProvedor(): void {
  meta = null;
}

/**
 * As métricas do painel nos últimos 30 dias, até agora.
 *
 * Só se pede o que o meta anuncia: métrica que o provedor aposentou faria a
 * consulta inteira falhar. O formato de cada uma vem do `display_format` dele.
 *
 * **Sem `granularity`**: a resposta é uma linha agregada, e as taxas
 * (`cache_hit_rate`, `avg_latency`) vêm calculadas pelo provedor sobre a janela
 * inteira, em vez de tiradas aqui como média de médias diárias. Pelo mesmo
 * motivo, `truncated` e `warnings` são ignorados: numa linha só não há o que
 * truncar.
 */
export async function metricasNoProvedor(
  opcoes: OpcoesDoPainel = {},
): Promise<OpenRouterMetrics> {
  const chave = chaveDeGestao(opcoes);
  const agora = new Date();
  const checkedAt = agora.toISOString();
  if (!chave) {
    return { managementConfigured: false, window: null, items: [], checkedAt };
  }

  const formatos = await formatosDoProvedor(chave);
  const pedidas = METRICAS_DO_PAINEL.filter((nome) => formatos.has(nome));
  /// `toISOString()` já leva segundos, que é o que o provedor exige.
  const window = {
    from: new Date(agora.getTime() - DIAS_DA_JANELA * DIA_MS).toISOString(),
    to: checkedAt,
  };
  if (pedidas.length === 0) {
    return { managementConfigured: true, window, items: [], checkedAt };
  }

  const resposta = await pedirComGestao<{ data?: { data?: unknown } }>("consulta", chave, {
    corpo: { metrics: pedidas, time_range: { start: window.from, end: window.to } },
  });
  const linhas = resposta.data?.data;
  const linha: Record<string, unknown> =
    Array.isArray(linhas) && linhas[0] && typeof linhas[0] === "object"
      ? (linhas[0] as Record<string, unknown>)
      : {};

  const items = pedidas.map((name): OpenRouterMetric => {
    const format = formatos.get(name) ?? "number";
    const bruto = numero(linha[name]);
    const value = bruto !== null && format === "currency" ? dolaresParaMicros(bruto) : bruto;
    return { name, format, value };
  });

  return { managementConfigured: true, window, items, checkedAt };
}
