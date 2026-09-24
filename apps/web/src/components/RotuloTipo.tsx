import type { NoteKind } from "@yu-book/shared";

/** Card entra aqui porque a paleta mistura os dois (RF-41). */
export type TipoRotulado = NoteKind | "card";

/**
 * RNF-07: o tipo nunca é comunicado só por cor. Cada um tem uma inicial
 * própria, então continua legível em monocromático ou por daltônicos.
 */
const ESTILOS: Record<TipoRotulado, { sigla: string; classe: string }> = {
  aula: { sigla: "A", classe: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  projeto: { sigla: "P", classe: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  trilha: { sigla: "T", classe: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  trabalho: { sigla: "W", classe: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  livre: { sigla: "L", classe: "bg-ink-700 text-ink-400 border-ink-700" },
  card: { sigla: "C", classe: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
};

export function RotuloTipo({ tipo, className = "" }: { tipo: TipoRotulado; className?: string }) {
  const { sigla, classe } = ESTILOS[tipo];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-miudo
                  font-medium uppercase tracking-wide ${classe} ${className}`}
    >
      <span aria-hidden="true">{sigla}</span>
      <span>{tipo}</span>
    </span>
  );
}
