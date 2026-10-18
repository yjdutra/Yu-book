/** Uma célula do mapa: o dia e os pontos; `null` é dia que ainda não chegou. */
export interface CelulaDoMapa {
  dia: string;
  pontos: number;
}

/// Os quatro tons: nada, um pouco, perto do teto, no teto ou acima.
const TONS = [
  "bg-ink-800",
  "bg-[color-mix(in_srgb,var(--tom)_35%,transparent)]",
  "bg-[color-mix(in_srgb,var(--tom)_65%,transparent)]",
  "bg-(--tom)",
] as const;
const NOMES = ["nada", "um pouco", "perto do teto", "no teto"] as const;

/** O tom de `pontos` relativo ao teto do dia. */
function nivelDe(pontos: number, teto: number): 0 | 1 | 2 | 3 {
  if (pontos <= 0) return 0;
  if (pontos >= teto) return 3;
  return pontos >= teto / 2 ? 2 : 1;
}

/**
 * O mapa de 12 semanas de um hábito (frente Ritmo, RF-24): uma coluna por
 * semana, de segunda (em cima) a domingo, e quatro tons relativos ao teto do
 * dia, com legenda. Cada célula tem `title` com o dia e os pontos, e a figura
 * tem o resumo para o leitor de tela (RNF-08) — o tom não é o único caminho.
 */
export function MapaCalor({
  semanas,
  teto,
  rotulo,
  formatarDia,
}: {
  /** Colunas de sete células, a mais antiga primeiro. */
  semanas: (CelulaDoMapa | null)[][];
  teto: number;
  rotulo: string;
  formatarDia: (dia: string) => string;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div
        role="img"
        aria-label={rotulo}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${semanas.length}, minmax(0, 1fr))` }}
      >
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-rows-7 gap-1">
            {semana.map((c, j) =>
              c ? (
                <span
                  key={c.dia}
                  title={`${formatarDia(c.dia)}: ${c.pontos} pts`}
                  className={`aspect-square rounded-[4px] ${TONS[nivelDe(c.pontos, teto)]}`}
                />
              ) : (
                <span key={`vazio-${j}`} className="aspect-square" />
              ),
            )}
          </div>
        ))}
      </div>
      <figcaption
        aria-hidden="true"
        className="flex items-center justify-end gap-1 text-miudo text-ink-400"
      >
        menos
        {TONS.map((tom, i) => (
          <span key={tom} title={NOMES[i]} className={`size-2.5 rounded-[3px] ${tom}`} />
        ))}
        mais
      </figcaption>
    </figure>
  );
}
