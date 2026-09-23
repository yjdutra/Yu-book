import { z } from "zod";
/// Os enums espelhados do Prisma moram todos em `enums.ts`.
import type { AiCostSource, AiTask } from "./enums.js";

/**
 * Contrato da frente de IA — Fase 5 do roteiro, detalhada em
 * `docs/prd-ia-no-yu-book.md`.
 *
 * O provedor é um só: OpenRouter. O Ollama saiu do escopo porque a API roda na
 * Railway, sem GPU, e um recurso apoiado em modelo local não existiria em
 * produção, que é onde o app é usado. A consequência fica escrita aqui e não só
 * no PRD: **o corpo da nota sai da máquina em toda tarefa de IA**.
 */

/// Corpo máximo que vai para o modelo. **Não** é o `MAX_CONTEUDO` de 1 MB da
/// nota: mandar 1 MB para um modelo é dinheiro queimado antes de qualquer
/// resposta, e estoura o contexto da maioria deles.
export const MAX_CONTEUDO_IA = 60_000;

/// Teto diário padrão, em µUSD. 200000 = US$ 0,20.
export const TETO_DIARIO_PADRAO_MICROS = 200_000;

/// Fuso padrão da janela do teto. A API roda em UTC na Railway; o operador não.
export const FUSO_PADRAO = "America/Sao_Paulo";

/**
 * O dia **do usuário**, `AAAA-MM-DD`, que define a janela do teto diário.
 *
 * Hoje só o servidor a chama, e é de propósito: ele grava `ai_usage.local_day`
 * e devolve o dia pronto, então o front nunca recalcula — sem segunda
 * implementação não há espelho para divergir. Se um dia o front precisar do
 * dia local, é esta função que ele usa, nunca uma cópia.
 *
 * Não é `.slice(0, 10)` do ISO nem `getDate()` do processo. A API roda em UTC e
 * o operador vive em UTC−3: das 21h à meia-noite o servidor já está no dia
 * seguinte, e o teto zeraria três horas cedo todo dia. `en-CA` já devolve
 * `AAAA-MM-DD`, e o `timeZone` resolve horário de verão sem tabela nossa.
 */
export function diaLocal(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/**
 * µUSD → dólares, e a volta.
 *
 * O banco guarda `Int` em milionésimo de dólar porque não há `Decimal` no
 * schema; a tela mostra e recebe dólares. Escrita duas vezes, a conversão vira
 * um teto de US$ 0,20 que o servidor lê como US$ 200.000.
 */
export function microsParaDolares(micros: number): number {
  return micros / 1_000_000;
}

export function dolaresParaMicros(dolares: number): number {
  return Math.round(dolares * 1_000_000);
}

/// Um fuso que o `Intl` desta plataforma reconhece. `try/catch` em vez de
/// `Intl.supportedValuesOf`, que não existe em todo alvo que consome o pacote.
export function ehFusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/// Teto máximo aceito no ajuste: US$ 100 por dia. Guarda contra dedo escorregado.
export const TETO_DIARIO_MAXIMO_MICROS = 100_000_000;

export const aiSettingsPatchSchema = z.object({
  dailyCapMicros: z
    .number()
    .int()
    .min(0)
    .max(TETO_DIARIO_MAXIMO_MICROS, "Teto diário acima do limite aceito")
    .optional(),
  timezone: z.string().refine(ehFusoValido, "Fuso horário desconhecido").optional(),
});

/// O id do modelo vai no corpo, não no caminho: o slug do OpenRouter tem barra
/// (`anthropic/claude-sonnet-4`) e estouraria o roteamento.
export const aiFavoriteInputSchema = z.object({
  modelId: z.string().trim().min(1, "Informe o modelo").max(200),
});

export const aiTaskModelSchema = z.object({
  modelId: z.string().trim().min(1).max(200).nullable(),
});

/**
 * Como ordenar o catálogo.
 *
 * Os três últimos são índices de terceiro, presentes em **menos de 40%** dos
 * modelos — por isso ordenam, mas nunca filtram: filtrar por índice esconderia
 * dois terços do catálogo, e ausência de medição não é defeito do modelo.
 */
export const AI_MODEL_SORTS = [
  "relevance",
  "price",
  "context",
  "intelligence",
  "coding",
  "agentic",
] as const;
export type AiModelSort = (typeof AI_MODEL_SORTS)[number];

/**
 * Faixas de preço da tela, em µUSD por milhão de tokens de entrada.
 *
 * Saem da distribuição real, medida em 2026-09-23 sobre os **348** modelos que
 * sobram depois das exclusões: 22 gratuitos, 184 até US$ 0,50, 99 entre 0,50 e
 * 2, e 43 acima — mediana em US$ 0,32/M. Não são números redondos escolhidos no
 * olho, e somam 348 de propósito: contagem que não fecha envelhece em silêncio.
 */
export const FAIXAS_DE_PRECO_MICROS = [0, 500_000, 2_000_000] as const;

export const listAiModelsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  /// Teto de preço de **entrada**, em µUSD por milhão. `0` quer dizer gratuito.
  maxPrice: z.coerce.number().int().min(0).optional(),
  reasoning: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sort: z.enum(AI_MODEL_SORTS).default("relevance"),
  /// `z.coerce.boolean()` transformaria a string "false" em `true`. Mesma forma
  /// de `ALLOW_SIGNUP` em `apps/api/src/env.ts`.
  tools: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const formatNoteSchema = z.object({
  contentMd: z
    .string()
    .max(MAX_CONTEUDO_IA, `O corpo passa de ${MAX_CONTEUDO_IA} caracteres`),
});

export type AiSettingsPatch = z.input<typeof aiSettingsPatchSchema>;
/// `z.infer`, e não `z.input`: é a forma **depois** do parse, que é o que o
/// service recebe — mesma escolha de `ListNotesQuery`. Com `z.input`, `tools`
/// ainda seria a string do query string e `limit` não teria o padrão aplicado.
export type ListAiModelsQuery = z.infer<typeof listAiModelsQuerySchema>;

/// Preço em µUSD por **1 milhão** de tokens — o provedor entrega USD por token
/// como string decimal, e guardar por milhão mantém tudo em inteiro.
/**
 * Índices de qualidade de terceiro, quando o provedor os informa.
 *
 * Cada um é `null` quando não há medição — e `null` **não é zero**: quer dizer
 * "não medido", e é por isso que a tela não desenha etiqueta nenhuma nesse caso.
 */
export interface AiModelIndices {
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
}

export interface AiModel {
  id: string;
  name: string;
  contextLength: number;
  promptMicros: number;
  completionMicros: number;
  /// `supported_parameters` inclui "tools". As etapas B–D dependem disto, e é
  /// por isso que a bandeira é capturada agora, não quando o chat chegar.
  supportsTools: boolean;
  free: boolean;
  /// O modelo declara raciocínio. Pesa no custo: pensar gasta tokens de saída.
  reasoning: boolean;
  acceptsImage: boolean;
  /// `null` quando o provedor não informou nenhum dos três.
  indices: AiModelIndices | null;
  /// `AAAA-MM-DD` de até quando o modelo foi treinado, quando informado.
  knowledgeCutoff: string | null;
}

export interface AiModelList {
  items: AiModel[];
  total: number;
  fetchedAt: string;
  /// O catálogo veio de cache porque o provedor não respondeu agora.
  stale: boolean;
}

/**
 * Favorito carrega uma **cópia** do catálogo: a estimativa de custo não pode
 * buscar o catálogo inteiro dentro da requisição, e a tela precisa listar
 * favoritos com o provedor fora do ar.
 *
 * Os campos são declarados um a um, e **não** por `extends AiModel`, porque
 * eles dizem exatamente o que está gravado no banco. O que ficou de fora ficou
 * de propósito: índices são medição de terceiro que muda com o tempo, e
 * congelar uma nota velha num favorito seria desinformar — eles existem para
 * **escolher** um modelo no catálogo, não para descrever o já escolhido.
 */
export interface AiFavorite {
  favoriteId: string;
  snapshotAt: string;
  id: string;
  name: string;
  contextLength: number;
  promptMicros: number;
  completionMicros: number;
  supportsTools: boolean;
  free: boolean;
}

export interface AiUsageSummary {
  localDay: string;
  spentMicros: number;
  /// Chamadas de hoje que voltaram sem custo nem token. Aparece na tela quando
  /// é maior que zero: chamada de custo zero não move o teto, e um provedor que
  /// parasse de informar tornaria o teto decorativo em silêncio.
  callsWithoutCostToday: number;
}

export interface AiSettings {
  dailyCapMicros: number;
  timezone: string;
  usage: AiUsageSummary;
  favorites: AiFavorite[];
  taskModels: Partial<Record<AiTask, string>>;
}

export interface AiHealth {
  provider: "openrouter";
  /// Existe chave no ambiente do servidor.
  configured: boolean;
  /// O provedor respondeu. Consultado **sem** executar inferência (RF-08).
  reachable: boolean;
  label: string | null;
  checkedAt: string;
}

export interface AiCallUsage {
  modelId: string;
  modelUsed: string | null;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  costSource: AiCostSource;
}

export interface FormatNoteResult {
  contentMd: string;
  usage: AiCallUsage;
}
