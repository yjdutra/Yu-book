import { IconeCheck, IconeRitmo } from "../Icones";

/** Um dia da faixa da semana no cartão. */
export interface DiaDaChama {
  dia: string;
  /** "S", "T"… */
  letra: string;
  /** "segunda-feira". */
  nome: string;
  estado: "feito" | "hoje" | "pendente" | "perdido";
}

const ESTADO: Record<DiaDaChama["estado"], string> = {
  feito: "feito",
  hoje: "hoje, ainda sem registro",
  pendente: "ainda não chegou",
  perdido: "sem registro",
};

/**
 * O cartão da chama (frente Ritmo, RF-36 e RF-37): a ofensiva geral, a frase
 * do recorde e os dias da semana. É o único cartão de cor cheia do app — o
 * fogo é a recompensa (RNF-14) —, sobre `chama-600` e mais escuro, para o
 * branco passar o contraste de texto grande nos dois temas.
 *
 * Os dias têm forma além da cor: o feito é um disco com o check, o de hoje um
 * anel cheio, o que não chegou um anel tracejado, o perdido um traço. Cada um
 * tem nome para o leitor de tela.
 */
export function CartaoChama({
  dias,
  recorde,
  hojeFeito,
  semana,
  grande = false,
}: {
  dias: number;
  recorde: number;
  hojeFeito: boolean;
  semana?: DiaDaChama[];
  grande?: boolean;
}) {
  const falta = recorde - dias;
  const frase =
    dias === 0
      ? "Registre algo hoje para acender a chama."
      : !hojeFeito
        ? "Marque algo hoje para manter a chama."
        : dias >= recorde
          ? "Recorde em andamento."
          : `Hoje garantido. Recorde: ${recorde} — faltam ${falta}.`;
  return (
    <section
      aria-label={`Ofensiva geral: ${dias} ${dias === 1 ? "dia" : "dias"} seguidos. ${frase}`}
      className={`relative overflow-hidden rounded-dialogo bg-linear-135 from-chama-600
                  to-[color-mix(in_srgb,var(--color-chama-600)_78%,black)] text-white shadow-e2 ${
                    grande ? "p-5" : "p-4"
                  }`}
    >
      <IconeRitmo
        className={`pointer-events-none absolute text-white/20 ${
          grande ? "-right-4 -top-2 size-40" : "-right-3 -top-3 size-28"
        }`}
      />
      <div aria-hidden="true" className="relative">
        <span
          className="inline-block rounded-[8px] border border-white/50 bg-white/15 px-2.5 py-0.5
                     text-miudo font-extrabold uppercase tracking-wider"
        >
          Ofensiva geral
        </span>
        <p className="mt-2 flex items-baseline gap-2">
          <span
            className={`font-extrabold leading-none tracking-tight tabular-nums ${
              grande ? "text-6xl" : "text-4xl"
            }`}
          >
            {dias}
          </span>
          <span className={`font-bold ${grande ? "text-xl" : "text-lg"}`}>
            {dias === 1 ? "dia" : "dias"}
            {grande ? " seguidos" : ""}
          </span>
        </p>
        {grande && recorde > 0 && (
          <div className="mt-3 h-2.5 max-w-56 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.round(Math.min(1, dias / recorde) * 100)}%` }}
            />
          </div>
        )}
        <p className="mt-2 text-[0.8125rem] font-medium">{frase}</p>
      </div>
      {semana && (
        <ul className="relative mt-3 flex gap-1.5" aria-label="Esta semana">
          {semana.map((d) => (
            <li
              key={d.dia}
              aria-label={`${d.nome}: ${ESTADO[d.estado]}`}
              className={`grid size-8.5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                d.estado === "feito"
                  ? "bg-white text-chama-600"
                  : d.estado === "hoje"
                    ? "border-2 border-white bg-white/12"
                    : d.estado === "pendente"
                      ? "border-[1.5px] border-dashed border-white/60 text-white/85"
                      : "bg-black/15 text-white/70"
              }`}
            >
              {d.estado === "feito" ? (
                <IconeCheck className="size-4" />
              ) : (
                <span aria-hidden="true">{d.letra}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
