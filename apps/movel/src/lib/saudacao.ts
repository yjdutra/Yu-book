/*
 * O nome do usuário como o móvel o diz. A saudação ("Bom dia") é
 * `@yu-book/cliente/texto`, a mesma do Início do web.
 */

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** Até duas letras: a do primeiro nome e a do último. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (primeira + ultima).toUpperCase() || "?";
}
