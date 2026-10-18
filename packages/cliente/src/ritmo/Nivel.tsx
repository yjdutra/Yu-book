import type { NivelDoRitmo } from "@yu-book/shared";

/**
 * A barra de XP (frente Ritmo, RF-18): o trilho e o preenchimento em ouro e
 * chama. `aria-hidden` — o texto ao lado ("1.265 / 1.400 XP") é o que se lê.
 */
export function BarraXp({ fracao, fina = false }: { fracao: number; fina?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-full bg-ink-800 ${fina ? "h-1.5" : "h-2.5"}`}
    >
      <div
        className="h-full rounded-full bg-linear-to-r from-ouro-500 to-chama-500
                   transition-[width] duration-500 ease-(--ease-saida)"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A fração do caminho entre o começo do nível e o próximo. */
export function fracaoDoNivel(xp: number, nivel: NivelDoRitmo): number {
  const passo = nivel.to - nivel.from;
  return passo > 0 ? (xp - nivel.from) / passo : 0;
}

/**
 * O selo com o número do nível. `chama-600`, com o branco por cima acima de
 * 3:1 em texto grande nos dois temas (`tema.css`). O degrau de baixo é sombra
 * sólida, a "tecla" do protótipo.
 */
export function SeloNivel({ nivel, tamanho = "g" }: { nivel: number; tamanho?: "m" | "g" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center bg-linear-150 from-chama-600 to-chama-600/85
                  font-extrabold tracking-tight text-white shadow-[0_3px_0_0_rgb(0_0_0/0.25)] ${
                    tamanho === "g" ? "size-16 rounded-[20px] text-3xl" : "size-12 rounded-cartao text-xl"
                  }`}
    >
      {nivel}
    </span>
  );
}
