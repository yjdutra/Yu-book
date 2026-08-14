import { CARD_PRIORITIES, MAX_CHECKLIST_ITENS } from "@yu-book/shared";
import type { CardPriority, CardUpdateInput, ChecklistItem } from "@yu-book/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useAtualizarCard, useCard, useExcluirCard } from "../lib/kanban";
import { renderMarkdown } from "../lib/markdown";
import { useCriarNota, useTitulos } from "../lib/notas";
import { useAutosave } from "../lib/useAutosave";
import type { EstadoSalvamento } from "../lib/useAutosave";
import { RotuloTipo } from "./RotuloTipo";

/** O `input type="date"` fala yyyy-mm-dd local; o banco fala ISO. */
function paraCampoData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Prazo é o fim do dia escolhido: antes disso, o card não está vencido. */
function paraData(valor: string): Date | null {
  if (!valor) return null;
  const d = new Date(`${valor}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ROTULO_PRIORIDADE: Record<CardPriority, string> = {
  baixa: "⬇ baixa",
  media: "= média",
  alta: "⬆ alta",
};

function IndicadorSalvamento({ estado }: { estado: EstadoSalvamento }) {
  if (estado.tipo === "ocioso") return null;

  if (estado.tipo === "erro") {
    return (
      <span
        role="alert"
        className="rounded bg-red-500/15 px-2 py-1 text-[11px] text-red-300"
        title={estado.mensagem}
      >
        ⚠ não salvo — tentativa {estado.tentativas}/3
      </span>
    );
  }

  const texto =
    estado.tipo === "salvando"
      ? "salvando…"
      : estado.tipo === "salvo"
        ? `salvo ${estado.em.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : "editando";

  return (
    <span aria-live="polite" className="text-[11px] tabular-nums text-ink-400">
      {texto}
    </span>
  );
}

interface PainelCardProps {
  cardId: string;
  onFechar: () => void;
  onAbrirNota: (id: string) => void;
}

interface Rascunho {
  title: string;
  descriptionMd: string;
}

/** RF-27: painel à direita do board, sem modal e sem cobrir as colunas. */
export function PainelCard({ cardId, onFechar, onAbrirNota }: PainelCardProps) {
  const { data: card, isLoading } = useCard(cardId);
  const atualizar = useAtualizarCard();
  const excluir = useExcluirCard();
  const criarNota = useCriarNota();
  const { data: titulos } = useTitulos();

  const [rascunho, setRascunho] = useState<Rascunho>({ title: "", descriptionMd: "" });
  const [preview, setPreview] = useState(false);
  const [buscaNota, setBuscaNota] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const carregadoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!card || carregadoRef.current === card.id) return;
    carregadoRef.current = card.id;
    setRascunho({ title: card.title, descriptionMd: card.descriptionMd });
    setPreview(false);
    setBuscaNota("");
    setErro(null);
  }, [card]);

  const salvar = useCallback(
    async (valor: Rascunho) => {
      const title = valor.title.trim();
      await atualizar.mutateAsync({
        id: cardId,
        input: { ...(title && { title }), descriptionMd: valor.descriptionMd },
      });
    },
    [atualizar, cardId],
  );

  const iguais = useCallback(
    (a: Rascunho, b: Rascunho) => a.title === b.title && a.descriptionMd === b.descriptionMd,
    [],
  );

  // RF-29: mesmo comportamento da nota — 800 ms, Ctrl+S imediato, 3 tentativas.
  const { estado, salvarAgora } = useAutosave({ valor: rascunho, chave: cardId, salvar, iguais });

  const html = useMemo(() => renderMarkdown(rascunho.descriptionMd), [rascunho.descriptionMd]);

  const sugestoes = useMemo(() => {
    const termo = buscaNota.trim().toLowerCase();
    if (!termo) return [];
    return (titulos ?? []).filter((t) => t.title.toLowerCase().includes(termo)).slice(0, 6);
  }, [buscaNota, titulos]);

  if (isLoading || !card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        <span className="animate-pulse">Carregando card…</span>
      </div>
    );
  }

  function aplicar(input: CardUpdateInput) {
    setErro(null);
    atualizar.mutate(
      { id: cardId, input },
      {
        onError: (e) =>
          setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a alteração."),
      },
    );
  }

  const checklist = card.checklist;

  function mudarChecklist(itens: ChecklistItem[]) {
    aplicar({ checklist: itens });
  }

  function vincularNotaNova() {
    if (!card) return;
    setErro(null);
    criarNota.mutate(
      { title: rascunho.title.trim() || card.title },
      {
        onSuccess: (nota) => aplicar({ noteId: nota.id }),
        onError: (e) =>
          setErro(
            e instanceof ApiError && e.code === "TITULO_DUPLICADO"
              ? `${e.message} — vincule a existente pela busca acima.`
              : "Não foi possível criar a nota.",
          ),
      },
    );
  }

  const feitos = checklist.filter((i) => i.done).length;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFechar();
        }
      }}
    >
      <header className="shrink-0 border-b border-ink-800 px-4 pb-3 pt-4">
        <div className="flex items-start gap-2">
          <input
            value={rascunho.title}
            onChange={(e) => setRascunho((r) => ({ ...r, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
                salvarAgora();
              }
            }}
            aria-label="Título do card"
            className="min-w-0 flex-1 bg-transparent text-base font-semibold text-white outline-none"
          />
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar card"
            className="shrink-0 rounded px-1.5 text-sm text-ink-400 hover:text-ink-200"
          >
            ×
          </button>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-ink-400">
            {card.boardName} · {card.columnName}
          </span>
          <span className="ml-auto">
            <IndicadorSalvamento estado={estado} />
          </span>
        </div>

        {erro && (
          <p role="alert" className="mt-2 text-[11px] text-red-300">
            {erro}
          </p>
        )}
      </header>

      <div className="space-y-4 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-ink-400">
            Prazo
            <input
              type="date"
              value={paraCampoData(card.dueDate)}
              onChange={(e) => aplicar({ dueDate: paraData(e.target.value) })}
              aria-label="Prazo do card"
              className="rounded bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            />
          </label>

          <label className="flex items-center gap-1 text-[11px] text-ink-400">
            Prioridade
            <select
              value={card.priority}
              onChange={(e) => aplicar({ priority: e.target.value as CardPriority })}
              aria-label="Prioridade do card"
              className="rounded bg-ink-800 px-1.5 py-1 text-xs text-ink-200 outline-none
                         focus:ring-1 focus:ring-accent-400"
            >
              {CARD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PRIORIDADE[p]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* RF-28: coluna única com preview alternável — não é o split da nota. */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-ink-400">
              Descrição
            </p>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              aria-pressed={preview}
              className="rounded px-1.5 py-0.5 text-[11px] text-ink-400 hover:text-ink-200"
            >
              {preview ? "editar" : "ver formatado"}
            </button>
          </div>

          {preview ? (
            <div
              className="preview min-h-24 rounded bg-ink-900/60 px-3 py-2 text-sm"
              // Sanitizado por DOMPurify em renderMarkdown (RNF-16).
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <textarea
              value={rascunho.descriptionMd}
              onChange={(e) => setRascunho((r) => ({ ...r, descriptionMd: e.target.value }))}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  salvarAgora();
                }
              }}
              rows={6}
              placeholder="Detalhes em Markdown…"
              aria-label="Descrição do card"
              className="w-full resize-y rounded bg-ink-900/60 px-3 py-2 font-mono text-xs
                         leading-relaxed text-ink-200 outline-none placeholder:text-ink-400/50
                         focus:ring-1 focus:ring-accent-400"
            />
          )}
        </section>

        {/* RF-30 */}
        <section>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            Checklist {checklist.length > 0 && `${feitos}/${checklist.length}`}
          </p>

          <ul className="space-y-1">
            {checklist.map((item, i) => (
              <li key={item.id} className="group flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    mudarChecklist(
                      checklist.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
                    )
                  }
                  aria-label={item.text}
                  className="size-3.5 shrink-0 accent-accent-500"
                />
                <input
                  defaultValue={item.text}
                  onBlur={(e) => {
                    const text = e.target.value.trim();
                    if (!text || text === item.text) return;
                    mudarChecklist(checklist.map((x) => (x.id === item.id ? { ...x, text } : x)));
                  }}
                  aria-label={`Texto do item ${i + 1}`}
                  className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs outline-none
                              focus:bg-ink-800 ${
                                item.done ? "text-ink-400 line-through" : "text-ink-200"
                              }`}
                />
                <span className="hidden shrink-0 gap-0.5 group-hover:flex group-focus-within:flex">
                  <button
                    type="button"
                    onClick={() => {
                      if (i === 0) return;
                      const copia = [...checklist];
                      const [movido] = copia.splice(i, 1);
                      if (movido) copia.splice(i - 1, 0, movido);
                      mudarChecklist(copia);
                    }}
                    aria-label={`Subir item ${i + 1}`}
                    className="rounded px-1 text-[10px] text-ink-400 hover:text-ink-200"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (i === checklist.length - 1) return;
                      const copia = [...checklist];
                      const [movido] = copia.splice(i, 1);
                      if (movido) copia.splice(i + 1, 0, movido);
                      mudarChecklist(copia);
                    }}
                    aria-label={`Descer item ${i + 1}`}
                    className="rounded px-1 text-[10px] text-ink-400 hover:text-ink-200"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => mudarChecklist(checklist.filter((x) => x.id !== item.id))}
                    aria-label={`Remover item ${i + 1}`}
                    className="rounded px-1 text-[10px] text-ink-400 hover:text-red-300"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>

          {checklist.length < MAX_CHECKLIST_ITENS && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = novoItem.trim();
                if (!text) return;
                setNovoItem("");
                mudarChecklist([...checklist, { id: crypto.randomUUID(), text, done: false }]);
              }}
            >
              <input
                value={novoItem}
                onChange={(e) => setNovoItem(e.target.value)}
                placeholder="+ item"
                aria-label="Novo item do checklist"
                className="mt-1 w-full rounded bg-transparent px-1 py-1 text-xs text-ink-200
                           outline-none placeholder:text-ink-400/60 hover:bg-ink-800
                           focus:bg-ink-800"
              />
            </form>
          )}
        </section>

        {/* RF-35 / RF-36 / RF-37 */}
        <section>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            Nota vinculada
          </p>

          {card.note ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => card.note && onAbrirNota(card.note.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-ink-700
                           px-2 py-1 text-left text-xs text-ink-200 hover:border-accent-400"
              >
                <span aria-hidden="true">📎</span>
                <span className="truncate">{card.note.title}</span>
                <RotuloTipo tipo={card.note.kind} className="ml-auto shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => aplicar({ noteId: null })}
                aria-label="Desvincular nota"
                className="shrink-0 rounded px-1.5 text-xs text-ink-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <input
                value={buscaNota}
                onChange={(e) => setBuscaNota(e.target.value)}
                placeholder="Buscar nota por título…"
                aria-label="Buscar nota para vincular"
                className="w-full rounded bg-ink-800 px-2 py-1 text-xs text-ink-200 outline-none
                           placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
              />
              {sugestoes.length > 0 && (
                <ul className="overflow-hidden rounded border border-ink-700">
                  {sugestoes.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setBuscaNota("");
                          aplicar({ noteId: s.id });
                        }}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs
                                   text-ink-200 hover:bg-ink-700"
                      >
                        <span className="truncate">{s.title}</span>
                        <RotuloTipo tipo={s.kind} className="ml-auto shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={vincularNotaNova}
                className="w-full rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-400
                           hover:border-accent-400 hover:text-ink-200"
              >
                Criar nota com o título do card
              </button>
            </div>
          )}
        </section>
      </div>

      {/* RF-33 / RF-34 */}
      <footer className="mt-auto flex shrink-0 gap-2 border-t border-ink-800 px-4 py-3">
        <button
          type="button"
          onClick={() => aplicar({ archived: !card.archived })}
          className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200
                     hover:border-accent-400"
        >
          {card.archived ? "Desarquivar" : "Arquivar"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!confirm(`Excluir o card "${card.title}"? Não há lixeira de card.`)) return;
            excluir.mutate({ id: cardId, boardId: card.boardId }, { onSuccess: onFechar });
          }}
          className="ml-auto rounded px-2 py-1 text-[11px] text-ink-400 hover:text-red-300"
        >
          Excluir
        </button>
      </footer>
    </div>
  );
}
