import type { ReactNode } from "react";

/**
 * Um número com o nome em cima — o gasto da chave, o saldo, cada métrica do
 * painel do OpenRouter. Vai dentro de um `<dl>`: o nome é o termo, o valor a
 * definição, e o leitor de tela lê os dois juntos.
 */
export function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  detalhe?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="rotulo">{rotulo}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-titulo">{valor}</dd>
      {detalhe && <dd className="mt-0.5 text-miudo text-ink-400">{detalhe}</dd>}
    </div>
  );
}
