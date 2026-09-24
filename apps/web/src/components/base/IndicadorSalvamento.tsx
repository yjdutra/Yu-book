import type { EstadoSalvamento } from "../../lib/useAutosave";
import { IconeAlerta } from "../Icones";

/**
 * RF-16 / RNF-09: estado do autosave com texto próprio, não só cor. A nota e o
 * card tinham uma cópia cada, que já divergia no tamanho da letra.
 */
export function IndicadorSalvamento({ estado }: { estado: EstadoSalvamento }) {
  if (estado.tipo === "ocioso") return null;

  if (estado.tipo === "erro") {
    // RF-17: erro é persistente, não um toast que some.
    return (
      <span
        role="alert"
        className="inline-flex items-center gap-1 rounded-etiqueta bg-red-500/15 px-2 py-1
                   text-miudo text-red-300"
        title={estado.mensagem}
      >
        <IconeAlerta className="size-3" />
        não salvo — tentativa {estado.tentativas}/3
      </span>
    );
  }

  const texto =
    estado.tipo === "salvando"
      ? "salvando…"
      : estado.tipo === "salvo"
        ? `salvo ${estado.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "editando";

  return (
    <span aria-live="polite" className="text-miudo tabular-nums text-ink-400">
      {texto}
    </span>
  );
}
