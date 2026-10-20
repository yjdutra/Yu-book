/**
 * O mascote do assistente rápido: um gato preto em pixel art, desenhado à mão
 * em SVG — cada letra das grades abaixo é um pixel. Sem imagem: pesa alguns
 * kB, fica nítido em qualquer tela (`crispEdges`) e troca com o tema pelos
 * tokens. O movimento é CSS (`index.css`, `.gato-*`), e quem pede menos
 * movimento ao sistema o vê parado (o bloco `prefers-reduced-motion` do tema).
 *
 * Quatro estados, que a tela tira do fluxo da resposta: `parado` (pisca e
 * mexe o rabo), `pensando` (no notebook, digitando), `feito` (pula, olhos
 * felizes, um check no balão) e `erro` (orelhas no lugar, um "?" no balão).
 */
import type { ReactElement } from "react";

export type EstadoDoGato = "parado" | "pensando" | "feito" | "erro";

/// As cores de cada letra. O corpo é preto nos dois temas — é um gato preto —,
/// e o contorno é que muda: claro no escuro, para ele não sumir no fundo.
const CORES: Record<string, string> = {
  o: "var(--color-ink-400)",
  b: "#15171d",
  s: "#2c313e", // o brilho do pelo
  e: "#f5c044", // olhos
  p: "#0b0c10", // pupila
  n: "#e58fa6", // nariz e orelha por dentro
  h: "var(--color-accent-500)", // fone
  l: "var(--color-ink-400)", // notebook
  t: "var(--color-ink-200)", // tela/tampa
  m: "#f6f7fa", // o "?" e o check
};

// Cabeça e corpo, sentado, de frente (16 × 16, a partir de x = 2).
const CORPO = [
  "..oo........oo..",
  ".obno......onbo.",
  ".obnbo....obnbo.",
  ".obbbboooobbbbo.",
  ".obsbbbbbbbbbbo.",
  ".obbbbbbbbbbbbo.",
  ".obbbbbbbbbbbbo.",
  ".obbbbbnnbbbbbo.",
  "..obbbbbbbbbbo..",
  "...oobbbbbboo...",
  "..obsbbbbbbbbo..",
  ".obbbbbbbbbbbbo.",
  ".obbbbbbbbbbbbo.",
  ".obbbbbbbbbbbbo.",
  ".obboobbbbboobbo",
  "..oo..ooooo..oo.",
];

// O fone: o arco sobre a cabeça e as conchas nas laterais.
const FONE = [
  "....hhhhhhhh....",
  "...h........h...",
  "..h..........h..",
  ".h............h.",
  "hh............hh",
  "hh............hh",
  "hh............hh",
];

// Os olhos, por cima da cabeça (12 de largura, a partir de x = 4).
const OLHOS_ABERTOS = [".eep....pee.", ".eee....eee."];
const OLHOS_BAIXOS = ["............", ".eee....eee."];
const OLHOS_FELIZES = ["..e......e..", ".e.e....e.e."];

// O rabo, à direita, em S para cima: gira em torno da base, no pé do corpo.
const RABO = [
  "....oo",
  "...obo",
  "...obo",
  "..obo.",
  ".obo..",
  ".obo..",
  ".obo..",
  "obo...",
  "oo....",
];

// O notebook visto por trás: tampa e base, na frente do corpo.
const NOTEBOOK = [
  ".tttttttttt.",
  ".tlllllllll.",
  ".tllllnllll.",
  ".tlllllllll.",
  "llllllllllll",
];

const PATAS = ["bb", "bo"];

// O balão no alto, à direita: claro, com o check ou o "?" escuro dentro.
const BALAO_CHECK = [
  ".mmmmm.",
  "mmmmmpm",
  "mmmmpmm",
  "mpmpmmm",
  "mmpmmmm",
  ".mmmmm.",
  "..m....",
];
const BALAO_DUVIDA = [
  ".mmmmm.",
  "mmpppmm",
  "mmmmpmm",
  "mmmpmmm",
  "mmmmmmm",
  "mmmpmmm",
  ".mmmmm.",
  "..m....",
];

/**
 * Uma grade de letras em `<rect>`s, com as sequências da mesma cor numa linha
 * juntas num retângulo só — umas 60 formas no gato inteiro.
 */
function Pixels({ linhas, x = 0, y = 0 }: { linhas: string[]; x?: number; y?: number }) {
  const rects: ReactElement[] = [];
  linhas.forEach((linha, j) => {
    let i = 0;
    while (i < linha.length) {
      const c = linha[i] ?? ".";
      let fim = i + 1;
      while (fim < linha.length && linha[fim] === c) fim++;
      const cor = CORES[c];
      if (cor) {
        rects.push(
          <rect key={`${j}-${i}`} x={x + i} y={y + j} width={fim - i} height={1} fill={cor} />,
        );
      }
      i = fim;
    }
  });
  return <>{rects}</>;
}

export function GatoPixel({
  estado,
  className = "",
}: {
  estado: EstadoDoGato;
  className?: string;
}) {
  const olhos =
    estado === "feito" ? OLHOS_FELIZES : estado === "pensando" ? OLHOS_BAIXOS : OLHOS_ABERTOS;
  return (
    <svg
      viewBox="0 0 24 22"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`gato gato-${estado} overflow-visible ${className}`}
    >
      <g className="gato-corpo">
        <g className="gato-rabo">
          <Pixels linhas={RABO} x={16} y={10} />
        </g>
        <Pixels linhas={CORPO} x={2} y={4} />
        <g className="gato-olhos">
          <Pixels linhas={olhos} x={4} y={9} />
        </g>
        <Pixels linhas={FONE} x={2} y={3} />
        {estado === "pensando" && (
          <>
            <Pixels linhas={NOTEBOOK} x={4} y={15} />
            <g className="gato-pata-e">
              <Pixels linhas={PATAS} x={5} y={14} />
            </g>
            <g className="gato-pata-d">
              <Pixels linhas={PATAS} x={13} y={14} />
            </g>
          </>
        )}
      </g>
      {estado === "feito" && (
        <g className="gato-balao">
          <Pixels linhas={BALAO_CHECK} x={17} y={0} />
        </g>
      )}
      {estado === "erro" && (
        <g className="gato-balao">
          <Pixels linhas={BALAO_DUVIDA} x={17} y={0} />
        </g>
      )}
    </svg>
  );
}
