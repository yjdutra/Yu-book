import type { AiHealth, AiProvider } from "@yu-book/shared";
import { ApiError } from "@yu-book/cliente/api";
import { useAiAjustes, useAiSaude, useAtualizarAjustes } from "../../lib/ia";
import { Bloco } from "@yu-book/cliente/base/Bloco";

const PROVEDORES: { provider: AiProvider; nome: string; variavel: string; nota: string }[] = [
  {
    provider: "anthropic",
    nome: "Anthropic",
    variavel: "ANTHROPIC_API_KEY",
    nota: "Chave do Console (platform.claude.com), onde caem os créditos mensais do plano.",
  },
  {
    provider: "openrouter",
    nome: "OpenRouter",
    variavel: "OPENROUTER_API_KEY",
    nota: "Centenas de modelos de vários donos, cobrados na conta do OpenRouter.",
  },
];

/** Uma linha de conexão: o estado em texto, e o ponto só o acompanha (RNF-09). */
function Conexao({
  nome,
  variavel,
  nota,
  saude,
  carregando,
}: {
  nome: string;
  variavel: string;
  nota: string;
  saude: AiHealth | undefined;
  carregando: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-ink-200">{nome}</p>
        <p className="text-miudo text-ink-400">{nota}</p>
      </div>
      <div className="shrink-0 text-right text-xs">
        {carregando && <span className="animate-pulse text-ink-400">Verificando…</span>}
        {saude && !saude.configured && (
          <span className="text-ink-400">
            Sem chave — defina <code>{variavel}</code>
          </span>
        )}
        {saude?.configured && (
          <span className="flex items-center justify-end gap-2 text-ink-200">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                saude.reachable ? "bg-emerald-300" : "bg-amber-300"
              }`}
            />
            {saude.reachable ? "Conectado" : "Chave configurada, mas não respondeu"}
            {/* O rótulo padrão do OpenRouter é o próprio prefixo da chave.
                Mostrar isso põe um pedaço de segredo na tela — e em todo
                screenshot que alguém tirar dela. Só aparece rótulo nomeado. */}
            {saude.label && !/^sk-/i.test(saude.label) && (
              <span className="text-ink-400"> · {saude.label}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Provedores: as duas conexões e o que o OpenRouter pode fazer com o conteúdo.
 * O provedor segue o modelo (docs/plano-provedor-anthropic.md) — cada chave
 * serve aos modelos do seu catálogo, e as duas podem coexistir.
 */
export function SecaoProvedor({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const anthropic = useAiSaude("anthropic");
  const openrouter = useAiSaude("openrouter");
  const ajustes = useAiAjustes();
  const atualizar = useAtualizarAjustes();
  const saudes = { anthropic, openrouter };

  async function aoMudarTreino(permitir: boolean) {
    onErro(null);
    try {
      await atualizar.mutateAsync({ allowTraining: permitir });
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível salvar a política de dados.");
    }
  }

  return (
    <Bloco titulo="Provedores">
      <div className="divide-y divide-ink-800 px-4 py-1 text-sm">
        {PROVEDORES.map((p) => (
          <Conexao
            key={p.provider}
            nome={p.nome}
            variavel={p.variavel}
            nota={p.nota}
            saude={saudes[p.provider].data}
            carregando={saudes[p.provider].isLoading}
          />
        ))}

        {/* A consequência está escrita nos DOIS estados de propósito: a tela
            antes prometia a proteção sem dizer que ela é o que torna os
            modelos gratuitos inalcançáveis. Pelos termos comerciais, a API da
            Anthropic não treina com o que recebe; a escolha é só do OpenRouter. */}
        <label className="flex items-start gap-2 py-3 text-xs">
          <input
            type="checkbox"
            checked={ajustes.data?.allowTraining ?? false}
            onChange={(e) => void aoMudarTreino(e.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="text-ink-200">
              Permitir que o OpenRouter treine com o conteúdo
            </span>
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
