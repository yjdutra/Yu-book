import type { AgentSummary } from "@yu-book/shared";

/**
 * Pequenas frases dos agentes que o chat e a galeria dizem igual. Só `import
 * type` de `@yu-book/shared`, pela mesma razão de `AvatarAgente.tsx`: o chat
 * as usa, e o metadado das ferramentas não pode vir junto. O plural ("1
 * nota-base") é `contar`, de `@yu-book/cliente/texto`: o mesmo do móvel e do
 * bloco "Hoje", num módulo sem dependência — não em `@yu-book/cliente/hoje`,
 * que traz valor de `shared` e levaria isso ao chunk do chat.
 */

/** O modelo do agente como a tela o diz — inclusive quando ele saiu dos favoritos. */
export function rotuloDoModelo(a: Pick<AgentSummary, "modelId" | "modelName" | "modelMissing">) {
  if (a.modelMissing) return "modelo fora dos favoritos";
  return a.modelId ? (a.modelName ?? a.modelId) : "modelo do chat";
}

