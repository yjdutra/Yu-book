import type { ReactNode } from "react";

/**
 * Um item do "Criado nesta resposta" (Etapa C da IA): o que o chat gravou no
 * acervo ou na agenda, num cartão compacto — ícone do tipo, título, o tipo por
 * extenso com o quando, e as ações à direita (Desfazer, sempre; abrir, quando
 * há onde).
 *
 * Desfeito, o título fica riscado **e** diz "desfeito" por extenso (RNF-09 da
 * IA: o estado não é só o risco), e as ações somem — quem usa as tira.
 *
 * `onAbrir` transforma título e tipo num botão só; sem ele, são texto. O que abrir
 * significa é de quem usa: o web navega, o móvel abre a folha.
 */
export function CartaoCriado({
  icone,
  tipo,
  titulo,
  quando,
  desfeito = false,
  rotuloDesfeito,
  onAbrir,
  rotuloAbrir,
  acoes,
}: {
  icone: ReactNode;
  /** "nota", "card", "evento", "tarefa" — por extenso, ao lado do ícone. */
  tipo: string;
  titulo: string;
  quando?: ReactNode;
  desfeito?: boolean;
  /** "nota desfeita" — o estado por extenso. */
  rotuloDesfeito: string;
  onAbrir?: () => void;
  /** A dica do título que abre ("Abrir a nota"). */
  rotuloAbrir?: string;
  acoes?: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 rounded-cartao border px-2.5 py-2 ${
        desfeito
          ? "border-dashed border-ink-700 bg-transparent"
          : "border-ink-700/70 bg-superficie shadow-e1"
      }`}
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-controle ${
          desfeito ? "bg-ink-800 text-ink-400" : "bg-accent-500/12 text-accent-400"
        }`}
      >
        {icone}
      </span>
      <div className="min-w-0 flex-1">
        {!desfeito && onAbrir ? (
          // O botão leva as duas linhas: alvo de toque da altura do cartão.
          <button
            type="button"
            onClick={onAbrir}
            title={rotuloAbrir}
            className="group/abrir block min-h-11 w-full min-w-0 rounded-etiqueta text-left"
          >
            <span
              className="block truncate text-sm font-medium text-ink-200 underline
                         decoration-accent-400/40 underline-offset-2 transition-colors
                         group-hover/abrir:text-titulo group-hover/abrir:decoration-accent-400"
            >
              {titulo}
            </span>
            <span className="block truncate text-miudo text-ink-400">
              {tipo}
              {quando && <> · {quando}</>}
            </span>
          </button>
        ) : (
          <>
            <p
              className={`truncate text-sm ${
                desfeito ? "text-ink-400 line-through" : "font-medium text-ink-200"
              }`}
            >
              {titulo}
            </p>
            <p className="truncate text-miudo text-ink-400">
              {desfeito ? rotuloDesfeito : tipo}
              {!desfeito && quando && <> · {quando}</>}
            </p>
          </>
        )}
      </div>
      {!desfeito && acoes}
    </div>
  );
}
