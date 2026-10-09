import { useQuery } from "@tanstack/react-query";
import { api } from "@yu-book/cliente/api";
import type { BoardSummary } from "@yu-book/shared";
import { useEffect, useState } from "react";

/**
 * Os quadros da conta, que no móvel são os **projetos** (decisão da frente de
 * agenda). A chave é a do `useBoards(null)` do web, `["boards", null]`: quem
 * invalida `["boards"]` lá alcança esta também.
 *
 * `fresca`: a tela que **lista** os projetos pede a lista de novo ao montar,
 * mesmo dentro dos 5 minutos — o quadro criado no web, pelo chat ou pelo MCP
 * apareceria só quando o cache envelhecesse. As demais leem o cache.
 */
export function useQuadros({ fresca = false }: { fresca?: boolean } = {}) {
  return useQuery({
    queryKey: ["boards", null],
    queryFn: () => api.get<BoardSummary[]>("/boards"),
    staleTime: 5 * 60_000,
    ...(fresca && { refetchOnMount: "always" as const }),
  });
}

/**
 * Quadro `id` fora da lista em cache: antes de alguém concluir que ele não
 * existe, a lista é pedida de novo, uma vez por id. O cache vale 5 minutos, e
 * o quadro criado no web (ou pelo chat, ou pelo MCP) nesse meio-tempo não
 * está nele — o link para ele abriria "não encontrado". Devolve `true`
 * enquanto reconfere: quem decide existência mostra esqueleto até lá.
 *
 * Lista que chegou depois desta tela montar já é a de agora
 * (`isFetchedAfterMount`) e não se repete: o link para um quadro que de fato
 * não existe custa uma requisição, não duas.
 */
export function useReconferirQuadro(id: string | null): boolean {
  const quadros = useQuadros();
  const [conferido, setConferido] = useState<string | null>(null);
  const ausente =
    id !== null && quadros.data !== undefined && !quadros.data.some((q) => q.id === id);
  const reconferir = ausente && !quadros.isFetchedAfterMount && conferido !== id;
  const { refetch } = quadros;

  useEffect(() => {
    if (!reconferir || id === null) return;
    let vivo = true;
    // `finally`: se a nova consulta falhar, a tela mostra o erro dela, não o
    // esqueleto para sempre.
    void refetch().finally(() => {
      if (vivo) setConferido(id);
    });
    return () => {
      vivo = false;
    };
  }, [reconferir, id, refetch]);

  return reconferir;
}
