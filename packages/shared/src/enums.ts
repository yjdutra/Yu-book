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
