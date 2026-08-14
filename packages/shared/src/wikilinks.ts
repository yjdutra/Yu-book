/**
 * Links `[[titulo]]` (RF-21).
 *
 * Os links são DERIVADOS do conteúdo (RN-02): esta é a única definição da
 * sintaxe, usada pela API para montar a tabela `note_link` e pelo front para
 * renderizar. Se divergirem, os backlinks mentem.
 */

/** Não casa `[[]]` vazio nem atravessa quebra de linha. */
const WIKILINK = /\[\[([^\][\n]+?)\]\]/g;

export function extrairWikilinks(conteudo: string): string[] {
  const titulos = new Set<string>();
  for (const match of conteudo.matchAll(WIKILINK)) {
    const titulo = match[1]?.trim();
    if (titulo) titulos.add(titulo);
  }
  return [...titulos];
}

/**
 * Normalização usada para casar `[[titulo]]` com uma nota: sem acento, sem
 * diferença de caixa. Espelha o índice único do banco
 * (`lower(immutable_unaccent(title))`) — se as duas divergirem, um link pode
 * apontar para nota nenhuma mesmo com o título existindo.
 */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

/**
 * Reescreve `[[antigo]]` para `[[novo]]` ao renomear uma nota (RN-03).
 * Casa só o padrão exato entre colchetes duplos — nunca o título solto no meio
 * do texto, que seria destruição de conteúdo.
 */
export function renomearWikilinks(conteudo: string, antigo: string, novo: string): string {
  const alvo = antigo.replace(ESCAPE_REGEX, "\\$&");
  // \s* tolera `[[ titulo ]]`, que extrairWikilinks também aceita.
  const regex = new RegExp(`\\[\\[\\s*${alvo}\\s*\\]\\]`, "gi");
  return conteudo.replace(regex, `[[${novo}]]`);
}
