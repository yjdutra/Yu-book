import { IconeMais } from "../Icones";

/**
 * O seletor de pontos da folha "Registrar fora do plano" (frente Ritmo, RF-25):
 * menos e mais de `passo` em `passo`, o número grande no meio. O aviso de
 * quanto conta e quanto vira XP mora abaixo, e é `aria-live` — muda a cada
 * toque e quem não vê a barra ouve o efeito (RN-16).
 *
 * Os dois botões têm 48px, e o nome diz o passo ("Menos 5 pontos").
 */
export function SeletorPontos({
  valor,
  onMudar,
  min,
  max,
  passo = 5,
  aviso,
  fracaoDoTeto,
}: {
  valor: number;
  onMudar: (valor: number) => void;
  min: number;
  max: number;
  passo?: number;
  /** "10 contam para a meta; 10 viram XP extra." */
  aviso: string;
  /** Quanto do teto de hoje fica cheio depois do registro, de 0 a 1. */
  fracaoDoTeto: number;
}) {
  // De 5 em 5 a partir do múltiplo mais perto: os pontos da atividade (12, 7)
  // não precisam ser múltiplos do passo, mas o toque seguinte já cai num.
  const menos = Math.max(min, valor % passo === 0 ? valor - passo : valor - (valor % passo));
  const mais = Math.min(max, valor % passo === 0 ? valor + passo : valor + passo - (valor % passo));
  const botao =
    "grid size-12 shrink-0 place-items-center rounded-full bg-ink-800 text-ink-200 " +
    "transition duration-150 active:scale-95 disabled:opacity-40";
  return (
    <div className="flex flex-col gap-3 rounded-dialogo bg-ink-900 p-3.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={botao}
          onClick={() => onMudar(menos)}
          disabled={valor <= min}
          aria-label={`Menos ${passo} pontos`}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-5" fill="none">
            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex flex-col items-center">
          <span className="text-4xl font-extrabold leading-none tabular-nums text-titulo">
            {valor}
          </span>
          <span className="text-miudo text-ink-400">pontos</span>
        </div>
        <button
          type="button"
          className={botao}
          onClick={() => onMudar(mais)}
          disabled={valor >= max}
          aria-label={`Mais ${passo} pontos`}
        >
          <IconeMais className="size-5" />
        </button>
      </div>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-sucesso-500 transition-[width] duration-300"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, fracaoDoTeto)) * 100)}%` }}
        />
      </div>
      <p aria-live="polite" className="text-center text-xs text-ink-400">
        {aviso}
      </p>
    </div>
  );
}
