import { z } from "zod";
import type { CardPriority } from "./enums.js";
import type { NoteSummary } from "./notes.js";

/** Quantos itens cada bloco mostra antes de resumir o resto (RF-12, RF-13, RF-16). */
export const LIMITE_PRAZOS = 5;
export const LIMITE_NOTAS = 6;
export const LIMITE_LINKS = 3;

/** Janela do bloco de prazos, em dias (RN-03). */
export const JANELA_PRAZOS_DIAS = 7;

export const dashboardQuerySchema = z.object({
  /** RF-05: prazos e notas seguem o workspace ativo; links, não. */
  workspaceId: z.string().uuid().optional(),
});

export interface CardComPrazo {
  id: string;
  title: string;
  dueDate: string;
  priority: CardPriority;
  boardId: string;
  boardName: string;
  columnName: string;
}

export interface LinkResumo {
  id: string;
  url: string;
  title: string;
  domain: string;
  createdAt: string;
}

export interface Dashboard {
  prazos: {
    vencidos: CardComPrazo[];
    proximos: CardComPrazo[];
    /** Totais reais, para dizer quantos ficaram de fora do recorte (RF-12). */
    totalVencidos: number;
    totalProximos: number;
  };
  notas: NoteSummary[];
  links: {
    total: number;
    antigos: LinkResumo[];
  };
}
