import { useId } from "react";
import type { ReactNode } from "react";

/**
 * Interruptor liga/desliga (Etapa D da IA, com o editor de agentes como
 * primeiro consumidor).
 *
 * É um `<button role="switch">`, e não uma caixa de marcar estilizada: Espaço e
 * Enter alternam de graça, e o leitor de tela anuncia "ligado"/"desligado".
 * O estado não mora só na cor nem só na posição do botão (RNF-09): a palavra
 * "ligado"/"desligado" aparece ao lado, visível. O rótulo e a descrição são o
 * nome e a descrição acessíveis — clicar no texto também alterna.
 */
export function Interruptor({
  ligado,
  onMudar,
  rotulo,
  descricao,
  extra,
  desabilitado = false,
}: {
  ligado: boolean;
  onMudar: (ligado: boolean) => void;
  rotulo: ReactNode;
  descricao?: ReactNode;
  /** Ao lado do rótulo — um selo, uma etiqueta. Fora do nome acessível. */
  extra?: ReactNode;
  desabilitado?: boolean;
}) {
  const id = useId();
  const idRotulo = `${id}-rotulo`;
  const idDescricao = `${id}-descricao`;

  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-labelledby={idRotulo}
        aria-describedby={descricao ? idDescricao : undefined}
        disabled={desabilitado}
        onClick={() => onMudar(!ligado)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border
                    transition-colors duration-[120ms] ease-(--ease-padrao)
                    disabled:cursor-not-allowed disabled:opacity-50 ${
                      ligado
                        ? "border-transparent bg-linear-to-r from-accent-500 to-ia-500"
                        : "border-ink-700 bg-ink-800"
                    }`}
      >
        <span
          aria-hidden="true"
          className={`absolute size-3.5 rounded-full shadow-e1 transition-transform
                      duration-[160ms] ease-(--ease-saida) ${
                        ligado ? "translate-x-[18px] bg-white" : "translate-x-[2px] bg-ink-400"
                      }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={id} id={idRotulo} className="cursor-pointer text-sm text-ink-200">
            {rotulo}
          </label>
          {extra}
          <span aria-hidden="true" className="text-miudo text-ink-400">
            {ligado ? "ligado" : "desligado"}
          </span>
        </div>
        {descricao && (
          <p id={idDescricao} className="mt-0.5 text-xs text-ink-400">
            {descricao}
          </p>
        )}
      </div>
    </div>
  );
}
