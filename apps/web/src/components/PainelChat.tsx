import type { ChatAttachmentInput, ChatMessage, ChatSource } from "@yu-book/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import {
  CHAVE_AJUSTES,
  CHAVE_CONVERSAS,
  chaveDaConversa,
  enviarMensagem,
  useConversa,
  useConversas,
  useCriarConversa,
  useExcluirConversa,
} from "../lib/chat";
import { useBoards } from "../lib/kanban";
import { renderMarkdown } from "../lib/markdown";
import { useBusca } from "../lib/notas";
import { useWorkspaceAtivo } from "../lib/workspace";
import { useQueryClient } from "@tanstack/react-query";

/**
 * O painel do chat (RF-17 a RF-26).
 *
 * A anatomia é a de `Paleta.tsx` e `GavetaLinks.tsx`: overlay, `role="dialog"`,
 * `Escape` tratado aqui **e** no atalho global, foco por `requestAnimationFrame`.
 *
 * O que é próprio daqui é a espera. Uma mensagem vira até cinco chamadas ao
 * provedor, e entre elas há segundos de silêncio enquanto o Yu-book executa
 * uma ferramenta — por isso o estado de cada passo é anunciado (RNF-07), e não
 * só o "gerando" genérico. Silêncio sem explicação é o que faz alguém clicar de
 * novo.
 */

interface Anexo extends ChatAttachmentInput {
  titulo: string;
}

/// O alvo de um anexo, que é sempre um dos três. Serve de chave de lista e de
/// identidade para tirar um do contexto — **o título não serve**: dois cards em
/// colunas diferentes podem se chamar igual, e remover pelo título levaria o
/// homônimo junto.
const alvoDe = (a: Anexo) => a.noteId ?? a.cardId ?? a.boardId ?? a.titulo;

/** Uma fala ainda não persistida, enquanto o fluxo corre. */
interface EmCurso {
  pergunta: string;
  anexos: Anexo[];
  texto: string;
  ferramenta: string | null;
  fontes: ChatSource[];
  cortados: string[];
}

const VAZIO: EmCurso = {
  pergunta: "",
  anexos: [],
  texto: "",
  ferramenta: null,
  fontes: [],
  cortados: [],
};

/**
 * Uma linha do menu do `@`.
 *
 * Os três tipos vêm de fontes diferentes — nota e card da busca do servidor,
 * quadro da lista que a navegação já carregou —, e o menu precisa oferecer os
 * três porque o servidor resolve os três. Oferecer só dois faria a tela
 * prometer o que ela não entrega.
 */
interface Sugestao {
  anexo: ChatAttachmentInput;
  titulo: string;
  rotulo: string;
}

/** O rótulo humano de cada ação — a tela não diz `search_notes` a ninguém. */
const ROTULO_DA_ACAO: Record<string, string> = {
  search_notes: "procurando nas suas notas",
  get_note: "lendo uma nota",
  list_boards: "vendo seus quadros",
  get_board: "abrindo um quadro",
  get_dashboard: "conferindo o que vence",
};

function Fontes({ fontes, onAbrir }: { fontes: ChatSource[]; onAbrir: (f: ChatSource) => void }) {
  if (fontes.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-400">consultou:</span>
      {fontes.map((f) =>
        f.kind === "card" ? (
          <span
            key={`${f.kind}-${f.id}`}
            className="rounded border border-ink-700 px-1.5 py-0.5 text-xs text-ink-400"
          >
            {f.title}
          </span>
        ) : (
          <button
            key={`${f.kind}-${f.id}`}
            type="button"
            onClick={() => onAbrir(f)}
            className="rounded border border-ink-700 px-1.5 py-0.5 text-xs text-accent-400
                       transition hover:bg-ink-700"
          >
            {f.title}
          </button>
        ),
      )}
    </div>
  );
}

function Fala({ mensagem, onAbrir }: { mensagem: ChatMessage; onAbrir: (f: ChatSource) => void }) {
  // Já sanitizado por DOMPurify dentro de renderMarkdown (INV-09, RNF-05):
  // texto de modelo é entrada não confiável como qualquer outra.
  const html = useMemo(
    () => (mensagem.role === "assistant" ? renderMarkdown(mensagem.content) : ""),
    [mensagem.role, mensagem.content],
  );

  if (mensagem.role === "tool") return null;

  if (mensagem.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {mensagem.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {mensagem.attachments.map((a) => (
              <span key={a.id} className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-ink-200">
                {a.title}
              </span>
            ))}
          </div>
        )}
        <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-ink-700 px-3 py-2 text-sm">
          {mensagem.content}
        </p>
      </div>
    );
  }

  /// Fala de assistente sem texto é a que só pediu ferramenta. O passo já foi
  /// anunciado enquanto acontecia; repetir um balão vazio aqui é ruído.
  if (!mensagem.content.trim()) return null;

  return (
    <div>
      <div className="preview text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      {mensagem.modelUsed && (
        // RF-25: qual modelo respondeu **esta** mensagem — a escolha pode mudar
        // entre uma e outra.
        <p className="mt-1 text-xs text-ink-400">{mensagem.modelUsed}</p>
      )}
      <Fontes fontes={mensagem.sources} onAbrir={onAbrir} />
    </div>
  );
}

interface PainelChatProps {
  aberto: boolean;
  onFechar: () => void;
  onAbrirNota: (id: string) => void;
}

export function PainelChat({ aberto, onFechar, onAbrirNota }: PainelChatProps) {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const { ativoId } = useWorkspaceAtivo();

  const [conversaId, setConversaId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [emCurso, setEmCurso] = useState<EmCurso | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /// O menu do `@`: o termo depois do arroba, com o mesmo debounce de 200 ms
  /// da paleta (RF-29).
  const [mencao, setMencao] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const [indice, setIndice] = useState(0);

  const campoRef = useRef<HTMLTextAreaElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const abortarRef = useRef<AbortController | null>(null);

  const { data: conversas } = useConversas();
  const { data: conversa } = useConversa(conversaId);
  const criar = useCriarConversa();
  const excluir = useExcluirConversa();

  const { data: busca } = useBusca(debounced, aberto && mencao !== null, ativoId);
  const { data: quadros } = useBoards(ativoId);

  /**
   * O que o `@` oferece: o resultado da busca mais os quadros que casam com o
   * termo.
   *
   * Os quadros entram do lado do cliente porque a busca do servidor cobre nota
   * e card, não quadro — e a lista de quadros já está em cache, carregada pela
   * navegação. Filtro por `includes` sem acento, que é o que `normalizarTitulo`
   * faria; são poucas dezenas de quadros, e uma rota nova só para isto seria
   * desproporcional.
   */
  const sugestoes = useMemo<Sugestao[]>(() => {
    const termo = (debounced ?? "").trim().toLowerCase();
    const daBusca = (busca?.results ?? []).map((r) => ({
      anexo: r.type === "card" ? { cardId: r.id } : { noteId: r.id },
      titulo: r.title,
      rotulo: r.type === "card" ? "card" : (r.kind ?? "nota"),
    }));
    const dosQuadros = (quadros ?? [])
      .filter((b) => !termo || b.name.toLowerCase().includes(termo))
      .slice(0, 5)
      .map((b) => ({ anexo: { boardId: b.id }, titulo: b.name, rotulo: "quadro" }));
    return [...daBusca, ...dosQuadros];
  }, [busca, quadros, debounced]);

  useEffect(() => {
    if (!aberto) return;
    const timer = setTimeout(() => setDebounced(mencao ?? ""), 200);
    return () => clearTimeout(timer);
  }, [mencao, aberto]);

  useEffect(() => setIndice(0), [debounced]);

  useEffect(() => {
    if (!aberto) return;
    // Sem rAF o campo ainda não existe no DOM, como na paleta.
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [aberto]);

  /// Rolar para o fim a cada pedaço que chega: uma resposta que cresce fora da
  /// área visível é uma resposta que ninguém vê chegando.
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [emCurso?.texto, conversa?.messages.length]);

  /**
   * Fechar o painel no meio de uma resposta solta a conexão.
   *
   * **Função de limpeza, e não `if (!aberto)`.** `Aplicacao.tsx` monta este
   * painel dentro de `{chatAberto && …}` com `aberto` literal, como a gaveta de
   * links — então `aberto` nunca chega a ser `false`: o componente **desmonta**.
   * Uma verificação no corpo do efeito nunca rodaria, e fechar no meio de uma
   * resposta deixaria o `fetch` aberto e o laço do servidor seguindo até cinco
   * passos, cada um gravando sua linha contra o teto do dia.
   */
  useEffect(() => () => abortarRef.current?.abort(), []);

  /**
   * Abre a origem citada (RF-20).
   *
   * Nota e quadro têm rota própria. **Card não tem rota sem o quadro**
   * (`/b/:boardId/c/:cardId`), e a fonte carrega só o id do card — então o chip
   * de um card não navega, e por isso ele não é um botão: um controle que não
   * faz nada é pior do que um rótulo honesto.
   */
  const abrirFonte = useCallback(
    (fonte: ChatSource) => {
      if (fonte.kind === "note") onAbrirNota(fonte.id);
      else if (fonte.kind === "board") navegar(`/b/${fonte.id}`);
      else return;
      onFechar();
    },
    [onAbrirNota, navegar, onFechar],
  );

  const anexar = useCallback((sugestao: Sugestao) => {
    const novo: Anexo = { ...sugestao.anexo, titulo: sugestao.titulo };
    setAnexos((atuais) =>
      atuais.some((a) => alvoDe(a) === alvoDe(novo)) ? atuais : [...atuais, novo],
    );
    /// Tira o `@termo` do texto: ele virou um chip, e deixá-lo escrito faria o
    /// modelo receber a menção duas vezes.
    setTexto((t) => t.replace(/@[^\s@]*$/, ""));
    setMencao(null);
    campoRef.current?.focus();
  }, []);

  const aoDigitar = useCallback((valor: string) => {
    setTexto(valor);
    const arroba = /@([^\s@]*)$/.exec(valor);
    setMencao(arroba ? (arroba[1] ?? "") : null);
  }, []);

  const enviar = useCallback(async () => {
    const pergunta = texto.trim();
    if (!pergunta || emCurso) return;

    setErro(null);
    let alvo = conversaId;
    try {
      if (!alvo) {
        // A conversa nasce com o começo da primeira pergunta como título — o
        // usuário renomeia depois se quiser (RF-24).
        const nova = await criar.mutateAsync(pergunta.slice(0, 60));
        alvo = nova.id;
        setConversaId(nova.id);
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a conversa.");
      return;
    }

    const enviados = anexos;
    setTexto("");
    setAnexos([]);
    setMencao(null);
    setEmCurso({ ...VAZIO, pergunta, anexos: enviados });

    const controle = new AbortController();
    abortarRef.current = controle;

    try {
      await enviarMensagem({
        conversationId: alvo,
        content: pergunta,
        attachments: enviados.map(({ titulo: _titulo, ...alvos }) => alvos),
        signal: controle.signal,
        aoEvento: (evento) => {
          setEmCurso((atual) => {
            if (!atual) return atual;
            switch (evento.tipo) {
              case "inicio":
                return { ...atual, cortados: evento.cortados };
              case "delta":
                return { ...atual, texto: atual.texto + evento.texto, ferramenta: null };
              case "ferramenta":
                return { ...atual, ferramenta: evento.nome };
              case "fontes": {
                /// Sem repetir: buscar e depois ler a mesma nota é o caminho
                /// normal do laço, e cada evento traz a lista **daquela**
                /// ferramenta, não o acumulado. Concatenar mostraria a nota
                /// duas vezes e repetiria a chave React em `Fontes`.
                const novas = evento.fontes.filter(
                  (f) => !atual.fontes.some((j) => j.kind === f.kind && j.id === f.id),
                );
                return novas.length ? { ...atual, fontes: [...atual.fontes, ...novas] } : atual;
              }
              default:
                return atual;
            }
          });

          /// Fora do updater de propósito: com o `StrictMode` ligado ele roda
          /// duas vezes, e um updater que produz efeito deixa de ser puro.
          if (evento.tipo === "teto" || evento.tipo === "erro") setErro(evento.mensagem);
        },
      });
    } catch (e) {
      if (!controle.signal.aborted) {
        setErro(e instanceof ApiError ? e.message : "Não foi possível falar com o assistente.");
      }
    } finally {
      abortarRef.current = null;
      setEmCurso(null);
      /// O histórico persistido vira a fonte da verdade assim que o fluxo
      /// acaba, e o gasto do dia mudou — `["ia","ajustes"]` tem `staleTime` de
      /// 30 s e ficaria mostrando o valor de antes.
      if (alvo) await qc.invalidateQueries({ queryKey: chaveDaConversa(alvo) });
      await qc.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      await qc.invalidateQueries({ queryKey: CHAVE_AJUSTES });
    }
  }, [texto, emCurso, conversaId, anexos, criar, qc]);

  const teclas = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mencao !== null) {
          // O `Escape` global de `Aplicacao.tsx` fecha tudo o que está aberto,
          // e ele escuta na `window`. Sem parar a propagação aqui, fechar o
          // menu do `@` fecharia o painel junto — mesma precaução do
          // `PainelCard.tsx`.
          e.stopPropagation();
          setMencao(null);
          return;
        }
        onFechar();
        return;
      }

      if (mencao !== null && sugestoes.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const passo = e.key === "ArrowDown" ? 1 : -1;
          setIndice((i) => (i + passo + sugestoes.length) % sugestoes.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const escolhido = sugestoes[indice];
          if (escolhido) anexar(escolhido);
          return;
        }
      }

      // Enter envia; Shift+Enter quebra linha. É a convenção que todo campo de
      // conversa usa, e contrariá-la surpreende antes de ensinar.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void enviar();
      }
    },
    [mencao, sugestoes, indice, anexar, enviar, onFechar],
  );

  if (!aberto) return null;

  const mensagens = conversa?.messages ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[8vh]"
      onMouseDown={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conversar com o assistente"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={teclas}
        className="flex h-[78vh] w-full max-w-4xl overflow-hidden rounded-xl border border-ink-700
                   bg-ink-800 shadow-2xl"
      >
        <aside className="flex w-52 shrink-0 flex-col border-r border-ink-700 bg-ink-900">
          <button
            type="button"
            onClick={() => {
              setConversaId(null);
              setAnexos([]);
              setTexto("");
              campoRef.current?.focus();
            }}
            className="m-2 rounded border border-ink-700 px-2 py-1 text-xs text-ink-200
                       transition hover:bg-ink-800"
          >
            + nova conversa
          </button>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {(conversas ?? []).map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setConversaId(c.id)}
                  aria-current={c.id === conversaId}
                  className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs transition
                              ${
                                c.id === conversaId
                                  ? "bg-ink-700 text-ink-200"
                                  : "text-ink-400 hover:bg-ink-800"
                              }`}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    excluir.mutate(c.id);
                    if (c.id === conversaId) setConversaId(null);
                  }}
                  aria-label={`Excluir a conversa ${c.title}`}
                  className="rounded px-1 text-ink-400 opacity-0 transition
                             group-hover:opacity-100 hover:text-red-300"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {mensagens.length === 0 && !emCurso && (
              <p className="text-sm text-ink-400">
                Pergunte sobre o seu acervo — o assistente procura sozinho. Use{" "}
                <kbd className="rounded bg-ink-700 px-1">@</kbd> para anexar uma nota, um card ou um
                quadro ao contexto.
              </p>
            )}

            {mensagens.map((m) => (
              <Fala key={m.id} mensagem={m} onAbrir={abrirFonte} />
            ))}

            {emCurso && (
              <>
                <div className="flex flex-col items-end gap-1">
                  {emCurso.anexos.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {emCurso.anexos.map((a) => (
                        <span
                          key={alvoDe(a)}
                          className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-ink-200"
                        >
                          {a.titulo}
                        </span>
                      ))}
                    </div>
                  )}
                  <p
                    className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-ink-700 px-3 py-2
                               text-sm"
                  >
                    {emCurso.pergunta}
                  </p>
                </div>

                <div>
                  {/* RNF-07: o passo é anunciado, e o texto visível é a própria
                      região — o leitor de tela não repete. */}
                  <p role="status" className="text-xs text-ink-400">
                    {emCurso.ferramenta
                      ? `${ROTULO_DA_ACAO[emCurso.ferramenta] ?? emCurso.ferramenta}…`
                      : emCurso.texto
                        ? ""
                        : "pensando…"}
                    {!emCurso.texto && <span className="animate-pulse"> </span>}
                  </p>
                  {emCurso.texto && (
                    <div
                      className="preview text-sm"
                      // Sanitizado por DOMPurify em renderMarkdown, a cada pedaço.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(emCurso.texto) }}
                    />
                  )}
                  <Fontes fontes={emCurso.fontes} onAbrir={abrirFonte} />
                  {emCurso.cortados.length > 0 && (
                    // RNF-04: o limite de contexto é **declarado** quando corta.
                    <p role="status" className="mt-1 text-xs text-amber-300">
                      Não coube no contexto e ficou de fora: {emCurso.cortados.join(", ")}.
                    </p>
                  )}
                </div>
              </>
            )}
            <div ref={fimRef} />
          </div>

          {erro && (
            <p role="alert" className="mx-4 rounded bg-red-500/15 px-3 py-2 text-xs text-red-200">
              {erro}
            </p>
          )}

          <div className="relative shrink-0 border-t border-ink-700 p-3">
            {mencao !== null && sugestoes.length > 0 && (
              <ul
                role="listbox"
                aria-label="Anexar ao contexto"
                className="absolute bottom-full left-3 right-3 mb-1 max-h-56 overflow-y-auto
                           rounded-lg border border-ink-700 bg-ink-800 shadow-2xl"
              >
                {sugestoes.map((s, i) => (
                  <li key={`${s.rotulo}-${s.anexo.noteId ?? s.anexo.cardId ?? s.anexo.boardId}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === indice}
                      onMouseEnter={() => setIndice(i)}
                      onClick={() => anexar(s)}
                      className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm
                                  ${i === indice ? "bg-ink-700/70" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.titulo}</span>
                      <span className="shrink-0 text-xs text-ink-400">{s.rotulo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {anexos.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {anexos.map((a) => (
                  <button
                    key={alvoDe(a)}
                    type="button"
                    onClick={() =>
                      setAnexos((atuais) => atuais.filter((x) => alvoDe(x) !== alvoDe(a)))
                    }
                    aria-label={`Tirar ${a.titulo} do contexto`}
                    className="rounded bg-ink-700 px-1.5 py-0.5 text-xs text-ink-200
                               transition hover:bg-ink-700/60"
                  >
                    {a.titulo} ×
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                ref={campoRef}
                value={texto}
                onChange={(e) => aoDigitar(e.target.value)}
                rows={2}
                aria-label="Sua pergunta"
                placeholder="Pergunte alguma coisa. @ anexa uma nota."
                className="min-w-0 flex-1 resize-none rounded border border-ink-700 bg-ink-900
                           px-3 py-2 text-sm text-ink-200 placeholder:text-ink-400"
              />
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={Boolean(emCurso) || !texto.trim()}
                className="rounded bg-accent-500 px-3 py-2 text-sm text-white transition
                           hover:bg-accent-400 disabled:opacity-40"
              >
                enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
