/** Um dia do gráfico: o humor (1 a 5, ou `null` sem registro) e os pontos. */
export interface DiaDoHumor {
  dia: string;
  humor: number | null;
  pontos: number;
}

const LARGURA = 300;
const ALTURA = 150;
const TOPO = 10;
const BASE = 130;
/// Os pontos ocupam no máximo a metade de baixo: ficam atrás da linha.
const ALTURA_DAS_BARRAS = 60;

const PONTO = [
  "fill-humor-1",
  "fill-humor-2",
  "fill-humor-3",
  "fill-humor-4",
  "fill-humor-5",
] as const;

/**
 * O humor dos últimos dias sobre os pontos de cada dia (frente Ritmo, RF-45):
 * a linha em `accent-400` e os pontos na cor do humor; atrás, as barras
 * apagadas dos pontos. SVG à mão (RNF-07), que acompanha a largura. O resumo vai
 * no `aria-label`, e a tela põe a lista de registros logo abaixo — o desenho não
 * é o único caminho até os números (RNF-08).
 */
export function GraficoHumor({ dias, rotulo }: { dias: DiaDoHumor[]; rotulo: string }) {
  const n = Math.max(1, dias.length - 1);
  const x = (i: number) => 6 + (i * (LARGURA - 12)) / n;
  const y = (v: number) => BASE - ((v - 1) / 4) * (BASE - TOPO);
  const maiorPonto = Math.max(1, ...dias.map((d) => d.pontos));
  const comHumor = dias
    .map((d, i) => ({ i, v: d.humor }))
    .filter((p): p is { i: number; v: number } => p.v !== null);
  const linha = comHumor.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      role="img"
      aria-label={rotulo}
      // A altura sai da largura, pela proporção do `viewBox`: esticar só na
      // horizontal transformaria os pontos em elipses.
      className="block h-auto w-full overflow-visible"
    >
      {[TOPO, (TOPO + BASE) / 2, BASE].map((linhaY) => (
        <line key={linhaY} x1="0" x2={LARGURA} y1={linhaY} y2={linhaY} className="stroke-ink-800" />
      ))}
      {dias.map((d, i) => {
        const h = Math.round((d.pontos / maiorPonto) * ALTURA_DAS_BARRAS);
        return h > 0 ? (
          <rect
            key={d.dia}
            x={x(i) - 6}
            y={BASE - h}
            width="12"
            height={h}
            rx="3"
            className="fill-accent-500/25"
          />
        ) : null;
      })}
      {comHumor.length > 1 && (
        <polyline
          points={linha}
          fill="none"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-accent-400"
        />
      )}
      {comHumor.map((p) => (
        <circle
          key={p.i}
          cx={x(p.i)}
          cy={y(p.v)}
          r="5"
          strokeWidth="2"
          className={`${PONTO[Math.min(4, Math.max(0, Math.round(p.v) - 1))]} stroke-superficie`}
        />
      ))}
    </svg>
  );
}
