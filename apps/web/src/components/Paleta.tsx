import { splitHighlight } from "@yu-book/shared";
import type { SearchResult } from "@yu-book/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useBusca } from "../lib/notas";
import { casaTermo } from "../lib/tags";
import { useWorkspaceAtivo } from "../lib/workspace";
import { Dialogo } from "./base/Dialogo";
import { Tecla } from "./base/Tecla";
import { IconeAssistente, IconeBusca } from "./Icones";
import { MarcaIA } from "./MarcaIA";
import { RotuloTipo } from "./RotuloTipo";

/**
 * Ação alcançável pelo nome na paleta (redesenho de UI, Etapa 5). `atalho` é só
 * exibido: o registro do atalho continua em `lib/atalhosGlobais.ts`.
 */
export interface ComandoPaleta {
  id: string;
  rotulo: string;
  icone?: ReactNode;
  atalho?: string;
  executar: () => void;
}

type Item =
  | { tipo: "resultado"; resultado: SearchResult }
  | { tipo: "comando"; comando: ComandoPaleta }
  | { tipo: "perguntar"; texto: string };

/** Prefixo que troca a busca pela lista de comandos, como nos editores. */
const PREFIXO_COMANDO = ">";

interface PaletaProps {
  aberta: boolean;
  onFechar: () => void;
  onAbrirNota: (id: string) => void;
  /** RF-43: abrir um card leva ao board com o painel aberto. */
  onAbrirCard: (boardId: string, cardId: string) => void;
  comandos: ComandoPaleta[];
  /** Leva o texto ao assistente. Quem decide se envia é quem recebe. */
  onPerguntar: (texto: string) => void;
}

/** RF-28..37 (notas) e RF-41..45 (cards): busca global por teclado. */
export function Paleta({
  aberta,
  onFechar,
  onAbrirNota,
  onAbrirCard,
  comandos,
  onPerguntar,
}: PaletaProps) {
  const { ativo, ativoId } = useWorkspaceAtivo();
  const [texto, setTexto] = useState("");
  const [debounced, setDebounced] = useState("");
  const [indice, setIndice] = useState(0);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const modoComando = texto.trimStart().startsWith(PREFIXO_COMANDO);
  const termoComando = modoComando
    ? texto.trimStart().slice(PREFIXO_COMANDO.length).trim()
    : texto.trim();

  // RF-29: 200 ms entre a tecla e a consulta.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(texto), 200);
    return () => clearTimeout(t);
  }, [texto]);

  // Com `>` a paleta só lista comandos: a busca nem chega a ser feita.
  const buscaLigada = aberta && !modoComando;
  const { data, isFetching } = useBusca(debounced, buscaLigada, ativoId);
  const resultados = buscaLigada ? (data?.results ?? []) : [];

  const comandosVisiveis = useMemo(
    () => comandos.filter((c) => casaTermo(c.rotulo, termoComando)),
    [comandos, termoComando],
  );

  // Uma lista só, na ordem em que aparece: é sobre ela que ↑↓ e Enter andam.
  const itens = useMemo<Item[]>(() => {
    const lista: Item[] = resultados.map((resultado) => ({ tipo: "resultado", resultado }));
    for (const comando of comandosVisiveis) lista.push({ tipo: "comando", comando });
    const pergunta = texto.trim();
    if (pergunta && !modoComando) lista.push({ tipo: "perguntar", texto: pergunta });
    return lista;
  }, [resultados, comandosVisiveis, texto, modoComando]);

  const selecionado = Math.min(indice, itens.length - 1);

  useEffect(() => {
    if (aberta) {
      setTexto("");
      setDebounced("");
      setIndice(0);
    }
  }, [aberta]);

  useEffect(() => setIndice(0), [debounced]);

  // Mantém o item destacado visível ao navegar por teclado.
  useEffect(() => {
    listaRef.current
      ?.querySelector(`[data-indice="${selecionado}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selecionado]);

  function executar(item: Item) {
    if (item.tipo === "resultado") {
      const { resultado } = item;
      if (resultado.type === "card" && resultado.boardId) {
        onAbrirCard(resultado.boardId, resultado.id);
      } else {
        onAbrirNota(resultado.id);
      }
    } else if (item.tipo === "comando") {
      item.comando.executar();
    } else {
      onPerguntar(item.texto);
    }
    onFechar();
  }

  // O Esc é do `Dialogo`; aqui só o que é da lista.
  function teclas(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (itens.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setIndice((selecionado + passo + itens.length) % itens.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter antes de a busca responder escolheria um comando que casou com
      // o texto — "notas" iria para a tela de notas, não para a nota buscada.
      // Até os resultados chegarem, o Enter espera.
      const esperando =
        buscaLigada && texto.trim() !== "" && (texto !== debounced || isFetching);
      if (esperando) return;
      const escolhido = itens[selecionado];
      if (escolhido) executar(escolhido);
    }
  }

  const filtros = buscaLigada ? data?.filtros : undefined;
  const temChips =
    filtros && (filtros.kind || filtros.tag || filtros.workspace || filtros.card || ativo);
  const semResultado =
    buscaLigada && debounced.trim() !== "" && !isFetching && resultados.length === 0;
  const comSecoes = resultados.length > 0 && comandosVisiveis.length > 0;

  function opcao(i: number, chave: string, conteudo: ReactNode) {
    const item = itens[i];
    if (!item) return null;
    return (
      <button
        key={chave}
        type="button"
        role="option"
        data-indice={i}
        aria-selected={i === selecionado}
        onMouseEnter={() => setIndice(i)}
        onClick={() => executar(item)}
        className={`w-full border-l-2 px-4 py-2.5 text-left ${
          i === selecionado
            ? "border-accent-400 bg-ink-700/70"
            : "border-transparent hover:bg-ink-700/30"
        }`}
      >
        {conteudo}
      </button>
    );
  }

  const inicioComandos = resultados.length;
  const indicePergunta = resultados.length + comandosVisiveis.length;
  const ultimo = itens[itens.length - 1];

  return (
    <Dialogo
      aberto={aberta}
      posicao="topo"
      largura="max-w-xl"
      rotulo="Buscar"
      focoInicial={campoRef}
      onFechar={onFechar}
    >
      <div onKeyDown={teclas}>
        {/* O campo é o único da caixa: em vez do contorno, a linha de baixo acende. */}
        <div
          className="flex items-center gap-3 border-b border-ink-700 px-4 transition-colors
                     focus-within:border-accent-400"
        >
          <IconeBusca className="size-4 text-ink-400" />
          <input
            ref={campoRef}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setIndice(0);
            }}
            placeholder="Buscar…  tipo:aula · tag:jwt · #workspace · > comandos"
            aria-label="Termo de busca"
            aria-controls="paleta-resultados"
            className="w-full bg-transparent py-3.5 text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60"
          />
          {isFetching && buscaLigada && <span className="text-xs text-ink-400">…</span>}
        </div>

        {temChips && (
          <div className="flex flex-wrap gap-2 border-b border-ink-700 px-4 py-2">
            {/* RF-02: o escopo ativo é visível; RF-06: `#ws` digitado o substitui. */}
            {ativo && !filtros.workspace && (
              <span className="rounded-etiqueta bg-ink-700 px-1.5 py-0.5 text-miudo text-ink-200">
                em {ativo.name}
              </span>
            )}
            {filtros.card && <RotuloTipo tipo="card" />}
            {filtros.kind && <RotuloTipo tipo={filtros.kind} />}
            {filtros.tag && (
              <span className="rounded-etiqueta bg-ink-700 px-1.5 py-0.5 text-miudo text-ink-200">
                tag: {filtros.tag}
              </span>
            )}
            {filtros.workspace && (
              <span className="rounded-etiqueta bg-ink-700 px-1.5 py-0.5 text-miudo text-ink-200">
                #{filtros.workspace}
              </span>
            )}
          </div>
        )}

        {buscaLigada && data?.approximate && (
          <p className="border-b border-ink-700 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
            Nada exato. Mostrando resultados aproximados por semelhança de título.
          </p>
        )}

        {semResultado && (
          <p className="px-4 pt-3 text-sm text-ink-400">
            Nada encontrado para <span className="text-ink-200">“{debounced.trim()}”</span>.
          </p>
        )}

        <div
          id="paleta-resultados"
          ref={listaRef}
          role="listbox"
          aria-label="Resultados e comandos"
          className="max-h-80 overflow-y-auto py-1"
        >
          {itens.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ink-400">
              {modoComando ? (
                <>
                  Nenhum comando com <span className="text-ink-200">“{termoComando}”</span>.
                </>
              ) : (
                "Digite para buscar."
              )}
            </p>
          )}

          {resultados.length > 0 && (
            <div role="group" aria-label="Resultados">
              {comSecoes && <p className="rotulo px-4 pb-1 pt-2">Resultados</p>}
              {resultados.map((r, i) =>
                opcao(
                  i,
                  `${r.type}:${r.id}`,
                  <>
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-titulo">{r.title}</span>
                      {/* RF-41: card se identifica como card e diz de que board é. */}
                      {/* Etapa C da frente de IA: gerado se distingue antes de abrir. */}
                      {r.ai && (
                        <span className="ml-auto shrink-0">
                          <MarcaIA marca={r.ai} />
                        </span>
                      )}
                      <RotuloTipo
                        tipo={r.kind ?? "card"}
                        className={`shrink-0 ${r.ai ? "" : "ml-auto"}`}
                      />
                      {r.type === "card" ? (
                        <span className="shrink-0 text-miudo text-ink-400">
                          {r.boardName} · {r.columnName}
                        </span>
                      ) : (
                        r.workspaceName && (
                          <span className="shrink-0 text-miudo text-ink-400">
                            #{r.workspaceName}
                          </span>
                        )
                      )}
                    </div>
                    {r.snippet && (
                      <p className="mt-0.5 truncate text-xs text-ink-400">
                        {/* RF-32: destaque vem por marcadores, não por HTML da API */}
                        {splitHighlight(r.snippet).map((parte, idx) =>
                          parte.hl ? (
                            <mark key={idx} className="bg-transparent font-medium text-accent-400">
                              {parte.text}
                            </mark>
                          ) : (
                            <span key={idx}>{parte.text}</span>
                          ),
                        )}
                      </p>
                    )}
                  </>,
                ),
              )}
            </div>
          )}

          {comandosVisiveis.length > 0 && (
            <div role="group" aria-label="Comandos">
              {(comSecoes || !texto.trim()) && <p className="rotulo px-4 pb-1 pt-2">Comandos</p>}
              {comandosVisiveis.map((c, j) =>
                opcao(
                  inicioComandos + j,
                  `comando:${c.id}`,
                  <span className="flex items-center gap-2.5 text-sm text-ink-200">
                    <span className="flex size-4 shrink-0 text-ink-400">{c.icone}</span>
                    <span className="truncate">{c.rotulo}</span>
                    {c.atalho && (
                      <span className="ml-auto shrink-0">
                        <Tecla combo={c.atalho} />
                      </span>
                    )}
                  </span>,
                ),
              )}
            </div>
          )}

          {ultimo?.tipo === "perguntar" &&
            opcao(
              indicePergunta,
              "perguntar",
              <span className="flex items-center gap-2.5 text-sm text-ink-200">
                <IconeAssistente className="size-4 text-accent-400" />
                <span className="truncate">
                  Perguntar ao assistente: <span className="text-titulo">«{ultimo.texto}»</span>
                </span>
              </span>,
            )}
        </div>

        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-700 px-4 py-2
                     text-miudo text-ink-400"
        >
          <span className="flex items-center gap-1.5">
            <Tecla combo="↑" />
            <Tecla combo="↓" /> navegar
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Enter" /> abrir
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo=">" /> comandos
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Esc" /> fechar
          </span>
        </div>
      </div>
    </Dialogo>
  );
}
