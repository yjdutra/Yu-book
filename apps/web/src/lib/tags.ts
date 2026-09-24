import type { ColumnDetail } from "@yu-book/shared";
import { normalizarTitulo } from "@yu-book/shared";

/**
 * Etiquetas do kanban, do lado do front.
 *
 * As três funções daqui servem ao seletor de tags do card (RF-03) **e** à busca
 * do cartão de tags do painel lateral (RF-13). É de propósito: são o mesmo gesto
 * — filtrar uma lista de etiquetas por texto —, e duas implementações
 * divergiriam em detalhes que ninguém compara lado a lado.
 *
 * A normalização em si (`normalizarTag`) mora em `packages/shared`, porque a
 * API também precisa dela. O que está aqui é só leitura.
 */

/**
 * Casamento por trecho, sem acento e sem caixa: `progr` acha `programação`.
 *
 * `normalizarTitulo` é a mesma chave que o banco usa via `immutable_unaccent` —
 * usar outra faria a busca do painel lateral discordar do que o servidor
 * considera "o mesmo texto".
 */
export function casaTermo(texto: string, termo: string): boolean {
  const alvo = normalizarTitulo(termo);
  if (!alvo) return true;
  return normalizarTitulo(texto).includes(alvo);
}

export interface TagDoBoard {
  nome: string;
  quantidade: number;
}

/**
 * Catálogo de tags de um board (RN-04), derivado dos cards que já estão em
 * memória — o `GET /boards/:id` traz o board inteiro, então não há endpoint
 * novo nem segunda fonte de verdade para a mesma informação.
 *
 * Card arquivado não entra: ele nem chega no `BoardDetail`. A consequência é
 * que a última desmarcação faz a tag sumir do catálogo, e não sobra lixo para
 * limpar depois — é o que dispensa um `limparTagsOrfas` do lado do card.
 *
 * Ordena por uso e depois por nome: a tag que você acabou de aplicar em cinco
 * cards é a que você vai querer de novo (RF-03).
 */
export function catalogoDeTags(colunas: ColumnDetail[]): TagDoBoard[] {
  const contagem = new Map<string, number>();
  for (const coluna of colunas) {
    for (const card of coluna.cards) {
      for (const tag of card.tags) contagem.set(tag, (contagem.get(tag) ?? 0) + 1);
    }
  }

  return [...contagem.entries()]
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * RF-08: o filtro do board é **OU** — basta uma das tags selecionadas.
 *
 * Vive aqui, e não no componente, porque o quadro usa para decidir o que
 * renderizar e a barra usa para contar o que escondeu. Duas contas diferentes
 * para a mesma pergunta dariam números que não fecham.
 */
export function cardCasaFiltro(tags: string[], selecionadas: string[]): boolean {
  if (selecionadas.length === 0) return true;
  return tags.some((t) => selecionadas.includes(t));
}
