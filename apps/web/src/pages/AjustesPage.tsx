import type { AiModel, AiTask } from "@yu-book/shared";
import { dolaresParaMicros, microsParaDolares } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../lib/api";
import {
  useAiAjustes,
  useAiModelos,
  useAiSaude,
  useAtualizarAjustes,
  useDefinirModeloDaTarefa,
  useDesfavoritar,
  useFavoritar,
} from "../lib/ia";

/**
 * Ajustes de IA — a única tela de configuração do Yu-book.
 *
 * Os três blocos aparecem sempre juntos e vêm de uma requisição só, pelo mesmo
 * raciocínio da gaveta de links.
 *
 * O cartão é copiado do dashboard, não extraído: os dois vão divergir, e
 * extrair mexeria numa tela que não tem nada a ver com esta. É a mesma decisão
 * que mantém `Button` e `Modal` inexistentes neste projeto.
 */

const TAREFA: AiTask = "formatar";

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-ink-700 bg-ink-900/40">
      <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-400">{titulo}</h3>
      </header>
      {children}
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm text-ink-400">{texto}</p>
    </div>
  );
}

const DINHEIRO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function emDolares(micros: number): string {
  return DINHEIRO.format(microsParaDolares(micros));
}

/** Contexto em milhares, como o provedor costuma anunciar. */
function contexto(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

export function AjustesPage() {
  const saude = useAiSaude();
  const ajustes = useAiAjustes();
  const favoritar = useFavoritar();
  const desfavoritar = useDesfavoritar();
  const definirTarefa = useDefinirModeloDaTarefa();
  const atualizar = useAtualizarAjustes();

  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [soFerramentas, setSoFerramentas] = useState(false);
  const [indice, setIndice] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // Mesma espera da paleta: sem ela, a busca sai a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 200);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => setIndice(0), [termo, soFerramentas]);

  const catalogo = useAiModelos(termo, soFerramentas);
  const modelos = catalogo.data?.items ?? [];

  // Mantém o item destacado visível, como na paleta.
  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${indice}"]`)?.scrollIntoView({ block: "nearest" });
  }, [indice]);

  const favoritos = ajustes.data?.favorites ?? [];
  const escolhido = ajustes.data?.taskModels[TAREFA] ?? "";

  async function aoFavoritar(modelo: AiModel) {
    setErro(null);
    try {
      await favoritar.mutateAsync(modelo.id);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível favoritar este modelo.");
    }
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (modelos.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((i) => (i + passo + modelos.length) % modelos.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const alvo = modelos[indice];
      if (alvo) void aoFavoritar(alvo);
    }
  }

  async function aoMudarTeto(valor: string) {
    const dolares = Number(valor);
    if (!Number.isFinite(dolares) || dolares < 0) return;
    setErro(null);
    try {
      await atualizar.mutateAsync({ dailyCapMicros: dolaresParaMicros(dolares) });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o teto.");
    }
  }

  const uso = ajustes.data?.usage;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">
      <header>
        <h2 className="text-lg font-semibold text-titulo">Ajustes de IA</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          As funções de IA usam um provedor de nuvem. <strong className="text-ink-200">
          O conteúdo da nota sai da sua máquina</strong> quando você usa uma delas — o servidor pede
          ao provedor que não guarde o texto para treino, mas a nota é enviada.
        </p>
      </header>

      {erro && (
        <p role="alert" className="flex items-center gap-2 rounded bg-red-500/15 px-3 py-2 text-xs
                                   text-red-200 ring-1 ring-red-500/30">
          {erro}
          <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso"
                  className="ml-auto rounded px-1 text-red-300">
            ×
          </button>
        </p>
      )}

      <Bloco titulo="Provedor">
        <div className="px-4 py-3 text-sm">
          {saude.isLoading && <span className="animate-pulse text-ink-400">Verificando…</span>}
          {saude.data && !saude.data.configured && (
            // RNF-03: sem chave, o resto do app funciona igual.
            <p role="alert" className="text-xs text-amber-300">
              Nenhuma chave configurada no servidor. Defina <code>OPENROUTER_API_KEY</code> no
              ambiente da API para habilitar as funções de IA. O resto do Yu-book funciona normal.
            </p>
          )}
          {saude.data?.configured && (
            <p className="text-ink-200">
              {saude.data.reachable ? "Conectado" : "Chave configurada, mas o provedor não respondeu"}
              {/* O rótulo padrão do provedor é o próprio prefixo da chave. Mostrar
                  isso põe um pedaço de segredo na tela — e em todo screenshot que
                  alguém tirar dela. Só aparece rótulo que a pessoa nomeou. */}
              {saude.data.label && !/^sk-/i.test(saude.data.label) && (
                <span className="text-ink-400"> · {saude.data.label}</span>
              )}
            </p>
          )}
        </div>
      </Bloco>

      <Bloco titulo="Modelos">
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Buscar no catálogo do provedor"
              aria-label="Buscar modelo"
              role="combobox"
              aria-expanded={modelos.length > 0}
              aria-controls="ia-catalogo"
              className="min-w-0 flex-1 rounded bg-ink-800 px-2 py-1 text-xs text-ink-200 outline-none
                         placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
            />
            <label className="flex items-center gap-1 text-xs text-ink-400">
              <input
                type="checkbox"
                checked={soFerramentas}
                onChange={(e) => setSoFerramentas(e.target.checked)}
              />
              só com ferramentas
            </label>
          </div>

          {catalogo.data?.stale && (
            <p className="text-xs text-amber-300">
              O provedor não respondeu agora; esta lista é a última que conseguimos.
            </p>
          )}

          <ul id="ia-catalogo" ref={listaRef} role="listbox" aria-label="Modelos do catálogo"
              className="max-h-64 overflow-y-auto">
            {modelos.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === indice}
                  data-indice={i}
                  onMouseEnter={() => setIndice(i)}
                  onClick={() => void aoFavoritar(m)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs
                              ${i === indice ? "border-l-2 border-accent-400 bg-ink-700/70" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-ink-200">{m.name}</span>
                  {/* RNF-07: etiqueta de texto, nunca só cor. É a informação de
                      que o chat vai depender para escolher modelo. */}
                  {m.supportsTools && <span className="text-[10px] text-emerald-300">ferramentas</span>}
                  {m.free && <span className="text-[10px] text-sky-300">grátis</span>}
                  <span className="tabular-nums text-ink-400">{contexto(m.contextLength)}</span>
                  <span className="tabular-nums text-ink-400">
                    {emDolares(m.promptMicros)}/M
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {catalogo.data && modelos.length === 0 && <Vazio texto={`Nenhum modelo com «${termo}».`} />}
          {catalogo.data && (
            <p className="text-[10px] text-ink-400">
              {modelos.length} de {catalogo.data.total}
            </p>
          )}
        </div>
      </Bloco>

      <Bloco titulo="Seus modelos">
        {favoritos.length === 0 ? (
          <Vazio texto="Nenhum favorito ainda. Busque no catálogo acima e clique para favoritar." />
        ) : (
          <ul className="px-4 py-2">
            {favoritos.map((f) => (
              <li key={f.favoriteId} className="flex items-center gap-2 py-1 text-xs">
                <input
                  type="radio"
                  name="modelo-formatar"
                  checked={escolhido === f.id}
                  onChange={() => void definirTarefa.mutateAsync({ task: TAREFA, modelId: f.id })}
                  aria-label={`Usar ${f.name} para formatar notas`}
                />
                <span className="min-w-0 flex-1 truncate text-ink-200">{f.name}</span>
                {f.supportsTools && <span className="text-[10px] text-emerald-300">ferramentas</span>}
                <span className="tabular-nums text-ink-400">{emDolares(f.promptMicros)}/M</span>
                <button
                  type="button"
                  onClick={() => void desfavoritar.mutateAsync(f.favoriteId)}
                  aria-label={`Remover ${f.name} dos favoritos`}
                  className="rounded px-1 text-ink-400 hover:text-ink-200"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 pb-3 text-[10px] text-ink-400">
          O modelo marcado é o que o botão de formatar nota usa.
        </p>
      </Bloco>

      <Bloco titulo="Gasto">
        <div className="flex flex-col gap-2 px-4 py-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-ink-400">Teto por dia, em dólares</span>
            <input
              type="number"
              min="0"
              step="0.05"
              defaultValue={
                ajustes.data ? microsParaDolares(ajustes.data.dailyCapMicros).toFixed(2) : ""
              }
              onBlur={(e) => void aoMudarTeto(e.target.value)}
              aria-label="Teto de gasto por dia, em dólares"
              className="w-24 rounded bg-ink-800 px-2 py-1 text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            />
            {atualizar.isPending && (
              <span className="animate-pulse text-ink-400">salvando…</span>
            )}
          </label>

          {uso && ajustes.data && (
            <>
              <p className="text-ink-200">
                Hoje: <span className="tabular-nums">{emDolares(uso.spentMicros)}</span> de{" "}
                <span className="tabular-nums">{emDolares(ajustes.data.dailyCapMicros)}</span>
              </p>
              {uso.callsWithoutCostToday > 0 && (
                // Sem esta linha o teto mente calado: chamada de custo zero não
                // move a soma do dia.
                <p className="text-amber-300">
                  {uso.callsWithoutCostToday} chamada(s) hoje sem custo informado pelo provedor —
                  elas não entram na soma acima.
                </p>
              )}
              <p className="text-[10px] text-ink-400">
                O dia vira à meia-noite de {ajustes.data.timezone}.
              </p>
            </>
          )}
        </div>
      </Bloco>
    </main>
  );
}
