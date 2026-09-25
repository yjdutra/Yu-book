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
 *
 * `como="a"` é **link externo** (Etapa G da IA, a fonte que veio da web): abre
 * sempre em outra aba, sem `opener` nem `referer` — a página é de terceiro e
 * não recebe de onde veio o clique. O "abre em outra aba" vai para o leitor de
 * tela; quem vê tem o ícone de quem usa e a dica com o endereço.
 */
export function Etiqueta({
  tom = "neutro",
  icone,
  children,
  como = "span",
  onClick,
  titulo,
  href,
}: {
  tom?: Tom;
  icone?: ReactNode;
  children: ReactNode;
  como?: "span" | "button" | "a";
  onClick?: () => void;
  titulo?: string;
  /** Só com `como="a"`. */
  href?: string;
}) {
  const classe = `inline-flex max-w-full items-center gap-1 rounded-etiqueta border px-1.5 py-0.5
                  text-miudo ${TOM[tom]}`;
  if (como === "a") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={titulo}
        className={`${classe} transition-colors hover:border-accent-400 hover:text-titulo`}
      >
        {icone}
        <span className="truncate">{children}</span>
        <span className="sr-only">, abre em outra aba</span>
      </a>
    );
  }
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
