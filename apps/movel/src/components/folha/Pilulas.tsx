import { IconeCheck } from "@yu-book/cliente/icones";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Um grupo de atalhos da folha: escolher um entre poucos com um toque. É o
 * controle segmentado do projeto (`role="group"` e `aria-pressed`, como o
 * `SeletorModo` do web), em pílulas que quebram linha, porque no celular as
 * opções não cabem num trilho só. A escolhida muda de forma — preenchida e com
 * o check —, não só de cor (RNF-09).
 */
export function GrupoPilulas({
  rotulo,
  erro,
  rodape,
  children,
}: {
  rotulo: string;
  /** Erro do campo (422 ou conferência local), dito ao lado do grupo. */
  erro?: string | null;
  /** O que a escolha resultou, por extenso ("sexta-feira, 10 de outubro"). */
  rodape?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <h3 id={`${id}-r`} className="rotulo">
        {rotulo}
      </h3>
      <div
        role="group"
        aria-labelledby={`${id}-r`}
        aria-describedby={erro ? `${id}-e` : undefined}
        className="mt-2 flex flex-wrap gap-2"
      >
        {children}
      </div>
      {rodape && <p className="mt-2 text-xs text-ink-400">{rodape}</p>}
      {erro && <ErroDoCampo id={`${id}-e`}>{erro}</ErroDoCampo>}
    </div>
  );
}

/** O texto de erro sob um campo: glifo e cor, nunca só a cor. */
export function ErroDoCampo({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-red-300">
      <span aria-hidden="true" className="font-semibold">
        !
      </span>
      {children}
    </p>
  );
}

const PILULA = `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium
  transition duration-150 ease-(--ease-padrao) active:scale-[0.97]`;
const ATIVA = "border-accent-500 bg-accent-500 text-white shadow-e1";
const INATIVA = "border-ink-700 bg-ink-900 text-ink-200 hover:border-ink-400 hover:text-titulo";

export function Pilula({
  ativa,
  onClick,
  disabled,
  rotuloAcessivel,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Quando o texto à vista é curto demais ("Sáb") para dizer a data. */
  rotuloAcessivel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      aria-label={rotuloAcessivel}
      onClick={onClick}
      disabled={disabled}
      className={`${PILULA} ${ativa ? ATIVA : INATIVA} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {ativa && <IconeCheck className="-ml-1 size-4" />}
      {children}
    </button>
  );
}

/**
 * A pílula "Escolher" aberta: o seletor nativo do sistema (`date` ou `time`),
 * com a aparência da pílula ativa. Nativo de propósito — no Android ele abre a
 * roda do sistema, que é o que o polegar conhece, e sai de graça com a
 * acessibilidade do aparelho. Abre o seletor sozinho quando nasce de um toque.
 */
export function PilulaEscolher({
  tipo,
  valor,
  onEscolher,
  rotulo,
  abrirAoNascer,
}: {
  tipo: "date" | "time";
  valor: string;
  onEscolher: (valor: string) => void;
  rotulo: string;
  abrirAoNascer: boolean;
}) {
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abrirAoNascer) return;
    const el = campo.current;
    if (!el) return;
    el.focus();
    // `showPicker` exige ativação do usuário — o toque que trouxe a pílula
    // ainda vale. Onde não houver, o foco no campo já basta.
    try {
      el.showPicker?.();
    } catch {
      // Navegador sem ativação aceita: fica o campo focado.
    }
    // Só no nascimento: reabrir a cada render prenderia o seletor na tela.
  }, []);

  return (
    <input
      ref={campo}
      type={tipo}
      value={valor}
      aria-label={rotulo}
      onChange={(e) => {
        if (e.target.value) onEscolher(e.target.value);
      }}
      // `color-scheme: dark`: o ícone do seletor sai claro, legível sobre o
      // acento nos dois temas.
      className={`${PILULA} ${ATIVA} font-semibold [color-scheme:dark]`}
    />
  );
}
