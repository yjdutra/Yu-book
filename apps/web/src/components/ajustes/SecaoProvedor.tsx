import { ApiError } from "../../lib/api";
import { useAiAjustes, useAiSaude, useAtualizarAjustes } from "../../lib/ia";
import { Bloco } from "../base/Bloco";

/** Provedor: a conexão e o que ele pode fazer com o conteúdo enviado. */
export function SecaoProvedor({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const saude = useAiSaude();
  const ajustes = useAiAjustes();
  const atualizar = useAtualizarAjustes();

  async function aoMudarTreino(permitir: boolean) {
    onErro(null);
    try {
      await atualizar.mutateAsync({ allowTraining: permitir });
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível salvar a política de dados.");
    }
  }

  return (
    <Bloco titulo="Provedor">
      <div className="px-4 py-3 text-sm">
        {saude.isLoading && <span className="animate-pulse text-ink-400">Verificando…</span>}
        {saude.data && !saude.data.configured && (
          // O aviso completo (RNF-03) está no cabeçalho, visível em toda seção.
          <p className="text-ink-400">Sem chave configurada.</p>
        )}
        {saude.data?.configured && (
          <p className="flex items-center gap-2 text-ink-200">
            {/* Estado com texto, e o ponto só acompanha (RNF-09). */}
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                saude.data.reachable ? "bg-emerald-300" : "bg-amber-300"
              }`}
            />
            {saude.data.reachable ? "Conectado" : "Chave configurada, mas o provedor não respondeu"}
            {/* O rótulo padrão do provedor é o próprio prefixo da chave. Mostrar
                isso põe um pedaço de segredo na tela — e em todo screenshot que
                alguém tirar dela. Só aparece rótulo que a pessoa nomeou. */}
            {saude.data.label && !/^sk-/i.test(saude.data.label) && (
              <span className="text-ink-400"> · {saude.data.label}</span>
            )}
          </p>
        )}

        {/* A consequência está escrita nos DOIS estados de propósito: a tela
            antes prometia a proteção sem dizer que ela é o que torna os
            modelos gratuitos inalcançáveis. */}
        <label className="mt-3 flex items-start gap-2 border-t border-ink-800 pt-3 text-xs">
          <input
            type="checkbox"
            checked={ajustes.data?.allowTraining ?? false}
            onChange={(e) => void aoMudarTreino(e.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="text-ink-200">Permitir que o provedor treine com o conteúdo</span>
            <span className="mt-0.5 block text-ink-400">
              {ajustes.data?.allowTraining
                ? "Modelos gratuitos ficam disponíveis. O provedor pode guardar o conteúdo das " +
                  "suas notas e treinar com ele."
                : "O servidor pede ao provedor que não guarde o texto para treino. Modelos " +
                  "gratuitos ficam indisponíveis — os endpoints deles treinam com os dados."}
            </span>
          </span>
        </label>
      </div>
    </Bloco>
  );
}
