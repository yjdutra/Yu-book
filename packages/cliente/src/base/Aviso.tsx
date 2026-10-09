import type { ReactNode } from "react";
import { IconeAlerta, IconeFechar, IconeInfo } from "../Icones";

type Tom = "erro" | "alerta" | "info";

const TOM: Record<Tom, { classe: string; Icone: typeof IconeAlerta }> = {
  erro: { classe: "bg-red-500/15 text-red-300 ring-red-500/30", Icone: IconeAlerta },
  alerta: { classe: "bg-amber-500/10 text-amber-300 ring-amber-500/25", Icone: IconeAlerta },
  info: { classe: "bg-accent-500/10 text-ink-200 ring-accent-500/25", Icone: IconeInfo },
};

/**
 * Aviso inline. Erro de tela fica na tela, não num toast que some (RF-17 da
 * Fase 1) — por isso este é o único jeito de mostrar erro que o redesenho
 * oferece. O glifo acompanha a cor sempre (RNF-09); o erro interrompe o
 * leitor de tela (`alert`), o resto espera a vez (`status`). `urgente` é para o
 * aviso que entra na tela já preenchido e precisa ser ouvido — um `status`
 * inserido assim costuma passar calado.
 */
export function Aviso({
  tom,
  children,
  onFechar,
  urgente = false,
  className = "",
}: {
  tom: Tom;
  children: ReactNode;
  onFechar?: () => void;
  urgente?: boolean;
  className?: string;
}) {
  const { classe, Icone } = TOM[tom];
  return (
    <div
      role={tom === "erro" || urgente ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-controle px-3 py-2 text-xs ring-1 ring-inset
                  ${classe} ${className}`}
    >
      <Icone className="mt-px size-3.5" />
      <div className="min-w-0 flex-1">{children}</div>
      {onFechar && (
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          className="-my-0.5 rounded-etiqueta p-0.5 opacity-70 transition hover:opacity-100"
        >
          <IconeFechar className="size-3.5" />
        </button>
      )}
    </div>
  );
}
