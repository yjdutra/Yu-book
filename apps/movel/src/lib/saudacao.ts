/**
 * "Bom dia", "Boa tarde", "Boa noite" pela hora do aparelho. Só serve à
 * saudação: dia e hora de dado (evento, tarefa, prazo) vêm da API, no fuso do
 * usuário (contrato §4.5). As outras leituras do relógio moram em `datas.ts`.
 */
export function saudacao(hora: number): string {
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}

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
