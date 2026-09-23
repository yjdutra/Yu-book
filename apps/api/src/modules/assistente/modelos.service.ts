import type {
  AiModel,
  AiModelIndices,
  AiModelList,
  AiModelSort,
  ListAiModelsQuery,
} from "@yu-book/shared";
import { normalizarTitulo } from "@yu-book/shared";
import { AppError } from "../../lib/errors.js";
import { pedirDoProvedor } from "./openrouter.service.js";

/**
 * O catálogo de modelos do provedor.
 *
 * Ele **não vai para tabela**: é dado derivado de um endpoint do provedor, que
 * muda sozinho. O que vai para o banco é só o favorito, com a cópia dos campos
 * que a estimativa de custo precisa (A4).
 *
 * Medido em 2026-09-23: o provedor publica **455 modelos em 730 KB**, e depois
 * das três exclusões abaixo sobram **348** — dos quais 292 sabem chamar
 * ferramenta e 238 declaram raciocínio. Nada do JSON cru atravessa esta função:
 * a tela precisa de uma dúzia de campos por modelo, e carregar o resto seria
 * pagar 730 KB de memória para descartar quase tudo.
 */

/// O catálogo muda em dias, não em minutos. Uma hora é folgado e barato.
const TTL_MS = 60 * 60 * 1000;

/// O provedor não pagina este endpoint; é uma resposta só, grande.
const ORCAMENTO_MS = 15_000;

interface ModeloDoProvedor {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  reasoning?: unknown;
  alias_target?: unknown;
  knowledge_cutoff?: unknown;
  benchmarks?: { artificial_analysis?: Record<string, unknown> };
}

interface Catalogo {
  emMs: number;
  modelos: AiModel[];
}

let catalogo: Catalogo | null = null;

/**
 * Modelo de lote — a variante `:batch` do provedor.
 *
 * Esta é a **única** definição da regra. Ela vive aqui porque é o catálogo que
 * decide o que existe, e é consumida também pela escolha de modelo por tarefa,
 * que precisa recusar um favorito de lote gravado antes deste filtro existir.
 */
export function ehVarianteDeLote(id: string): boolean {
  return id.endsWith(":batch");
}

/**
 * Modelo que devolve imagem ou áudio, não texto.
 *
 * São 15 dos 455. A tarefa aqui é texto entra, texto sai — pedir formatação a
 * um modelo de imagem falharia de um jeito diferente do lote, e pelo mesmo
 * motivo de fundo: oferecer no catálogo o que a chamada não aceita.
 */
export function ehSaidaDeTexto(saidas: unknown): boolean {
  return Array.isArray(saidas) && saidas.length === 1 && saidas[0] === "text";
}

/**
 * Apelido do tipo `…-latest`, que o provedor repõe para o modelo da vez.
 *
 * São 18, e funcionam. Ficam fora porque o favorito guarda uma **cópia** de
 * preço e de contexto: sob um apelido essa cópia fica errada em silêncio no dia
 * em que o alvo muda, e a estimativa de custo passa a orçar outro modelo.
 * Decisão reversível — voltando, eles precisam de etiqueta própria na tela.
 */
export function ehApelido(id: string, alvo: unknown): boolean {
  return id.startsWith("~") || (alvo !== null && alvo !== undefined);
}

/**
 * Preço chega como **string em USD por token** (`"0.00000435"`), e é guardado
 * como inteiro de µUSD por **milhão** de tokens — 4350000, isto é US$ 4,35 por
 * milhão. Inteiro porque não há `Decimal` no schema, e por milhão porque é a
 * unidade em que preço de modelo é lido e comparado.
 */
function precoEmMicrosPorMilhao(valor: unknown): number | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 1e12);
}

/**
 * Um modelo sem preço legível é **descartado**, não zerado.
 *
 * Zerar pareceria inofensivo e seria o contrário: o preço alimenta a estimativa
 * de custo de A5, e um zero inventado entraria na soma do dia como se a chamada
 * fosse de graça — teto que mente. Hoje a regra não exclui ninguém (conferido
 * contra o catálogo real: zero modelos sem preço), e existe para o dia em que
 * o provedor publicar um.
 */
function normalizar(bruto: ModeloDoProvedor): AiModel | null {
  const { id, name, context_length: contexto } = bruto;
  if (typeof id !== "string" || !id) return null;

  /// Variante de lote não serve para a chamada que fazemos, e o provedor não
  /// diz isso em campo nenhum — medido em 2026-09-23, comparando a entrada
  /// normal com a `:batch`: só `id`, `name` e `pricing` mudam. Chamar uma delas
  /// em `/chat/completions` devolve **404** com "cannot be used with the
  /// chat/completions endpoint". São 71 dos 455 modelos, custam metade do preço
  /// e ficam coladas na variante normal na lista — ou seja, é uma armadilha
  /// atraente. Fora do catálogo, ninguém favorita o que não dá para usar.
  if (ehVarianteDeLote(id)) return null;
  if (!ehSaidaDeTexto(bruto.architecture?.output_modalities)) return null;
  if (ehApelido(id, bruto.alias_target)) return null;

  const promptMicros = precoEmMicrosPorMilhao(bruto.pricing?.prompt);
  const completionMicros = precoEmMicrosPorMilhao(bruto.pricing?.completion);
  if (promptMicros === null || completionMicros === null) return null;

  const parametros = Array.isArray(bruto.supported_parameters) ? bruto.supported_parameters : [];
  const entradas = bruto.architecture?.input_modalities;
  const corte = bruto.knowledge_cutoff;

  return {
    id,
    name: typeof name === "string" && name ? name : id,
    contextLength: typeof contexto === "number" && contexto > 0 ? contexto : 0,
    promptMicros,
    completionMicros,
    /// A bandeira de que as etapas B–D dependem: um modelo que não sabe chamar
    /// ferramenta conversa bem e **não consegue consultar o acervo**.
    supportsTools: parametros.includes("tools"),
    /// Derivado do preço, **não do sufixo `:free` do id**: no catálogo real 24
    /// modelos custam zero e só 21 terminam assim.
    free: promptMicros === 0 && completionMicros === 0,
    /// O provedor declara um objeto quando o modelo raciocina; ausência é não.
    reasoning: bruto.reasoning !== null && typeof bruto.reasoning === "object",
    acceptsImage: Array.isArray(entradas) && entradas.includes("image"),
    indices: indicesDe(bruto),
    knowledgeCutoff: typeof corte === "string" && corte ? corte : null,
  };
}

/**
 * Os três índices de terceiro, ou `null` quando nenhum foi medido.
 *
 * Cobertura medida em 2026-09-23: inteligência 26%, código 37%, agêntico 28%.
 * Um índice faltando volta `null`, nunca zero — zero seria uma nota ruim
 * inventada para um modelo que ninguém mediu.
 */
function indicesDe(bruto: ModeloDoProvedor): AiModelIndices | null {
  const aa = bruto.benchmarks?.artificial_analysis;
  if (!aa) return null;

  const numero = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const indices: AiModelIndices = {
    intelligence: numero(aa["intelligence_index"]),
    coding: numero(aa["coding_index"]),
    agentic: numero(aa["agentic_index"]),
  };

  const algum = indices.intelligence ?? indices.coding ?? indices.agentic;
  return algum === null ? null : indices;
}

async function buscarDoProvedor(): Promise<AiModel[]> {
  const dados = await pedirDoProvedor<{ data?: unknown }>("/models", {
    orcamentoMs: ORCAMENTO_MS,
    publico: true,
  });
  const brutos = Array.isArray(dados.data) ? (dados.data as ModeloDoProvedor[]) : [];
  const modelos = brutos.map(normalizar).filter((m): m is AiModel => m !== null);

  /// As exclusões leem campo aninhado do provedor (`architecture.output_modalities`).
  /// Se essa forma mudar, **toda** entrada vira descarte e o catálogo vazio
  /// seria cacheado por uma hora, aparecendo na tela como "0 de 0" —
  /// indistinguível de filtro apertado. Descartar tudo o que veio não é
  /// catálogo vazio, é forma que não reconhecemos: falha alto, e quem tiver
  /// cache quente fica com ele.
  if (brutos.length > 0 && modelos.length === 0) {
    throw new AppError(
      503,
      "PROVEDOR_INDISPONIVEL",
      "O catálogo do provedor veio numa forma que este servidor não reconhece.",
    );
  }

  return modelos;
}

/**
 * Lista o catálogo, filtrado.
 *
 * Não recebe `userId`, como `saude`: o catálogo é do provedor, igual para todo
 * mundo. A rota continua exigindo autenticação.
 */
export async function listarModelos(query: ListAiModelsQuery): Promise<AiModelList> {
  const agora = Date.now();
  let stale = false;

  if (!catalogo || agora - catalogo.emMs > TTL_MS) {
    try {
      catalogo = { emMs: agora, modelos: await buscarDoProvedor() };
    } catch (erro) {
      /// Com cache quente, provedor fora do ar não derruba a tela de ajustes —
      /// ela mostra o que tinha e **diz que está velho**. Sem cache, o erro sobe.
      if (!catalogo) throw erro;
      stale = true;
    }
  }

  const alvo = normalizarTitulo(query.q ?? "");

  const casaram = catalogo.modelos.filter((m) => {
    if (query.tools === true && !m.supportsTools) return false;
    if (query.tools === false && m.supportsTools) return false;
    if (query.reasoning === true && !m.reasoning) return false;
    if (query.reasoning === false && m.reasoning) return false;
    /// Teto pelo preço de **entrada**: é o que domina a conta ao formatar uma
    /// nota, porque o corpo inteiro entra e só a formatação sai. `0` é o filtro
    /// de gratuitos, e por isso a comparação não pode ser `maxPrice &&`.
    if (query.maxPrice !== undefined && m.promptMicros > query.maxPrice) return false;
    if (!alvo) return true;
    /// `normalizarTitulo` do shared, a mesma chave sem acento que o banco usa e
    /// que o `casaTermo` do front usa — não `includes(toLowerCase())`.
    return normalizarTitulo(`${m.name} ${m.id}`).includes(alvo);
  });

  return {
    /// Ordena **antes** de cortar: senão o corte escolheria os N primeiros da
    /// ordem do provedor e ordenaria só esses, o que faria "mais barato" dizer
    /// "mais barato entre os vinte mais recentes".
    items: ordenar(casaram, query.sort).slice(0, query.limit),
    /// Quantos casaram o filtro, **antes** do corte — é o que deixa a tela
    /// dizer "20 de 292" em vez de mentir que são 20.
    total: casaram.length,
    fetchedAt: new Date(catalogo.emMs).toISOString(),
    stale,
  };
}

/**
 * Ordena o recorte.
 *
 * `relevance` devolve a ordem do provedor, que é do mais recente para o mais
 * antigo — não inventamos ranking próprio, e o filtro já é a relevância.
 *
 * **Quem não tem índice vai para o fim, nunca para o meio.** Tratar ausência
 * como zero enfileiraria um modelo não medido atrás dos piores medidos, o que
 * é uma afirmação que ninguém fez.
 */
function ordenar(modelos: AiModel[], criterio: AiModelSort): AiModel[] {
  if (criterio === "relevance") return modelos;
  const copia = [...modelos];

  if (criterio === "price") return copia.sort((a, b) => a.promptMicros - b.promptMicros);
  if (criterio === "context") return copia.sort((a, b) => b.contextLength - a.contextLength);

  /// Exaustivo de propósito: um critério novo em `AI_MODEL_SORTS` sem caso aqui
  /// **não compila**. Com o ternário aberto, ele ordenaria por agêntico em
  /// silêncio — o front já é coberto, porque `ROTULO_ORDEM` é um `Record` sobre
  /// o mesmo union e cobra o rótulo na hora.
  const campo: keyof AiModelIndices =
    criterio === "intelligence"
      ? "intelligence"
      : criterio === "coding"
        ? "coding"
        : criterio === "agentic"
          ? "agentic"
          : criterioDesconhecido(criterio);

  return copia.sort((a, b) => {
    const va = a.indices?.[campo] ?? null;
    const vb = b.indices?.[campo] ?? null;
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  });
}

function criterioDesconhecido(criterio: never): never {
  throw new Error(`Critério de ordenação sem caso: ${String(criterio)}`);
}

/**
 * Um modelo do catálogo pelo id, reaproveitando o cache.
 *
 * Favoritar precisa da cópia dos campos de preço, e buscar o catálogo inteiro
 * outra vez seria pagar centenas de KB por clique.
 */
export async function acharModelo(id: string): Promise<AiModel | null> {
  const { items } = await listarModelos({ q: id, limit: 100, sort: "relevance" });
  return items.find((m) => m.id === id) ?? null;
}

/**
 * Esquece o catálogo em memória.
 *
 * Existe para o teste poder exercitar a recarga e o caminho de `stale` sem
 * esperar uma hora. Produção nunca chama.
 */
export function esquecerCatalogo(): void {
  catalogo = null;
}
