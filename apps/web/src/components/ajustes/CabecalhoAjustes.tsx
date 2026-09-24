import { useAiAjustes, useAiSaude } from "../../lib/ia";
import { Aviso } from "../base/Aviso";
import { emDolares } from "./comum";

/**
 * O que `/ajustes` diz em qualquer seção: que o conteúdo sai da máquina, e
 * quanto já foi gasto hoje. Nenhuma das duas coisas pode ficar escondida atrás
 * de uma aba.
 */
export function CabecalhoAjustes({
  erro,
  onFecharErro,
}: {
  erro: string | null;
  onFecharErro: () => void;
}) {
  const { data: ajustes } = useAiAjustes();
  const { data: saude } = useAiSaude();
  const uso = ajustes?.usage;
  const fracao =
    uso && ajustes && ajustes.dailyCapMicros > 0
      ? Math.min(uso.spentMicros / ajustes.dailyCapMicros, 1)
      : 0;

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight text-titulo">Ajustes de IA</h2>
          <p className="mt-1 max-w-2xl text-xs text-ink-400">
            As funções de IA usam um provedor de nuvem.{" "}
            <strong className="text-ink-200">O conteúdo da nota sai da sua máquina</strong> quando
            você usa uma delas. O que o provedor pode fazer com esse conteúdo se escolhe em
            Provedor.
          </p>
        </div>

        {uso && ajustes && (
          <div
            className="w-56 shrink-0 rounded-cartao border border-ink-800 bg-superficie p-3
                       shadow-e1"
          >
            <p className="rotulo">Gasto de hoje</p>
            {/* O texto é o dado; a barra só o desenha (RNF-09). */}
            <p className="mt-1 text-sm tabular-nums text-ink-200">
              {emDolares(uso.spentMicros)}
              <span className="text-ink-400"> de {emDolares(ajustes.dailyCapMicros)}</span>
            </p>
            <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-linear-to-r from-accent-500 to-ia-500"
                style={{ width: `${fracao * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {saude && !saude.configured && (
        // RNF-03: sem chave, o resto do app funciona igual — e isso é dito em
        // qualquer seção, não só na do provedor: escolher modelos sem saber
        // que nada vai rodar é trabalho jogado fora.
        <Aviso tom="alerta" urgente>
          Nenhuma chave configurada no servidor. Defina <code>OPENROUTER_API_KEY</code> no
          ambiente da API para habilitar as funções de IA. O resto do Yu-book funciona normal.
        </Aviso>
      )}

      {uso && uso.callsWithoutCostToday > 0 && (
        // Sem esta linha o teto mente calado: chamada de custo zero não move a
        // soma do dia.
        <Aviso tom="alerta">
          {uso.callsWithoutCostToday} chamada(s) hoje sem custo informado pelo provedor — elas não
          entram na soma do gasto.
        </Aviso>
      )}

      {erro && (
        <Aviso tom="erro" onFechar={onFecharErro}>
          {erro}
        </Aviso>
      )}
    </header>
  );
}
