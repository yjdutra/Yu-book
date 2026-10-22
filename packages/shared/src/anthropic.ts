import type { AiTask } from "./enums.js";
import type { PeriodoDeUso } from "./ia.js";

/**
 * Preços da API da Anthropic, para o custo das chamadas feitas direto nela.
 *
 * O OpenRouter devolve `usage.cost` em dólares; a Anthropic devolve **só
 * tokens**. O custo dela é sempre o degrau `estimado` do INV-48, calculado
 * por esta tabela — e é ela também que decide o catálogo: modelo que a API
 * lista e esta tabela não conhece fica de fora, porque sem preço o teto diário
 * mentiria (a mesma regra de `normalizar` em `modelos.service.ts`).
 *
 * **Copiada da página oficial de preços em 2026-10-21** (`platform.claude.com/
 * docs/en/about-claude/pricing`). Ninguém a confere sozinho: preço novo, ou
 * modelo novo, é edição à mão aqui. Inteiros em µUSD por **milhão** de tokens,
 * como `AiModel`.
 *
 * - `cacheWriteMicros` é a escrita de cache de **5 minutos** (1,25× a entrada),
 *   a única que o Yu-book pede.
 * - `cacheReadMicros` não é sempre 0,1× a entrada: no Fable 5.1 é 0,025×, no
 *   Opus 5.5 e no Sonnet 5.5, 0,05×. Por isso é coluna, não multiplicador.
 * - `longo`: o Haiku 5.5 cobra outra tabela inteira quando o prompt passa de
 *   100 mil tokens — contando entrada, leitura e escrita de cache.
 */
export interface PrecoAnthropic {
  promptMicros: number;
  completionMicros: number;
  cacheWriteMicros: number;
  cacheReadMicros: number;
  longo?: {
    acimaDeTokens: number;
    promptMicros: number;
    completionMicros: number;
    cacheWriteMicros: number;
    cacheReadMicros: number;
  };
}

export const PRECOS_ANTHROPIC: Readonly<Record<string, PrecoAnthropic>> = {
  "claude-fable-5-1": {
    promptMicros: 10_000_000,
    completionMicros: 50_000_000,
    cacheWriteMicros: 12_500_000,
    cacheReadMicros: 250_000,
  },
  "claude-fable-5": {
    promptMicros: 10_000_000,
    completionMicros: 50_000_000,
    cacheWriteMicros: 12_500_000,
    cacheReadMicros: 1_000_000,
  },
  "claude-opus-5-5": {
    promptMicros: 4_000_000,
    completionMicros: 20_000_000,
    cacheWriteMicros: 5_000_000,
    cacheReadMicros: 200_000,
  },
  "claude-opus-5": {
    promptMicros: 5_000_000,
    completionMicros: 25_000_000,
    cacheWriteMicros: 6_250_000,
    cacheReadMicros: 500_000,
  },
  "claude-opus-4-8": {
    promptMicros: 5_000_000,
    completionMicros: 25_000_000,
    cacheWriteMicros: 6_250_000,
    cacheReadMicros: 500_000,
  },
  "claude-opus-4-7": {
    promptMicros: 5_000_000,
    completionMicros: 25_000_000,
    cacheWriteMicros: 6_250_000,
    cacheReadMicros: 500_000,
  },
  "claude-opus-4-6": {
    promptMicros: 5_000_000,
    completionMicros: 25_000_000,
    cacheWriteMicros: 6_250_000,
    cacheReadMicros: 500_000,
  },
  "claude-sonnet-5-5": {
    promptMicros: 2_000_000,
    completionMicros: 10_000_000,
    cacheWriteMicros: 2_500_000,
    cacheReadMicros: 100_000,
  },
  "claude-sonnet-5": {
    promptMicros: 2_000_000,
    completionMicros: 10_000_000,
    cacheWriteMicros: 2_500_000,
    cacheReadMicros: 200_000,
  },
  "claude-sonnet-4-6": {
    promptMicros: 3_000_000,
    completionMicros: 15_000_000,
    cacheWriteMicros: 3_750_000,
    cacheReadMicros: 300_000,
  },
  "claude-haiku-5-5": {
    promptMicros: 100_000,
    completionMicros: 500_000,
    cacheWriteMicros: 125_000,
    cacheReadMicros: 10_000,
    longo: {
      acimaDeTokens: 100_000,
      promptMicros: 500_000,
      completionMicros: 2_500_000,
      cacheWriteMicros: 625_000,
      cacheReadMicros: 50_000,
    },
  },
  "claude-haiku-4-5": {
    promptMicros: 1_000_000,
    completionMicros: 5_000_000,
    cacheWriteMicros: 1_250_000,
    cacheReadMicros: 100_000,
  },
};

/// A busca na web da Anthropic: US$ 10 por mil buscas, além dos tokens dos
/// resultados, que entram como entrada. Busca que falha não é cobrada.
export const CUSTO_BUSCA_ANTHROPIC_MICROS = 10_000;

/** O preço de um modelo da Anthropic, ou `undefined` quando a tabela não o conhece. */
export function precoAnthropic(modelId: string): PrecoAnthropic | undefined {
  return PRECOS_ANTHROPIC[modelId];
}

export interface UsoAnthropic {
  /// O restante sem cache: o `input_tokens` da resposta.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/**
 * O custo de uma chamada, em µUSD, arredondado para cima. A faixa longa do
 * Haiku 5.5 é decidida pelo prompt inteiro — entrada mais cache —, como a
 * Anthropic cobra.
 */
export function custoAnthropicMicros(preco: PrecoAnthropic, uso: UsoAnthropic): number {
  const prompt = uso.inputTokens + uso.cacheReadTokens + uso.cacheWriteTokens;
  const faixa = preco.longo && prompt > preco.longo.acimaDeTokens ? preco.longo : preco;
  const porMilhao = (tokens: number, micros: number) => (tokens * micros) / 1_000_000;
  return Math.ceil(
    porMilhao(uso.inputTokens, faixa.promptMicros) +
      porMilhao(uso.outputTokens, faixa.completionMicros) +
      porMilhao(uso.cacheReadTokens, faixa.cacheReadMicros) +
      porMilhao(uso.cacheWriteTokens, faixa.cacheWriteMicros) +
      uso.webSearches * CUSTO_BUSCA_ANTHROPIC_MICROS,
  );
}

/**
 * A tela de custo do Claude (`/ajustes/claude`): o que o Yu-book gravou em
 * `ai_usage` das chamadas à Anthropic. Só o banco — a Admin API, que daria o
 * custo segundo a própria Anthropic, não existe para contas individuais do
 * Console, e é numa delas que caem os créditos do plano.
 *
 * Dinheiro em µUSD inteiros; dia no fuso do usuário, por `localDay` (INV-50).
 */
export interface ClaudeUsageTotals {
  costMicros: number;
  calls: number;
  failedCalls: number;
  /// Entrada **sem** cache, como a Anthropic informa.
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /// Quanto a leitura de cache poupou contra pagar os mesmos tokens como
  /// entrada, pela tabela de preços. Já descontado o que a escrita custou a mais.
  cacheSavingsMicros: number;
  /// Fração do prompt servida pelo cache, de 0 a 1; `null` sem prompt nenhum.
  cacheHitRate: number | null;
}

export interface ClaudeUsageByModel {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicros: number;
}

export interface ClaudeUsageReport {
  /// Existe `ANTHROPIC_API_KEY` no servidor.
  configured: boolean;
  days: PeriodoDeUso;
  timezone: string;
  from: string;
  to: string;
  totals: ClaudeUsageTotals;
  previousCostMicros: number;
  /// O mês civil corrente, no fuso do usuário — a janela dos créditos mensais.
  month: { from: string; costMicros: number; calls: number };
  today: { costMicros: number; calls: number };
  /// O que o usuário informou em `/ajustes/claude`, ou `null`.
  monthlyCreditMicros: number | null;
  daily: { localDay: string; costMicros: number; calls: number; failedCalls: number }[];
  byModel: ClaudeUsageByModel[];
  byTask: { task: AiTask; calls: number; costMicros: number }[];
  /// Chamadas recusadas por crédito acabado **ou** limite de taxa: as duas
  /// viram `COTA_EXCEDIDA` (`traduzirErroAnthropic`), e a lista de códigos de
  /// `errors.ts` é fechada — separar pediria código novo nos três fronts.
  creditErrors: number;
  /// Recusas do próprio modelo (`RECUSA_DO_MODELO`), que custaram e não renderam.
  refusals: number;
}
