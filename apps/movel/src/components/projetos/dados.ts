import { useTarefas } from "@yu-book/cliente/agenda";
import { useAgendaAdiante } from "@yu-book/cliente/hoje";
import type { BoardSummary, EventItem, TaskItem } from "@yu-book/shared";
import { useMemo } from "react";
import { useQuadros } from "../../lib/quadros";

/// Até onde "próximos eventos" de um projeto olham: 31 dias contando hoje,
/// dentro do teto de 62 da consulta da agenda.
export const DIAS_DE_PROJETO = 30;

export interface Projeto {
  quadro: BoardSummary;
  abertas: TaskItem[];
  /// Os que ainda não acabaram, na janela, em ordem de início.
  eventos: EventItem[];
}

/**
 * Os projetos (quadros) com o que está em andamento em cada um, de três
 * consultas que saem juntas, sem cascata: `GET /boards`, as tarefas abertas
 * (a mesma lista de Tarefas e do Início) e a agenda dos próximos 30 dias.
 * A lista e o detalhe leem daqui — o detalhe chega com o cache já quente.
 *
 * `fresca` só na lista: o detalhe já reconfere o quadro ausente
 * (`useReconferirQuadro`), e uma segunda busca ao montar cancelaria aquela.
 */
export function useProjetos({ fresca = false }: { fresca?: boolean } = {}) {
  const quadros = useQuadros({ fresca });
  const abertas = useTarefas({ status: "abertas" });
  const { hoje, consulta: agenda } = useAgendaAdiante(DIAS_DE_PROJETO);

  const projetos = useMemo(() => {
    if (!quadros.data) return null;
    // O instante de agora contra o fim do evento: comparar instantes não
    // passa por fuso nenhum.
    const agora = Date.now();
    const futuros = (agenda.data?.events ?? []).filter((e) => Date.parse(e.endsAt) > agora);
    return quadros.data.map(
      (quadro): Projeto => ({
        quadro,
        abertas: (abertas.data ?? []).filter((t) => t.board?.id === quadro.id),
        eventos: futuros.filter((e) => e.board?.id === quadro.id),
      }),
    );
  }, [quadros.data, abertas.data, agenda.data]);

  return {
    hoje,
    projetos,
    carregando: quadros.isPending || abertas.isPending || agenda.isPending,
    erro: quadros.isError || abertas.isError || agenda.isError,
    tentar: () => {
      if (quadros.isError) void quadros.refetch();
      if (abertas.isError) void abertas.refetch();
      if (agenda.isError) void agenda.refetch();
    },
  };
}
