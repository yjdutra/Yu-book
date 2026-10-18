import type { ReactNode } from "react";
import { IconeCheck } from "../Icones";

/**
 * O anel de uma meta (frente Ritmo, RF-20 e RF-21): o trilho em `ink-800` e o
 * arco no `--tom` de um ancestral (ou `accent-500`, sem tom). Ao fechar 100%
 * o miolo pode virar check (`checkAoFechar`) — a forma muda, não só a cor.
 *
 * O desenho é `aria-hidden`: o nome acessível vem de `rotulo`, numa figura, e
 * o número no miolo é o mesmo que o rótulo diz (RNF-08). Sem movimento quando
 * o sistema pede menos (a transição cai pela regra global de `tema.css`).
 */
export function AnelProgresso({
  valor,
  total,
  tamanho = 44,
  espessura = 5,
  rotulo,
  checkAoFechar = false,
  children,
}: {
  valor: number;
  total: number;
  /** Lado, em px. */
  tamanho?: number;
  espessura?: number;
  /** "Inglês: 80 de 120 pontos na semana". */
  rotulo: string;
  checkAoFechar?: boolean;
  /** O miolo — o número, em geral. */
  children?: ReactNode;
}) {
  const raio = (tamanho - espessura) / 2;
  const volta = 2 * Math.PI * raio;
  const fracao = total > 0 ? Math.min(1, Math.max(0, valor / total)) : 0;
  const fechou = fracao >= 1;
  return (
    <div
      role="img"
      aria-label={rotulo}
      className="relative grid shrink-0 place-items-center"
      style={{ width: tamanho, height: tamanho }}
    >
      <svg width={tamanho} height={tamanho} aria-hidden="true" className="-rotate-90">
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          strokeWidth={espessura}
          className="stroke-ink-800"
        />
        {fracao > 0 && (
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={raio}
            fill="none"
            strokeWidth={espessura}
            strokeLinecap="round"
            strokeDasharray={`${(volta * fracao).toFixed(1)} ${volta.toFixed(1)}`}
            className="stroke-[var(--tom,var(--color-accent-500))] transition-[stroke-dasharray]
                       duration-500 ease-(--ease-saida)"
          />
        )}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 grid place-items-center text-center">
        {fechou && checkAoFechar ? (
          <IconeCheck className="size-1/2 text-[var(--tom,var(--color-accent-500))]" />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
