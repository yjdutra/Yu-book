import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Botão — primeiro primitivo do redesenho de UI (Etapa 1).
 *
 * Até aqui o projeto decidia manter `Button` inexistente e cada tela copiava as
 * classes à mão. As cópias divergiram em raio, altura e hover — sete botões
 * primários, cinco desenhos. A decisão foi revogada: o redesenho precisa de um
 * vocabulário só, e ele mora em `components/base/`.
 *
 * O foco visível vem do `:focus-visible` global (RNF-08); nada aqui o remove.
 */

export type VarianteBotao = "primario" | "secundario" | "fantasma" | "perigo" | "ia";

const VARIANTE: Record<VarianteBotao, string> = {
  primario: "bg-accent-500 text-white shadow-e1 hover:bg-accent-400",
  secundario:
    `border border-ink-700 bg-superficie text-ink-200 shadow-e1 hover:border-ink-400
     hover:text-titulo`,
  fantasma: "text-ink-400 hover:bg-ink-800 hover:text-ink-200",
  perigo: "border border-red-500/40 text-red-300 hover:bg-red-500/15",
  ia: "bg-linear-to-r from-accent-500 to-ia-500 text-white shadow-e1 hover:shadow-brilho-ia",
};

const TAMANHO = {
  p: "h-7 gap-1.5 px-2.5 text-xs",
  m: "h-8 gap-2 px-3 text-sm",
} as const;

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao;
  tamanho?: keyof typeof TAMANHO;
  icone?: ReactNode;
  /** Desabilita e troca o ícone por um ponto pulsando; o texto fica. */
  carregando?: boolean;
};

export function Botao({
  variante = "secundario",
  tamanho = "p",
  icone,
  carregando = false,
  className = "",
  type = "button",
  disabled,
  children,
  ...resto
}: BotaoProps) {
  return (
    <button
      type={type}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-controle font-medium
                  transition duration-[120ms] ease-(--ease-padrao)
                  disabled:cursor-not-allowed disabled:opacity-50
                  ${VARIANTE[variante]} ${TAMANHO[tamanho]} ${className}`}
      {...resto}
    >
      {carregando ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      ) : (
        icone
      )}
      {children}
    </button>
  );
}

type BotaoIconeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Vira o nome acessível e a dica — botão só de ícone não fica sem nome. */
  rotulo: string;
  icone: ReactNode;
  variante?: Extract<VarianteBotao, "fantasma" | "secundario">;
  /**
   * Tamanho é prop, não `className`: o Tailwind ordena utilitários da mesma
   * propriedade pelo nome, e um `size-6` vindo de fora perde para o `size-7`
   * daqui sem aviso. Pelo mesmo motivo, a cor vai no ícone, não no botão.
   */
  tamanho?: keyof typeof TAMANHO_ICONE;
};

const TAMANHO_ICONE = { p: "size-6", m: "size-7", g: "size-10" } as const;

export function BotaoIcone({
  rotulo,
  icone,
  variante = "fantasma",
  tamanho = "m",
  className = "",
  type = "button",
  ...resto
}: BotaoIconeProps) {
  return (
    <button
      type={type}
      aria-label={rotulo}
      title={rotulo}
      className={`inline-flex ${TAMANHO_ICONE[tamanho]} shrink-0 items-center justify-center rounded-controle
                  transition duration-[120ms] ease-(--ease-padrao)
                  disabled:cursor-not-allowed disabled:opacity-50
                  ${VARIANTE[variante]} ${className}`}
      {...resto}
    >
      {icone}
    </button>
  );
}
