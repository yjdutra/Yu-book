import { useId } from "react";
import type { ReactNode } from "react";

/**
 * Uma seção de formulário com a descrição que ensina o campo. Nasceu local no
 * editor de agentes (Etapa D da IA) e subiu para cá na Etapa E, pensando no
 * painel de configuração do editor de rotinas — que acabou com `<section>`
 * próprio, mais compacto. Hoje o único consumidor é o editor de agentes.
 *
 * Sem `overflow-hidden`, ao contrário do `Bloco`: a lista do seletor de nota e
 * os menus abrem para fora da seção, e seriam cortados.
 */
export function Parte({
  titulo,
  descricao,
  acao,
  variante = "padrao",
  children,
}: {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  variante?: "padrao" | "ia";
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="relative min-w-0 rounded-cartao border border-ink-800 bg-superficie shadow-e1"
    >
      {variante === "ia" && (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <header className="flex items-start gap-2 border-b border-ink-800 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="rotulo">
            {titulo}
          </h3>
          {descricao && <p className="mt-0.5 text-xs text-ink-400">{descricao}</p>}
        </div>
        {acao && <span className="shrink-0">{acao}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
