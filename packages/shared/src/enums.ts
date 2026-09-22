/**
 * Tipos de nota. Uma única entidade `Note` cobre todos os contextos —
 * adicionar um tipo novo é adicionar um valor aqui, não uma tabela.
 */
export const NOTE_KINDS = ["aula", "projeto", "trilha", "trabalho", "livre"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const COMPANY_STATUSES = ["interesse", "aplicado", "entrevista", "descartada"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const CARD_PRIORITIES = ["baixa", "media", "alta"] as const;
export type CardPriority = (typeof CARD_PRIORITIES)[number];

/**
 * As duas listas da gaveta. `favorito` dura; `depois` existe para ser
 * consumido e apagado — mesma estrutura, intenções opostas.
 */
export const LINK_KINDS = ["favorito", "depois"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * Tarefas de IA que consomem modelo. Espelha o enum `AiTask` do Prisma.
 * `chat` já entra aqui porque acrescentar valor a enum do Postgres é migration
 * à parte — e a etapa B precisaria dela só para existir.
 */
export const AI_TASKS = ["formatar", "chat"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * De onde veio o custo registrado de uma chamada. Espelha `AiCostSource`.
 *
 * `estimado` é calculado pelo preço do catálogo quando o provedor não informa;
 * `desconhecido` é quando não veio nem custo nem token — grava zero, e por isso
 * precisa ser **contado e mostrado**: chamada de custo zero não move o teto
 * diário, e um provedor que parasse de informar tornaria o teto decorativo.
 */
export const AI_COST_SOURCES = ["provedor", "estimado", "desconhecido"] as const;
export type AiCostSource = (typeof AI_COST_SOURCES)[number];
