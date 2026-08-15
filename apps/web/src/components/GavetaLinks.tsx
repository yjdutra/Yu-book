import type { Link, LinkKind } from "@yu-book/shared";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { ordenar, useAtualizarLink, useMoverLink, useRebuscarTitulo } from "../lib/links";
import { DIAS_PARA_ENVELHECER, diasDesde, idadeRelativa } from "../lib/tempo";
import { BlocoDominio } from "./BlocoDominio";
import { MiniaturaLink } from "./MiniaturaLink";

/** RNF-16: a página aberta não pode ter referência à janela do Yu-book. */
const ALVO = { target: "_blank", rel: "noopener noreferrer" } as const;

interface FavoritoProps {
  link: Link;
  destacado: boolean;
  onRenomear: (link: Link) => void;
  onExcluir: (link: Link) => void;
}

function Favorito({ link, destacado, onRenomear, onExcluir }: FavoritoProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: link.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`group relative ${isDragging ? "opacity-40" : ""}`}
    >
      <a
        href={link.url}
        {...ALVO}
        {...attributes}
        {...listeners}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onExcluir(link);
          }
        }}
        title={link.url}
        className={`flex cursor-grab flex-col items-center gap-1.5 rounded-lg border p-3
                    text-center outline-none transition focus-visible:ring-2
                    focus-visible:ring-accent-400 ${
                      destacado
                        ? "border-accent-400 bg-accent-500/10"
                        : "border-ink-700 hover:border-ink-400"
                    }`}
      >
        <BlocoDominio domain={link.domain} tamanho="md" />
        <span className="line-clamp-2 text-xs text-ink-200">{link.title}</span>
        <span className="truncate text-[10px] text-ink-400">{link.domain}</span>
      </a>

      <span className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex group-focus-within:flex">
        <button
          type="button"
          onClick={() => onRenomear(link)}
          aria-label={`Renomear ${link.title}`}
          className="rounded bg-ink-800 px-1 text-[10px] text-ink-400 hover:text-ink-200"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => onExcluir(link)}
          aria-label={`Excluir ${link.title}`}
          className="rounded bg-ink-800 px-1 text-[10px] text-ink-400 hover:text-red-300"
        >
          ×
        </button>
      </span>
    </li>
  );
}

interface GavetaLinksProps {
  aberta: boolean;
  onFechar: () => void;
  links: Link[];
  onSalvar: (url: string, kind: LinkKind) => void;
  onRemover: (link: Link) => void;
  /** Link que acabou de ser reconhecido como repetido (RN-02). */
  destacado: string | null;
  erroCaptura: string | null;
  onLimparErro: () => void;
}

export function GavetaLinks({
  aberta,
  onFechar,
  links,
  onSalvar,
  onRemover,
  destacado,
  erroCaptura,
  onLimparErro,
}: GavetaLinksProps) {
  const atualizar = useAtualizarLink();
  const mover = useMoverLink();
  const rebuscar = useRebuscarTitulo();

  const [aba, setAba] = useState<LinkKind>("favorito");
  const [filtro, setFiltro] = useState("");
  const [novaUrl, setNovaUrl] = useState("");
  const [renomeando, setRenomeando] = useState<Link | null>(null);
  const [rascunho, setRascunho] = useState("");
  const campoRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Espaço pega e solta; Enter fica livre para abrir o link.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  useEffect(() => {
    if (!aberta) return;
    setFiltro("");
    setRenomeando(null);
    requestAnimationFrame(() => campoRef.current?.focus());
  }, [aberta]);

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    const lista = ordenar(links, aba);
    if (!termo) return lista;
    return lista.filter(
      (l) => l.title.toLowerCase().includes(termo) || l.domain.toLowerCase().includes(termo),
    );
  }, [links, aba, filtro]);

  const contagemDepois = links.filter((l) => l.kind === "depois").length;

  if (!aberta) return null;

  function salvarNovaUrl(kind: LinkKind) {
    const url = novaUrl.trim();
    if (!url) return;
    setNovaUrl("");
    onSalvar(url, kind);
    setAba(kind);
  }

  function aoTerminarArrasto(evento: DragEndEvent) {
    const { active, over } = evento;
    if (!over || active.id === over.id) return;

    const ordemAtual = ordenar(links, "favorito");
    const destino = ordemAtual.findIndex((l) => l.id === over.id);
    if (destino < 0) return;

    mover.mutate({ id: String(active.id), position: destino });
  }

  function teclasDaGaveta(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onFechar();
      return;
    }
    // RF-18: setas trocam de aba, exceto quando o cursor está num campo.
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") setAba("favorito");
    if (e.key === "ArrowRight") setAba("depois");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh]"
      onMouseDown={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gaveta de links"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={teclasDaGaveta}
        // RF-05: colar uma URL com a gaveta aberta salva na aba visível.
        onPaste={(e) => {
          const alvo = e.target as HTMLElement;
          if (alvo.tagName === "INPUT") return;
          const texto = e.clipboardData.getData("text/plain").trim();
          if (texto) {
            e.preventDefault();
            onSalvar(texto, aba);
          }
        }}
        className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl
                   border border-ink-700 bg-ink-800 shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-4 py-2">
          {(
            [
              ["favorito", "Favoritos", links.filter((l) => l.kind === "favorito").length],
              ["depois", "Ver depois", contagemDepois],
            ] as const
          ).map(([valor, rotulo, total]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setAba(valor)}
              aria-pressed={aba === valor}
              className={`rounded px-2.5 py-1 text-sm transition ${
                aba === valor ? "bg-ink-700 text-titulo" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {rotulo}
              <span className="ml-1.5 text-xs tabular-nums opacity-70">{total}</span>
            </button>
          ))}

          <input
            ref={campoRef}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="filtrar…"
            aria-label="Filtrar links"
            className="ml-auto w-40 rounded bg-ink-900 px-2 py-1 text-xs text-ink-200 outline-none
                       placeholder:text-ink-400/60 focus:ring-1 focus:ring-accent-400"
          />
        </div>

        {erroCaptura && (
          <p
            role="alert"
            className="flex items-center gap-2 border-b border-ink-700 bg-red-500/10 px-4 py-2
                       text-xs text-red-200"
          >
            {erroCaptura}
            <button
              type="button"
              onClick={onLimparErro}
              aria-label="Fechar aviso"
              className="ml-auto text-red-300"
            >
              ×
            </button>
          </p>
        )}

        <div className="min-h-32 flex-1 overflow-y-auto p-4">
          {visiveis.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-400">
              {filtro
                ? `Nada com “${filtro}”.`
                : aba === "favorito"
                  ? "Sem favoritos. Arraste um link para dentro da janela."
                  : "Fila vazia. Arraste aqui o que quiser ver depois."}
            </p>
          )}

          {aba === "favorito" && visiveis.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={aoTerminarArrasto}
            >
              <SortableContext items={visiveis.map((l) => l.id)} strategy={rectSortingStrategy}>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
                  {visiveis.map((link) =>
                    renomeando?.id === link.id ? (
                      <li key={link.id}>
                        <input
                          autoFocus
                          value={rascunho}
                          onChange={(e) => setRascunho(e.target.value)}
                          onBlur={() => setRenomeando(null)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const title = rascunho.trim();
                            if (title) atualizar.mutate({ id: link.id, input: { title } });
                            setRenomeando(null);
                          }}
                          aria-label={`Novo nome de ${link.title}`}
                          className="w-full rounded bg-ink-900 px-2 py-1 text-xs text-ink-200
                                     outline-none focus:ring-1 focus:ring-accent-400"
                        />
                      </li>
                    ) : (
                      <Favorito
                        key={link.id}
                        link={link}
                        destacado={destacado === link.id}
                        onRenomear={(l) => {
                          setRascunho(l.title);
                          setRenomeando(l);
                        }}
                        onExcluir={onRemover}
                      />
                    ),
                  )}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {aba === "depois" && visiveis.length > 0 && (
            <ul className="divide-y divide-ink-700/60">
              {visiveis.map((link) => {
                const velho = diasDesde(link.createdAt) >= DIAS_PARA_ENVELHECER;
                return (
                  <li
                    key={link.id}
                    className={`group flex items-center gap-3 py-2 ${
                      destacado === link.id ? "bg-accent-500/10" : ""
                    }`}
                  >
                    {/* RNF-10: item velho tem símbolo, não só cor. */}
                    <span className="w-4 shrink-0 text-center text-xs text-amber-300">
                      {velho ? "⚠" : ""}
                    </span>
                    <MiniaturaLink link={link} />

                    <a
                      href={link.url}
                      {...ALVO}
                      title={link.url}
                      className="min-w-0 flex-1 outline-none focus-visible:ring-2
                                 focus-visible:ring-accent-400"
                      onKeyDown={(e) => {
                        if (e.key === "Delete" || e.key === "Backspace") {
                          e.preventDefault();
                          onRemover(link);
                        }
                      }}
                    >
                      <span className="block truncate text-sm text-ink-200">{link.title}</span>
                      <span className="block truncate text-[11px] text-ink-400">
                        {link.domain}
                      </span>
                    </a>

                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        velho ? "text-amber-300" : "text-ink-400"
                      }`}
                    >
                      {idadeRelativa(link.createdAt)}
                    </span>

                    <span className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      {link.semTitulo && (
                        <button
                          type="button"
                          onClick={() => rebuscar.mutate(link.id)}
                          aria-label={`Buscar o título de ${link.domain}`}
                          title="Tentar ler o título da página"
                          className="rounded px-1 text-xs text-ink-400 hover:text-ink-200"
                        >
                          ⟳
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Concluir ${link.title}`}
                        title="Concluir — remove da fila"
                        className="rounded px-1 text-xs text-ink-400 hover:text-emerald-300"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => atualizar.mutate({ id: link.id, input: { kind: "favorito" } })}
                        aria-label={`Mover ${link.title} para favoritos`}
                        title="Mover para favoritos"
                        className="rounded px-1 text-xs text-ink-400 hover:text-amber-300"
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Excluir ${link.title}`}
                        className="rounded px-1 text-xs text-ink-400 hover:text-red-300"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RF-06 */}
        <form
          className="flex shrink-0 items-center gap-2 border-t border-ink-700 px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvarNovaUrl(aba);
          }}
        >
          <input
            value={novaUrl}
            onChange={(e) => setNovaUrl(e.target.value)}
            placeholder="+ cole uma URL aqui"
            aria-label="URL para salvar"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-200 outline-none
                       placeholder:text-ink-400/60"
          />
          <button
            type="button"
            onClick={() => salvarNovaUrl("favorito")}
            className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200
                       hover:border-accent-400"
          >
            ★ favorito
          </button>
          <button
            type="button"
            onClick={() => salvarNovaUrl("depois")}
            className="rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200
                       hover:border-accent-400"
          >
            ◷ ver depois
          </button>
          {/* Enter no campo salva na aba visível; os botões escolhem a lista. */}
          <button type="submit" className="sr-only">
            Salvar na aba atual
          </button>
        </form>

        <div className="flex shrink-0 gap-4 border-t border-ink-700 px-4 py-1.5 text-[11px] text-ink-400">
          <span>← → trocar de aba</span>
          <span>↵ abrir</span>
          <span>del remover</span>
          <span>esc fechar</span>
        </div>
      </div>
    </div>
  );
}
