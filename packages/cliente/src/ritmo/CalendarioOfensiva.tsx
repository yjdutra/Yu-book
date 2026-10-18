/** Um dia da grade: `null` é casa vazia antes do dia 1. */
export interface DiaDoCalendario {
  dia: string;
  numero: number;
  ativo: boolean;
  hoje: boolean;
  /** Já passou e não teve registro. */
  perdido: boolean;
}

const CABECA = ["S", "T", "Q", "Q", "S", "S", "D"] as const;

/**
 * O calendário da ofensiva (frente Ritmo, RF-36): a semana começa na segunda,
 * e os dias ativos seguidos se ligam numa faixa contínua — a virada de linha
 * arredonda as pontas. Hoje é o disco cheio; o dia perdido, um disco apagado.
 * Cada dia diz o estado no nome acessível; a cor não é o único sinal (RNF-08).
 */
export function CalendarioOfensiva({
  dias,
  rotulo,
  formatarDia,
}: {
  /** As casas da grade, segunda primeiro; `null` antes do dia 1. */
  dias: (DiaDoCalendario | null)[];
  rotulo: string;
  formatarDia: (dia: string) => string;
}) {
  return (
    <div role="group" aria-label={rotulo} className="grid grid-cols-7 gap-y-1.5">
      {CABECA.map((c, i) => (
        <span key={i} aria-hidden="true" className="pb-0.5 text-center text-miudo font-semibold text-ink-400">
          {c}
        </span>
      ))}
      {dias.map((d, i) => {
        if (!d) return <span key={`vazio-${i}`} />;
        const coluna = i % 7;
        const antes = dias[i - 1]?.ativo === true && coluna !== 0;
        const depois = dias[i + 1]?.ativo === true && coluna !== 6;
        const estado = d.ativo ? "com registro" : d.perdido ? "sem registro" : "";
        return (
          <div
            key={d.dia}
            className={`grid h-10 place-items-center ${
              d.ativo ? "bg-[color-mix(in_srgb,var(--color-chama-500)_16%,transparent)]" : ""
            } ${d.ativo && !antes ? "rounded-l-full" : ""} ${d.ativo && !depois ? "rounded-r-full" : ""}`}
          >
            <span
              aria-label={`${formatarDia(d.dia)}${estado ? `, ${estado}` : ""}${d.hoje ? ", hoje" : ""}`}
              className={`grid size-8.5 place-items-center rounded-full text-[0.8125rem] tabular-nums ${
                d.hoje
                  ? "bg-chama-600 font-extrabold text-white"
                  : d.ativo
                    ? "font-extrabold text-chama-300"
                    : d.perdido
                      ? "bg-ink-800 font-medium text-ink-400"
                      : "font-medium text-ink-400"
              }`}
            >
              {d.numero}
            </span>
          </div>
        );
      })}
    </div>
  );
}
