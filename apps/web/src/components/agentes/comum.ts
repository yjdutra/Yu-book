import type { AgentSummary } from "@yu-book/shared";

/**
 * Pequenas frases dos agentes que o chat e a galeria dizem igual. Só `import
 * type` de `@yu-book/shared`, pela mesma razão de `AvatarAgente.tsx`: o chat
 * as usa, e o metadado das ferramentas não pode vir junto.
 */

/** "1 nota-base", "3 notas-base" — o plural que a tela diz em voz alta. */
export function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** O modelo do agente como a tela o diz — inclusive quando ele saiu dos favoritos. */
export function rotuloDoModelo(a: Pick<AgentSummary, "modelId" | "modelName" | "modelMissing">) {
  if (a.modelMissing) return "modelo fora dos favoritos";
  return a.modelId ? (a.modelName ?? a.modelId) : "modelo do chat";
}

