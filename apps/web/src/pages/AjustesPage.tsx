import type { AiModel, AiModelIndices, AiModelSort, AiTask } from "@yu-book/shared";
import {
  AI_TASKS,
  dolaresParaMicros,
  FAIXAS_DE_PRECO_MICROS,
  microsParaDolares,
} from "@yu-book/shared";
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

/**
 * Uma coluna de escolha por tarefa de IA.
 *
 * **Derivado de `AI_TASKS`, e não escrito à mão.** A Etapa B acrescentou a
 * tarefa `chat` ao enum e ao servidor, e esta tela continuou com `formatar`
 * fixo numa constante — resultado: o chat exigia um modelo que não havia por
 * onde escolher, e a mensagem mandava o usuário para uma tela que não tinha o
 * controle. Derivando da lista, a próxima tarefa aparece aqui sozinha.
 */
const ROTULO_DA_TAREFA: Record<AiTask, { titulo: string; usa: string }> = {
  formatar: { titulo: "formatar", usa: "o botão de formatar nota" },
  chat: { titulo: "chat", usa: "o painel de conversa (Ctrl+Shift+Y)" },
};

/// Tarefas que só funcionam com modelo capaz de chamar ferramenta. O chat sem
/// isso conversa bem e não consegue consultar o acervo — e falharia no meio,
/// depois de a chamada já ter sido paga.
const EXIGE_FERRAMENTA: ReadonlySet<AiTask> = new Set<AiTask>(["chat"]);

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

/**
 * Índices de qualidade de terceiro, quando existem.
 *
 * Cobertura baixa de propósito visível: menos de 40% dos modelos têm medição, e
 * **quem não tem não ganha etiqueta nenhuma** — ausência quer dizer "não
 * medido", não "ruim". Desenhar um zero ali seria inventar uma nota.
 */
function Indices({ indices }: { indices: AiModelIndices | null }) {
  if (!indices) return null;
  const partes = [
    indices.intelligence !== null ? `int ${Math.round(indices.intelligence)}` : null,
    indices.coding !== null ? `cod ${Math.round(indices.coding)}` : null,
    indices.agentic !== null ? `agt ${Math.round(indices.agentic)}` : null,
  ].filter(Boolean);

  if (partes.length === 0) return null;
  return <span className="text-[10px] tabular-nums text-ink-400">{partes.join(" · ")}</span>;
}

const FAIXAS: { rotulo: string; teto: number | null }[] = [
  /// Teto sobre o preço de **entrada**, que é o que domina ao formatar uma
  /// nota. Medido em 2026-09-23: nenhum dos 348 tem entrada grátis com saída
  /// paga, então este chip e a etiqueta `grátis` da linha coincidem hoje.
  { rotulo: "grátis", teto: 0 },
  { rotulo: "até $0,50", teto: FAIXAS_DE_PRECO_MICROS[1] },
  { rotulo: "até $2", teto: FAIXAS_DE_PRECO_MICROS[2] },
  { rotulo: "qualquer", teto: null },
];

const ROTULO_ORDEM: Record<AiModelSort, string> = {
  relevance: "recentes",
  price: "mais barato",
  context: "maior contexto",
  intelligence: "inteligência",
  coding: "código",
  agentic: "agêntico",
};

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
  const [soRaciocinio, setSoRaciocinio] = useState(false);
  const [tetoDePreco, setTetoDePreco] = useState<number | null>(null);
  const [ordem, setOrdem] = useState<AiModelSort>("relevance");
  const [indice, setIndice] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // Mesma espera da paleta: sem ela, a busca sai a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 200);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(
    () => setIndice(0),
    [termo, soFerramentas, soRaciocinio, tetoDePreco, ordem],
  );

  const catalogo = useAiModelos({
    q: termo,
    tools: soFerramentas,
    reasoning: soRaciocinio,
    maxPrice: tetoDePreco,
    sort: ordem,
  });
  const modelos = catalogo.data?.items ?? [];

  // Mantém o item destacado visível, como na paleta.
  useEffect(() => {
    listaRef.current?.querySelector(`[data-indice="${indice}"]`)?.scrollIntoView({ block: "nearest" });
  }, [indice]);

  const favoritos = ajustes.data?.favorites ?? [];
  const escolhidos = ajustes.data?.taskModels ?? {};

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

  async function aoMudarTreino(permitir: boolean) {
    setErro(null);
    try {
      await atualizar.mutateAsync({ allowTraining: permitir });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a política de dados.");
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
          O conteúdo da nota sai da sua máquina</strong> quando você usa uma delas. O que o provedor
          pode fazer com esse conteúdo é a escolha abaixo.
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
                  ? "Modelos gratuitos ficam disponíveis. O provedor pode guardar o conteúdo das suas notas e treinar com ele."
                  : "O servidor pede ao provedor que não guarde o texto para treino. Modelos gratuitos ficam indisponíveis — os endpoints deles treinam com os dados."}
              </span>
            </span>
          </label>
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
          </div>

          {/* As faixas saem da distribuição real do catálogo — mediana em
              US$ 0,325/M —, não de números redondos escolhidos no olho. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-400">Preço:</span>
            {FAIXAS.map((f) => (
              <button
                key={f.rotulo}
                type="button"
                onClick={() => setTetoDePreco(f.teto)}
                aria-pressed={tetoDePreco === f.teto}
                className={`rounded px-2 py-0.5 transition-colors ${
                  tetoDePreco === f.teto
                    ? "bg-ink-700 text-titulo"
                    : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                }`}
              >
                {f.rotulo}
              </button>
            ))}

            <label className="ml-2 flex items-center gap-1 text-ink-400">
              <input
                type="checkbox"
                checked={soFerramentas}
                onChange={(e) => setSoFerramentas(e.target.checked)}
              />
              ferramentas
            </label>
            <label className="flex items-center gap-1 text-ink-400">
              <input
                type="checkbox"
                checked={soRaciocinio}
                onChange={(e) => setSoRaciocinio(e.target.checked)}
              />
              raciocínio
            </label>

            <label className="ml-auto flex items-center gap-1 text-ink-400">
              ordenar
              <select
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as AiModelSort)}
                aria-label="Ordenar o catálogo"
                className="rounded bg-ink-800 px-1 py-0.5 text-ink-200 outline-none
                           focus:ring-1 focus:ring-accent-400"
              >
                {Object.entries(ROTULO_ORDEM).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </select>
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
                  {/* RNF-07: etiqueta de texto, nunca só cor. */}
                  {m.supportsTools && <span className="text-[10px] text-emerald-300">ferramentas</span>}
                  {m.reasoning && <span className="text-[10px] text-violet-300">raciocínio</span>}
                  {m.free && <span className="text-[10px] text-sky-300">grátis</span>}
                  <Indices indices={m.indices} />
                  <span className="tabular-nums text-ink-400">{contexto(m.contextLength)}</span>
                  <span className="tabular-nums text-ink-400">
                    {emDolares(m.promptMicros)}/M
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {catalogo.data && modelos.length === 0 && (
            /* A mensagem nasceu quando o termo era o único filtro. Com os chips
               e as caixas, um clique em "grátis" sem nada digitado dizia
               «Nenhum modelo com «».» — culpando uma busca que não existe. */
            <Vazio
              texto={
                termo
                  ? `Nenhum modelo com «${termo}» nestes filtros.`
                  : "Nenhum modelo nestes filtros."
              }
            />
          )}
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
            <li className="flex items-center gap-2 pb-1 text-[10px] uppercase text-ink-400">
              {AI_TASKS.map((tarefa) => (
                <span key={tarefa} className="w-16 shrink-0 text-center">
                  {ROTULO_DA_TAREFA[tarefa].titulo}
                </span>
              ))}
              <span className="flex-1" />
            </li>
            {favoritos.map((f) => (
              <li key={f.favoriteId} className="flex items-center gap-2 py-1 text-xs">
                {AI_TASKS.map((tarefa) => {
                  /// Um modelo sem ferramenta não pode ser o do chat. Desabilitar
                  /// aqui é o que evita a recusa de 422 lá na frente, quando o
                  /// usuário já digitou a pergunta.
                  const impedido = EXIGE_FERRAMENTA.has(tarefa) && !f.supportsTools;
                  return (
                    <span key={tarefa} className="flex w-16 shrink-0 justify-center">
                      <input
                        type="radio"
                        name={`modelo-${tarefa}`}
                        checked={escolhidos[tarefa] === f.id}
                        disabled={impedido}
                        onChange={() =>
                          void definirTarefa.mutateAsync({ task: tarefa, modelId: f.id })
                        }
                        aria-label={
                          impedido
                            ? `${f.name} não sabe chamar ferramenta e não serve para ` +
                              ROTULO_DA_TAREFA[tarefa].titulo
                            : `Usar ${f.name} para ${ROTULO_DA_TAREFA[tarefa].titulo}`
                        }
                        title={
                          impedido ? "Este modelo não sabe chamar ferramenta." : undefined
                        }
                        className="disabled:opacity-30"
                      />
                    </span>
                  );
                })}
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
        {/* Derivada de `AI_TASKS` como as colunas, e não escrita em prosa: uma
            frase com os nomes das tarefas à mão é o mesmo furo de novo, só que
            em texto — a coluna nova nasceria sozinha e a legenda continuaria
            descrevendo duas tarefas. Acesso a chave conhecida não é erro de
            tipo, então nada acusaria. */}
        <p className="px-4 pb-3 text-[10px] text-ink-400">
          Uma escolha por tarefa.{" "}
          {AI_TASKS.map((tarefa) => (
            <span key={tarefa}>
              A de <strong>{ROTULO_DA_TAREFA[tarefa].titulo}</strong> é usada por{" "}
              {ROTULO_DA_TAREFA[tarefa].usa}.{" "}
            </span>
          ))}
          Tarefa que precisa consultar o acervo só aceita modelo com{" "}
          <span className="text-emerald-300">ferramentas</span> — sem isso o modelo conversa e não
          alcança as suas notas.
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
