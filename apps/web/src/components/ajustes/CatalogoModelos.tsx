import { AI_TASKS, FAIXAS_DE_PRECO_MICROS } from "@yu-book/shared";
import type { AiModel, AiModelIndices, AiModelSort } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useAiAjustes, useAiModelos, useDesfavoritar, useFavoritar } from "../../lib/ia";
import { Aviso } from "../base/Aviso";
import { Vazio } from "../base/Bloco";
import { Botao } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { IconeBusca, IconeEstrela } from "../Icones";
import { ROTULO_DA_TAREFA, contexto, emDolares, provedorDe } from "./comum";

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
  return <span className="text-miudo tabular-nums text-ink-400">{partes.join(" · ")}</span>;
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

/**
 * O catálogo do provedor, em grade de cartões. Continua um `listbox`: ↑↓
 * andam pela ordem de leitura e Enter favorita — ou, num modelo que já é
 * favorito, desfavorita. O cartão virou interruptor: clicar de novo mandava
 * outro `POST` para algo que já estava lá.
 *
 * **Menos um caso:** favorito que alguma tarefa usa não sai por aqui.
 * Desfavoritar limpa a tarefa no servidor, e um Enter a mais no campo de busca
 * deixaria o chat sem modelo sem ninguém ver. Quem quer tirar faz no quadro,
 * onde o uso está à vista.
 */
export function CatalogoModelos({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const ajustes = useAiAjustes();
  const favoritar = useFavoritar();
  const desfavoritar = useDesfavoritar();

  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [soFerramentas, setSoFerramentas] = useState(false);
  const [soRaciocinio, setSoRaciocinio] = useState(false);
  const [tetoDePreco, setTetoDePreco] = useState<number | null>(null);
  const [ordem, setOrdem] = useState<AiModelSort>("relevance");
  const [indice, setIndice] = useState(0);
  const listaRef = useRef<HTMLUListElement>(null);

  // Mesma espera da paleta: sem ela, a busca sai a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 200);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => setIndice(0), [termo, soFerramentas, soRaciocinio, tetoDePreco, ordem]);

  const catalogo = useAiModelos({
    q: termo,
    tools: soFerramentas,
    reasoning: soRaciocinio,
    maxPrice: tetoDePreco,
    sort: ordem,
  });
  const modelos = catalogo.data?.items ?? [];
  const favoritos = ajustes.data?.favorites ?? [];
  const escolhidos = ajustes.data?.taskModels ?? {};
  const tarefasDe = (modelId: string) => AI_TASKS.filter((t) => escolhidos[t] === modelId);

  // Mantém o item destacado visível, como na paleta.
  useEffect(() => {
    listaRef.current
      ?.querySelector(`[data-indice="${indice}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [indice]);

  async function alternar(modelo: AiModel) {
    onErro(null);
    const favorito = favoritos.find((f) => f.id === modelo.id);
    const emUso = tarefasDe(modelo.id);
    if (favorito && emUso.length > 0) {
      const nomes = emUso.map((t) => ROTULO_DA_TAREFA[t].titulo).join(" e ");
      onErro(`${modelo.name} está em uso por ${nomes}. Tire-o da tarefa no quadro abaixo antes.`);
      return;
    }
    try {
      if (favorito) await desfavoritar.mutateAsync(favorito.favoriteId);
      else await favoritar.mutateAsync(modelo.id);
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível mudar os favoritos.");
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
      if (alvo) void alternar(alvo);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 rounded-cartao bg-ink-950/90 px-1
                   pb-2 pt-1 backdrop-blur"
      >
        <label
          className="flex h-9 items-center gap-2 rounded-controle border border-ink-700 bg-superficie
                     px-3 shadow-e1 focus-within:border-accent-400"
        >
          <IconeBusca className="size-4 text-ink-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={aoTeclar}
            placeholder="Buscar no catálogo do provedor"
            aria-label="Buscar modelo"
            role="combobox"
            aria-expanded={modelos.length > 0}
            aria-controls="ia-catalogo"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60"
          />
        </label>

        {/* As faixas saem da distribuição real do catálogo — mediana em
            US$ 0,325/M —, não de números redondos escolhidos no olho. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-400">Preço</span>
          {FAIXAS.map((f) => (
            <button
              key={f.rotulo}
              type="button"
              onClick={() => setTetoDePreco(f.teto)}
              aria-pressed={tetoDePreco === f.teto}
              className={`rounded-etiqueta px-2 py-0.5 transition-colors ${
                tetoDePreco === f.teto
                  ? "bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/40"
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
              className="rounded-etiqueta bg-ink-800 px-1.5 py-0.5 text-ink-200 outline-none
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
      </div>

      {catalogo.isError && (
        <Aviso tom="erro">
          Não foi possível carregar o catálogo.{" "}
          <Botao variante="fantasma" onClick={() => void catalogo.refetch()} className="-my-1">
            Tentar de novo
          </Botao>
        </Aviso>
      )}

      {catalogo.data?.stale && (
        <p className="text-xs text-amber-300">
          O provedor não respondeu agora; esta lista é a última que conseguimos.
        </p>
      )}

      <ul
        id="ia-catalogo"
        ref={listaRef}
        role="listbox"
        aria-label="Modelos do catálogo"
        className="grid grid-cols-2 gap-2 min-[1280px]:grid-cols-3"
      >
        {modelos.map((m, i) => {
          const favorito = favoritos.some((f) => f.id === m.id);
          const serve = tarefasDe(m.id);
          const provedor = provedorDe(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === indice}
                data-indice={i}
                onMouseEnter={() => setIndice(i)}
                onClick={() => void alternar(m)}
                // A barra de filtros é `sticky`: sem a margem, ↑ deixaria o item
                // destacado escondido embaixo dela.
                className={`flex h-full w-full scroll-mt-32 flex-col gap-1.5 rounded-cartao border
                            p-3 text-left transition ${
                              i === indice
                                ? "border-accent-400 bg-superficie shadow-e2"
                                : "border-ink-800 bg-superficie/60 shadow-e1"
                            }`}
              >
                <span className="flex w-full items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-titulo">{m.name}</span>
                    {provedor && (
                      <span className="block truncate text-miudo text-ink-400">{provedor}</span>
                    )}
                  </span>
                  {favorito && (
                    <span className="flex shrink-0 items-center gap-1 text-miudo text-amber-400">
                      <IconeEstrela className="size-3" />
                      nos favoritos
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {/* RNF-07: etiqueta de texto, nunca só cor. */}
                  {m.supportsTools && <Etiqueta tom="destaque">ferramentas</Etiqueta>}
                  {m.reasoning && <Etiqueta>raciocínio</Etiqueta>}
                  {m.free && <Etiqueta>grátis</Etiqueta>}
                  <Indices indices={m.indices} />
                  {serve.map((t) => (
                    <Etiqueta key={t} tom="ia">
                      {ROTULO_DA_TAREFA[t].titulo}
                    </Etiqueta>
                  ))}
                </span>
                <span className="mt-auto text-miudo tabular-nums text-ink-400">
                  {contexto(m.contextLength)} de contexto · {emDolares(m.promptMicros)}/M entrada
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {catalogo.data && modelos.length === 0 && (
        /* A mensagem nasceu quando o termo era o único filtro. Com os chips
           e as caixas, um clique em "grátis" sem nada digitado dizia
           «Nenhum modelo com «».» — culpando uma busca que não existe. */
        <Vazio
          texto={
            termo ? `Nenhum modelo com «${termo}» nestes filtros.` : "Nenhum modelo nestes filtros."
          }
        />
      )}
      {catalogo.data && (
        <p className="text-miudo text-ink-400">
          {modelos.length} de {catalogo.data.total}
        </p>
      )}
    </div>
  );
}
