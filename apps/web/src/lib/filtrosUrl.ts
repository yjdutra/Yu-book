import { NOTE_KINDS, NOTE_SORTS } from "@yu-book/shared";
import type { NoteKind, NoteSort } from "@yu-book/shared";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { FILTROS_VAZIOS } from "./notas";
import type { Filtros } from "./notas";
import { useWorkspaceAtivo } from "./workspace";

/** O que da lista de notas vive na URL — tudo, menos o workspace. */
export type FiltrosDaUrl = Omit<Filtros, "workspaceId">;

function ehTipo(v: string | null): v is NoteKind {
  return v !== null && (NOTE_KINDS as readonly string[]).includes(v);
}

function ehOrdem(v: string | null): v is NoteSort {
  return v !== null && (NOTE_SORTS as readonly string[]).includes(v);
}

/** URL → filtros. Valor que não é do enum some calado: link velho não quebra a tela. */
export function lerFiltros(p: URLSearchParams): FiltrosDaUrl {
  const tipo = p.get("tipo");
  const ordem = p.get("ordem");
  return {
    q: p.get("q") ?? "",
    kind: ehTipo(tipo) ? tipo : null,
    tags: (p.get("tags") ?? "").split(",").filter(Boolean),
    favorite: p.get("favoritas") === "1",
    ai: p.get("ia") === "1",
    trash: p.get("lixeira") === "1",
    sort: ehOrdem(ordem) ? ordem : FILTROS_VAZIOS.sort,
  };
}

/** Filtros → URL. O que está no valor padrão não aparece: `/n` limpo é "todas". */
function escreverFiltros(f: FiltrosDaUrl): URLSearchParams {
  const p = new URLSearchParams();
  if (f.kind) p.set("tipo", f.kind);
  if (f.tags.length) p.set("tags", f.tags.join(","));
  if (f.favorite) p.set("favoritas", "1");
  if (f.ai) p.set("ia", "1");
  if (f.trash) p.set("lixeira", "1");
  if (f.q) p.set("q", f.q);
  if (f.sort !== FILTROS_VAZIOS.sort) p.set("ordem", f.sort);
  return p;
}

/**
 * Filtros da lista de notas, guardados na URL (redesenho de UI, Etapa 2).
 *
 * Antes eram um `useState` da casca: o Voltar do navegador não desfazia um
 * filtro e recarregar a página o perdia. Na URL, os dois funcionam de graça, e
 * um filtro vira um link.
 *
 * O workspace fica de fora de propósito (RF-02 da Fase 2): ele é o contexto da
 * aplicação inteira, e vem do seletor global, não da tela de notas.
 *
 * `filtros` é memoizado pela query string para ser estável como dependência
 * de efeito e de `useCallback` — a chave `["notes", filtros]` do TanStack Query
 * não precisaria disso, ela compara por hash estrutural.
 */
export function useFiltrosDaUrl() {
  const [params, setParams] = useSearchParams();
  const { ativoId } = useWorkspaceAtivo();
  const texto = params.toString();

  const filtros = useMemo<Filtros>(
    () => ({ ...lerFiltros(new URLSearchParams(texto)), workspaceId: ativoId }),
    [texto, ativoId],
  );

  /**
   * Trocar filtro empilha no histórico, para o Voltar desfazer. O texto da
   * busca troca no lugar (`substituir`): cada letra digitada não é um passo.
   */
  const definir = useCallback(
    (parcial: Partial<FiltrosDaUrl>, { substituir = false } = {}) => {
      setParams(
        (atual) => escreverFiltros({ ...lerFiltros(atual), ...parcial }),
        { replace: substituir },
      );
    },
    [setParams],
  );

  return [filtros, definir] as const;
}

/** Algum filtro além da ordem está valendo — o que o trilho sinaliza recolhido. */
export function temFiltroAtivo(f: FiltrosDaUrl): boolean {
  return Boolean(f.kind || f.favorite || f.ai || f.trash || f.tags.length || f.q);
}
