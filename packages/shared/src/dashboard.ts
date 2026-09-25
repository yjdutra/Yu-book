import { z } from "zod";
import type { CardPriority } from "./enums.js";
import type { AiMark } from "./marca.js";
import type { NoteSummary } from "./notes.js";
import type { RoutineRunSummary } from "./rotinas.js";

/** Quantos itens cada bloco mostra antes de resumir o resto (RF-12, RF-13, RF-16). */
export const LIMITE_PRAZOS = 5;
export const LIMITE_NOTAS = 6;
export const LIMITE_LINKS = 3;

/// Quantas execuções o bloco Rotinas mostra em "Desde a última visita".
export const LIMITE_EXECUCOES_NOVAS = 10;

/// Sem marco de "visto" (a conta nunca abriu o Início desde a Etapa F), as
/// execuções novas são as que terminaram nestas últimas horas.
export const JANELA_EXECUCOES_SEM_MARCO_HORAS = 24;

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
  ai: AiMark | null;
}

export interface LinkResumo {
  id: string;
  url: string;
  title: string;
  domain: string;
  createdAt: string;
  durationSeconds: number | null;
}

/**
 * Uma execução no bloco Rotinas do Início (Etapa F). Carrega o que o link para
 * a saída precisa sem outra ida à API: a rota do card leva o quadro. Nulos
 * quando não há saída, ou quando ela foi excluída depois.
 */
export interface DashboardRoutineRun extends RoutineRunSummary {
  outputBoardId: string | null;
  /// O título do card ou da nota de saída, como está agora.
  outputTitle: string | null;
}

export interface DashboardNextRun {
  routineId: string;
  name: string;
  at: string;
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
  /**
   * Etapa F. Não segue o workspace ativo: rotina não tem workspace.
   *
   * - `novas`: execuções terminadas depois de `vistoEm` (ou nas últimas
   *   `JANELA_EXECUCOES_SEM_MARCO_HORAS`, sem marco), de qualquer gatilho, da
   *   mais recente, até `LIMITE_EXECUCOES_NOVAS`. A `pulada` com tentativa
   *   pela frente também entra — `proximaTentativa` diz quando.
   * - `proximas`: os próximos `PROXIMOS_HORARIOS` de todas as rotinas
   *   agendadas e válidas, em ordem.
   * - `ate`: o instante do corte de `novas`. É o que o Início manda em
   *   `POST /ai/runs/seen` depois de mostrar.
   */
  rotinas: {
    novas: DashboardRoutineRun[];
    proximas: DashboardNextRun[];
    vistoEm: string | null;
    ate: string;
  };
}
