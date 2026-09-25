import { useId } from "react";

/** Um ponto da série: o dia como `YYYY-MM-DD` e o valor já na unidade de `formatar`. */
export interface ValorDoDia {
  dia: string;
  valor: number;
}

/// Altura só da área das barras; os rótulos do eixo moram fora do SVG, em HTML,
/// para a figura inteira caber no bloco sem rolagem própria.
const ALTURA = 96;
/// Folga acima da barra mais alta.
const TOPO = 4;
/// Raio da ponta. A barra desce `RAIO` abaixo da linha de base e o recorte a
/// corta ali: ponta arredondada, pé reto sobre a base.
const RAIO = 4;
/// Fração da faixa de cada dia ocupada pela barra; o resto é ar entre barras.
const OCUPACAO = 0.8;

/**
 * "2026-09-25" → "25/09". Corte de texto, e não `new Date`: o dia já vem
 * decidido por quem chama (UTC no provedor, o fuso do usuário no painel de
 * uso sobre `ai_usage`), e passar por `Date` o empurraria para o fuso do
 * navegador.
 */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return mes && d ? `${d}/${mes}` : dia;
}

/**
 * Barras por dia, uma série só — o custo diário do painel do OpenRouter e,
 * no painel de uso sobre `ai_usage`, o uso por dia no fuso do usuário. Por
 * isso não sabe de dinheiro nem de fuso: recebe os dias prontos e o
 * formatador do valor.
 *
 * SVG à mão, sem biblioteca de gráfico, e sem cor fora dos tokens: a barra é
 * `accent-500`, a base `ink-700`, e os dois temas trocam pelo CSS. Série única
 * não tem legenda — o título do bloco diz o que está desenhado.
 *
 * O desenho não é o único caminho até o número (RNF-09): o `aria-label` traz
 * o resumo, cada barra tem `<title>` para quem passa o ponteiro, e a tabela
 * recolhida abaixo tem todos os dias, para teclado e leitor de tela.
 *
 * A largura é em porcentagem, e a altura em pixels: o gráfico acompanha a
 * largura do bloco sem medir nada e sem esticar o raio da ponta, que um
 * `viewBox` com `preserveAspectRatio="none"` deformaria.
 */
export function BarrasPorDia({
  dias,
  formatar,
  rotulo,
}: {
  dias: ValorDoDia[];
  formatar: (valor: number) => string;
  /** O que a série é, como frase: "Custo por dia". Abre o resumo acessível. */
  rotulo: string;
}) {
  // `useId` traz caracteres que não valem dentro de `url(#…)`.
  const idRecorte = `barras-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const total = dias.reduce((soma, d) => soma + d.valor, 0);
  const maior = dias.reduce<ValorDoDia | null>(
    (atual, d) => (atual === null || d.valor > atual.valor ? d : atual),
    null,
  );
  const maximo = maior?.valor ?? 0;
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];

  const resumo =
    maior && maximo > 0
      ? `${rotulo}: total ${formatar(total)}; máximo ${formatar(maximo)} em ` +
        `${diaCurto(maior.dia)}.`
      : `${rotulo}: nenhum valor no período.`;

  const faixa = dias.length > 0 ? 100 / dias.length : 0;
  const util = ALTURA - TOPO;

  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      {/* O extremo rotulado à vista; os outros dias ficam no `<title>` e na
          tabela. O resumo sai para o leitor de tela pelo `aria-label`. */}
      <p aria-hidden="true" className="text-xs text-ink-400">
        Total <span className="tabular-nums text-ink-200">{formatar(total)}</span>
        {maior && maximo > 0 && (
          <>
            {" · "}máximo{" "}
            <span className="tabular-nums text-ink-200">{formatar(maximo)}</span> em{" "}
            <span className="tabular-nums">{diaCurto(maior.dia)}</span>
          </>
        )}
      </p>

      <svg width="100%" height={ALTURA} role="img" aria-label={resumo} className="block">
        <defs>
          <clipPath id={idRecorte}>
            <rect x="0" y="0" width="100%" height={ALTURA} />
          </clipPath>
        </defs>
        {dias.map((d, i) => {
          const proporcao = maximo > 0 ? d.valor / maximo : 0;
          // Valor positivo nunca some: fica com 2 px, para "pouco" não se
          // confundir com "nada".
          const altura = d.valor > 0 ? Math.max(proporcao * util, 2) : 0;
          return (
            <g key={d.dia} className="group">
              <title>{`${diaCurto(d.dia)}: ${formatar(d.valor)}`}</title>
              {/* O alvo do ponteiro é a faixa inteira do dia, não só a barra:
                  dia de valor zero também responde. */}
              <rect
                x={`${i * faixa}%`}
                y="0"
                width={`${faixa}%`}
                height={ALTURA}
                fill="transparent"
              />
              {altura > 0 && (
                <rect
                  x={`${(i + (1 - OCUPACAO) / 2) * faixa}%`}
                  y={ALTURA - altura}
                  width={`${faixa * OCUPACAO}%`}
                  height={altura + RAIO}
                  rx={RAIO}
                  clipPath={`url(#${idRecorte})`}
                  className="fill-accent-500 transition-colors group-hover:fill-accent-400"
                />
              )}
            </g>
          );
        })}
        <line
          x1="0"
          x2="100%"
          y1={ALTURA - 0.5}
          y2={ALTURA - 0.5}
          strokeWidth={1}
          className="stroke-ink-700"
        />
      </svg>

      {/* Eixo só nas pontas: com trinta dias, um rótulo por barra não cabe. */}
      {primeiro && ultimo && (
        <div
          aria-hidden="true"
          className="flex justify-between text-miudo tabular-nums text-ink-400"
        >
          <span>{diaCurto(primeiro.dia)}</span>
          <span>{diaCurto(ultimo.dia)}</span>
        </div>
      )}

      <details className="text-xs">
        <summary className="w-fit cursor-pointer text-ink-400 hover:text-ink-200">
          Ver os valores por dia
        </summary>
        <table className="mt-2 w-full max-w-xs">
          <caption className="sr-only">{rotulo}</caption>
          <thead>
            <tr className="border-b border-ink-800">
              <th scope="col" className="py-1 pr-3 text-left font-medium text-ink-400">
                Dia
              </th>
              <th scope="col" className="py-1 text-right font-medium text-ink-400">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.dia} className="border-b border-ink-800 last:border-0">
                <th
                  scope="row"
                  className="py-1 pr-3 text-left font-normal tabular-nums text-ink-400"
                >
                  {diaCurto(d.dia)}
                </th>
                <td className="py-1 text-right tabular-nums text-ink-200">{formatar(d.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
