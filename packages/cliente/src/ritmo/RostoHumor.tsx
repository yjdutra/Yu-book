import { NOMES_DO_HUMOR } from "@yu-book/shared";

/// A boca de cada valor, de 1 a 5: a forma muda, não só a cor (RNF-15).
const BOCAS = [
  "M7.5 17Q12 12.5 16.5 17",
  "M8 16Q12 14 16 16",
  "M8 15.5L16 15.5",
  "M8 14.5Q12 17 16 14.5",
  "M7 13.5Q12 19 17 13.5",
] as const;

const FUNDOS = [
  "fill-humor-1",
  "fill-humor-2",
  "fill-humor-3",
  "fill-humor-4",
  "fill-humor-5",
] as const;

/**
 * A cara de um humor de 1 a 5 (frente Ritmo, Ritmo 4). Decorativa por padrão:
 * quem usa diz o nome ao lado ou no rótulo do controle. Com `rotulo`, vira
 * imagem com nome — para listas em que a cara é o único sinal.
 */
export function RostoHumor({
  valor,
  className = "size-10",
  rotulo,
}: {
  valor: number;
  className?: string;
  rotulo?: string;
}) {
  const i = Math.min(4, Math.max(0, Math.round(valor) - 1));
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      {...(rotulo ? { role: "img", "aria-label": rotulo } : { "aria-hidden": true })}
    >
      <circle cx="12" cy="12" r="11" className={FUNDOS[i]} />
      <circle cx="8.5" cy="10" r="1.3" className="fill-humor-traco" />
      <circle cx="15.5" cy="10" r="1.3" className="fill-humor-traco" />
      <path
        d={BOCAS[i]}
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="stroke-humor-traco"
      />
    </svg>
  );
}

/**
 * As cinco caras para escolher (RF-44): um `radiogroup` de verdade, com o nome
 * de cada uma à vista. As setas não são necessárias — cinco botões de 44px —,
 * mas o grupo diz ao leitor de tela que é uma escolha só.
 */
export function SeletorHumor({
  valor,
  onEscolher,
  rotulo,
}: {
  valor: number | null;
  onEscolher: (valor: number) => void;
  rotulo: string;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="grid grid-cols-5 gap-1.5">
      {NOMES_DO_HUMOR.map((nome, i) => {
        const escolhido = valor === i + 1;
        return (
          <button
            key={nome}
            type="button"
            role="radio"
            aria-checked={escolhido}
            onClick={() => onEscolher(i + 1)}
            className={`flex min-h-11 flex-col items-center gap-1 rounded-cartao py-2 text-miudo
                        transition-colors ${
                          escolhido
                            ? "bg-accent-500/15 font-bold text-titulo ring-2 ring-accent-500"
                            : "text-ink-400 hover:bg-ink-800"
                        }`}
          >
            <RostoHumor valor={i + 1} className="size-9" />
            {nome}
          </button>
        );
      })}
    </div>
  );
}
