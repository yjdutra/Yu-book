import type { AiModel, AiModelList, ListAiModelsQuery } from "@yu-book/shared";
import { normalizarTitulo } from "@yu-book/shared";
import { pedirDoProvedor } from "./openrouter.service.js";

/**
 * O catálogo de modelos do provedor.
 *
 * Ele **não vai para tabela**: é dado derivado de um endpoint do provedor, que
 * muda sozinho. O que vai para o banco é só o favorito, com a cópia dos campos
 * que a estimativa de custo precisa (A4).
 *
 * Medido em 2026-09-22: **442 modelos, 727 KB**, dos quais 373 sabem chamar
 * ferramenta. Por isso nada do JSON cru atravessa esta função — a tela precisa
 * de sete campos por modelo, e carregar o resto seria pagar 727 KB de memória
 * para descartar 90%.
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
}

interface Catalogo {
  emMs: number;
  modelos: AiModel[];
}

let catalogo: Catalogo | null = null;

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

  const promptMicros = precoEmMicrosPorMilhao(bruto.pricing?.prompt);
  const completionMicros = precoEmMicrosPorMilhao(bruto.pricing?.completion);
  if (promptMicros === null || completionMicros === null) return null;

  const parametros = Array.isArray(bruto.supported_parameters) ? bruto.supported_parameters : [];

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
  };
}

async function buscarDoProvedor(): Promise<AiModel[]> {
  const dados = await pedirDoProvedor<{ data?: unknown }>("/models", {
    orcamentoMs: ORCAMENTO_MS,
    publico: true,
  });
  const brutos = Array.isArray(dados.data) ? (dados.data as ModeloDoProvedor[]) : [];
  return brutos.map(normalizar).filter((m): m is AiModel => m !== null);
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
    if (!alvo) return true;
    /// `normalizarTitulo` do shared, a mesma chave sem acento que o banco usa e
    /// que o `casaTermo` do front usa — não `includes(toLowerCase())`.
    return normalizarTitulo(`${m.name} ${m.id}`).includes(alvo);
  });

  return {
    /// O catálogo sai na ordem do provedor, que é do mais recente para o mais
    /// antigo. Não inventamos ranking de relevância: o filtro já é a relevância.
    items: casaram.slice(0, query.limit),
    /// Quantos casaram o filtro, **antes** do corte — é o que deixa a tela
    /// dizer "30 de 373" em vez de mentir que são 30.
    total: casaram.length,
    fetchedAt: new Date(catalogo.emMs).toISOString(),
    stale,
  };
}

/**
 * Um modelo do catálogo pelo id, reaproveitando o cache.
 *
 * Favoritar precisa da cópia dos campos de preço, e buscar o catálogo inteiro
 * outra vez seria pagar centenas de KB por clique.
 */
export async function acharModelo(id: string): Promise<AiModel | null> {
  const { items } = await listarModelos({ q: id, limit: 100 });
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
