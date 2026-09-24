import type { ReactNode } from "react";
import { Etiqueta } from "../base/Etiqueta";
import { contexto, emDolares, provedorDe } from "./comum";

/** O que o cartão precisa saber — serve ao favorito e ao modelo do catálogo. */
export interface ModeloDoCartao {
  id: string;
  name: string;
  contextLength: number;
  promptMicros: number;
  completionMicros: number;
  supportsTools: boolean;
  free: boolean;
}

/**
 * Um modelo em forma de cartão (redesenho de UI, Etapa 4): o mesmo desenho nas
 * colunas do quadro de modelos e no `DragOverlay` que acompanha o ponteiro.
 *
 * `alca` e `acoes` são encaixes, e não parte do cartão, por uma razão de
 * teclado: os ouvintes do arraste moram só na alça. Um botão de menu dentro do
 * mesmo nó receberia o Espaço como "pegar", e deixaria de abrir.
 */
export function CartaoModelo({
  modelo,
  alca,
  acoes,
  rodape,
  destaque = false,
  className = "",
}: {
  modelo: ModeloDoCartao;
  alca?: ReactNode;
  acoes?: ReactNode;
  rodape?: ReactNode;
  /** O modelo que está numa tarefa: borda de IA e mais elevação. */
  destaque?: boolean;
  className?: string;
}) {
  const provedor = provedorDe(modelo.id);
  return (
    <div
      className={`relative rounded-cartao border bg-superficie p-3 ${
        destaque ? "border-accent-500/50 shadow-e2" : "border-ink-800 shadow-e1"
      } ${className}`}
    >
      {destaque && (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <div className="flex items-start gap-2">
        {alca}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-titulo" title={modelo.name}>
            {modelo.name}
          </p>
          {provedor && <p className="truncate text-miudo text-ink-400">{provedor}</p>}
        </div>
        {acoes}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {/* RNF-07: etiqueta de texto, nunca só cor. */}
        {modelo.supportsTools && <Etiqueta tom="destaque">ferramentas</Etiqueta>}
        {modelo.free && <Etiqueta>grátis</Etiqueta>}
        <Etiqueta>{contexto(modelo.contextLength)}</Etiqueta>
      </div>

      <p className="mt-2 text-miudo tabular-nums text-ink-400">
        {emDolares(modelo.promptMicros)} entrada · {emDolares(modelo.completionMicros)} saída
        <span className="sr-only"> por milhão de tokens</span>
        <span aria-hidden="true"> /M</span>
      </p>

      {rodape}
    </div>
  );
}
