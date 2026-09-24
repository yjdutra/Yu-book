import type { ReactNode } from "react";

type Tom = "neutro" | "destaque" | "ia";

const TOM: Record<Tom, string> = {
  neutro: "border-ink-700 text-ink-400",
  destaque: "border-accent-500/40 bg-accent-500/10 text-accent-400",
  ia: "border-ia-500/40 bg-linear-to-r from-accent-500/10 to-ia-500/10 text-accent-400",
};

/**
 * Etiqueta — um rótulo curto em pílula (redesenho de UI, Etapa 3): o modelo
 * que respondeu, a fonte consultada. Informação, não controle: quando precisa
 * reagir a clique, quem usa passa `como="button"`.
 */
export function Etiqueta({
  tom = "neutro",
  icone,
  children,
  como = "span",
  onClick,
  titulo,
}: {
  tom?: Tom;
  icone?: ReactNode;
  children: ReactNode;
  como?: "span" | "button";
  onClick?: () => void;
  titulo?: string;
}) {
  const classe = `inline-flex max-w-full items-center gap-1 rounded-etiqueta border px-1.5 py-0.5
                  text-miudo ${TOM[tom]}`;
  if (como === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={titulo}
        className={`${classe} transition-colors hover:border-accent-400 hover:text-titulo`}
      >
        {icone}
        <span className="truncate">{children}</span>
      </button>
    );
  }
  return (
    <span className={classe} title={titulo}>
      {icone}
      <span className="truncate">{children}</span>
    </span>
  );
}
