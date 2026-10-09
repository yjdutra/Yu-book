/**
 * Frases miúdas que o web e o móvel dizem igual (frente de agenda, Fase 6).
 * Módulo sem dependência nenhuma, de propósito: o chat do web as usa no chunk
 * inicial (o plural das fichas de agente), e por isso elas não moram em
 * `hoje.ts`, que traz valor de `shared` e só o bloco "Hoje", preguiçoso, importa.
 */

/** "1 evento", "2 eventos". */
export function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * "Bom dia", "Boa tarde", "Boa noite" pela hora do aparelho. É cortesia de
 * tela, não dado: dia e hora de evento, tarefa e prazo vêm da API, no fuso do
 * usuário (contrato §4.5).
 */
export function saudacao(hora: number): string {
  if (hora >= 5 && hora < 12) return "Bom dia";
  if (hora >= 12 && hora < 18) return "Boa tarde";
  return "Boa noite";
}
