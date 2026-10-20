import { IconeChevron, IconeCronometro } from "@yu-book/cliente/icones";
import { Link } from "react-router-dom";

/**
 * O pomodoro genérico no Início: abre o foco sem atividade (`/foco?livre`),
 * que só marca foco e pausa e não pontua. O mesmo destino do atalho do ícone
 * do app, no manifesto.
 */
export function AtalhoPomodoro() {
  return (
    <Link
      to="/foco?livre"
      className="flex min-h-15 items-center gap-3 rounded-dialogo border border-ink-800/70
                 bg-superficie px-3.5 py-2.5 shadow-e1"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-cartao bg-accent-500/15
                   text-accent-400"
      >
        <IconeCronometro className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-titulo">Pomodoro</span>
        <span className="block text-miudo text-ink-400">foco e pausa, sem atividade</span>
      </span>
      <IconeChevron direcao="direita" className="size-4 text-ink-400" />
    </Link>
  );
}
