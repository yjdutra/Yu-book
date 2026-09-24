import { dolaresParaMicros, microsParaDolares } from "@yu-book/shared";
import { ApiError } from "../../lib/api";
import { useAiAjustes, useAtualizarAjustes } from "../../lib/ia";
import { Bloco } from "../base/Bloco";

/** Gasto: o teto do dia. O que já foi gasto hoje está no cabeçalho, sempre à vista. */
export function SecaoGasto({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const ajustes = useAiAjustes();
  const atualizar = useAtualizarAjustes();

  async function aoMudarTeto(valor: string) {
    const dolares = Number(valor);
    if (!Number.isFinite(dolares) || dolares < 0) return;
    onErro(null);
    try {
      await atualizar.mutateAsync({ dailyCapMicros: dolaresParaMicros(dolares) });
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível salvar o teto.");
    }
  }

  return (
    <Bloco titulo="Teto de gasto">
      <div className="flex flex-col gap-2 px-4 py-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-ink-400">Teto por dia, em dólares</span>
          <input
            // A chave remonta o campo quando o valor salvo chega: `defaultValue`
            // só vale na primeira pintura, e ela pode acontecer antes dos dados.
            key={ajustes.data?.dailyCapMicros ?? "carregando"}
            type="number"
            min="0"
            step="0.05"
            defaultValue={
              ajustes.data ? microsParaDolares(ajustes.data.dailyCapMicros).toFixed(2) : ""
            }
            onBlur={(e) => void aoMudarTeto(e.target.value)}
            aria-label="Teto de gasto por dia, em dólares"
            className="w-24 rounded-controle border border-ink-700 bg-superficie px-2 py-1
                       text-ink-200 outline-none focus:border-accent-400"
          />
          {atualizar.isPending && <span className="animate-pulse text-ink-400">salvando…</span>}
        </label>
        <p className="text-ink-400">
          Chegando ao teto, as funções de IA param até o dia virar — o resto do Yu-book segue
          normal.
        </p>
        {ajustes.data && (
          <p className="text-miudo text-ink-400">
            O dia vira à meia-noite de {ajustes.data.timezone}.
          </p>
        )}
      </div>
    </Bloco>
  );
}
