/** Um dia da semana desenhada. */
export interface DiaDaBarra {
  /** `AAAA-MM-DD`, só para a chave. */
  dia: string;
  /** A letra do eixo ("S", "T"…) e o nome para o leitor de tela ("segunda"). */
  letra: string;
  nome: string;
  pontos: number;
  hoje: boolean;
  /** Dia que ainda não chegou: sem barra nem número. */
  futuro: boolean;
}

/// Altura só da área das barras, em px; os números e o eixo ficam fora dela.
const ALTURA = 104;

/**
 * As barras da semana (frente Ritmo, RF-19 e RF-22) — evolução de
 * `BarrasPorDia` para o teto diário. Com `teto`, cada barra se parte em duas:
 * embaixo, cheia no `--tom`, o que conta para a meta; em cima, `hachurado`, o
 * que passou do teto e vira só XP; e a linha tracejada marca o teto. Sem
 * `teto`, é a soma do dia, uma barra só (a semana de todos os hábitos).
 *
 * HTML à mão, sem biblioteca de gráfico (RNF-07), e o número fica fora do
 * desenho: em cima de cada barra, e numa lista só para o leitor de tela, que
 * diz por dia quanto entrou e quanto contou (RNF-08). Hoje vai em `chama-500`
 * e em negrito no eixo — a cor não é o único sinal.
 */
export function BarrasPonderadas({
  dias,
  teto,
  rotulo,
}: {
  dias: DiaDaBarra[];
  teto?: number;
  /** O que a figura é: "Pontos por dia nesta semana". */
  rotulo: string;
}) {
  const maior = dias.reduce((m, d) => Math.max(m, d.pontos), 0);
  const escala = Math.max(maior, teto ? teto * 1.25 : 0, 1);
  const px = (pontos: number) => Math.round((pontos / escala) * ALTURA);

  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="sr-only">{rotulo}</figcaption>
      <ul className="sr-only">
        {dias
          .filter((d) => !d.futuro)
          .map((d) => {
            const conta = teto ? Math.min(d.pontos, teto) : d.pontos;
            return (
              <li key={d.dia}>
                {`${d.nome}${d.hoje ? " (hoje)" : ""}: ${d.pontos} pts`}
                {teto && d.pontos > conta ? `, ${conta} contam e ${d.pontos - conta} viram XP` : ""}
              </li>
            );
          })}
      </ul>

      <div aria-hidden="true" className="relative">
        <div className="grid grid-cols-7 items-end gap-2" style={{ height: ALTURA + 18 }}>
          {dias.map((d) => {
            const conta = teto ? Math.min(d.pontos, teto) : d.pontos;
            const sobra = d.pontos - conta;
            return (
              <div key={d.dia} className="flex h-full flex-col justify-end">
                <span
                  className={`mb-1 text-center text-miudo font-semibold tabular-nums ${
                    d.hoje ? "text-chama-300" : "text-ink-400"
                  }`}
                >
                  {d.futuro || d.pontos === 0 ? "" : d.pontos}
                </span>
                {sobra > 0 && (
                  <div className="hachurado rounded-t-[6px]" style={{ height: px(sobra) }} />
                )}
                <div
                  className={`${sobra > 0 ? "rounded-b-[6px]" : "rounded-[6px]"} ${
                    d.futuro || d.pontos === 0
                      ? "bg-ink-800"
                      : d.hoje
                        ? "bg-chama-500"
                        : "bg-[var(--tom,var(--color-accent-500))]"
                  }`}
                  style={{ height: d.futuro || d.pontos === 0 ? 4 : Math.max(4, px(conta)) }}
                />
              </div>
            );
          })}
        </div>
        {/* O rótulo do teto mora na legenda: em cima da linha, encavalava na
            barra do domingo. */}
        {teto && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed
                       border-ink-400/60"
            style={{ bottom: px(teto) }}
          />
        )}
      </div>

      <div aria-hidden="true" className="grid grid-cols-7 gap-2">
        {dias.map((d) => (
          <span
            key={d.dia}
            className={`text-center text-miudo ${
              d.hoje ? "font-extrabold text-chama-300" : "font-medium text-ink-400"
            }`}
          >
            {d.letra}
          </span>
        ))}
      </div>

      {teto && (
        <div aria-hidden="true" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-miudo text-ink-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--tom,var(--color-accent-500))]" />
            conta para a meta
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="hachurado size-2.5 rounded-[3px]" />
            acima do teto: só XP
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 border-t-2 border-dashed border-ink-400/60" />
            teto de {teto} por dia
          </span>
        </div>
      )}
    </figure>
  );
}
