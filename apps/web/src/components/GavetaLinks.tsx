import type { Link, LinkKind } from "@yu-book/shared";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { ordenar, useAtualizarLink, useMoverLink, useRebuscarTitulo } from "../lib/links";
import { DIAS_PARA_ENVELHECER, diasDesde, idadeRelativa } from "../lib/tempo";
import { Aviso } from "./base/Aviso";
import { Botao, BotaoIcone } from "./base/Botao";
import { Dialogo } from "./base/Dialogo";
import { Tecla } from "./base/Tecla";
import { BlocoDominio } from "./BlocoDominio";
import {
  IconeAlerta,
  IconeCheck,
  IconeEstrela,
  IconeFechar,
  IconeLapis,
  IconeRecarregar,
  IconeRelogio,
} from "./Icones";
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
            return;
          }
          // Composto com o do `KeyboardSensor`, e não no lugar dele: um
          // `onKeyDown` escrito depois de `{...listeners}` o sobrescrevia, e o
          // arraste dos favoritos por teclado nunca começava.
          (listeners?.onKeyDown as ((ev: React.KeyboardEvent) => void) | undefined)?.(e);
        }}
        title={link.url}
        className={`flex cursor-grab flex-col items-center gap-1.5 rounded-cartao border p-3
                    text-center outline-none transition focus-visible:ring-2
                    focus-visible:ring-accent-400 ${
                      destacado
                        ? "border-accent-400 bg-accent-500/10"
                        : "border-ink-700 hover:border-ink-400"
                    }`}
      >
        <BlocoDominio domain={link.domain} tamanho="md" />
        <span className="line-clamp-2 text-xs text-ink-200">{link.title}</span>
        <span className="truncate text-miudo text-ink-400">{link.domain}</span>
      </a>

      <span
        className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex
                   group-focus-within:flex"
      >
        <button
          type="button"
          onClick={() => onRenomear(link)}
          aria-label={`Renomear ${link.title}`}
          title="Renomear"
          className="rounded-etiqueta bg-ink-800 p-1 text-ink-400 shadow-e1 hover:text-ink-200"
        >
          <IconeLapis className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onExcluir(link)}
          aria-label={`Excluir ${link.title}`}
          title="Excluir"
          className="rounded-etiqueta bg-ink-800 p-1 text-ink-400 shadow-e1 hover:text-red-300"
        >
          <IconeFechar className="size-3" />
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
  /**
   * O link removido há pouco, à espera do desfazer (RF-28). Com a gaveta
   * aberta, o desfazer mora aqui dentro: o diálogo prende o foco e esconde o
   * resto da tela do leitor de tela, e o aviso flutuante ficaria inalcançável
   * justo quando mais se usa — ao apagar com Delete, daqui de dentro.
   */
  desfazivel: Link | null;
  onDesfazer: () => void;
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
  desfazivel,
  onDesfazer,
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
  /**
   * Durante o arraste por teclado as setas movem o favorito — e borbulham até
   * `teclasDaGaveta`, que trocaria de aba e desmontaria a grade no meio do
   * gesto. Ref, não estado: só é lido dentro do handler.
   */
  const arrastando = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Espaço pega e solta; Enter fica livre para abrir o link.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // O foco inicial é do `Dialogo` (`focoInicial`). Montada por `&&`, a gaveta
  // nunca vê `aberta` falso (INV-53): este reset só vale para a prop viva.
  useEffect(() => {
    if (!aberta) return;
    setFiltro("");
    setRenomeando(null);
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

  function salvarNovaUrl(kind: LinkKind) {
    const url = novaUrl.trim();
    if (!url) return;
    setNovaUrl("");
    onSalvar(url, kind);
    setAba(kind);
  }

  function aoTerminarArrasto(evento: DragEndEvent) {
    arrastando.current = false;
    const { active, over } = evento;
    if (!over || active.id === over.id) return;

    const ordemAtual = ordenar(links, "favorito");
    const destino = ordemAtual.findIndex((l) => l.id === over.id);
    if (destino < 0) return;

    mover.mutate({ id: String(active.id), position: destino });
  }

  // O Esc é do `Dialogo` (e do `fecharTudo` global); aqui só as setas.
  /**
   * RF-05: colar uma URL com a gaveta aberta salva na aba visível. No
   * documento, e não num elemento: com o foco na própria caixa do diálogo
   * (um clique em área vazia), o evento não passaria por nenhum filho.
   * A gaveta só existe montada enquanto está aberta.
   */
  useEffect(() => {
    function colar(e: ClipboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA") return;
      const texto = e.clipboardData?.getData("text/plain").trim();
      if (texto) {
        e.preventDefault();
        onSalvar(texto, aba);
      }
    }
    document.addEventListener("paste", colar);
    return () => document.removeEventListener("paste", colar);
  }, [aba, onSalvar]);

  function teclasDaGaveta(e: React.KeyboardEvent) {
    // RF-18: setas trocam de aba, exceto quando o cursor está num campo.
    const alvo = e.target as HTMLElement;
    if (alvo.tagName === "INPUT" || arrastando.current) return;
    if (e.key === "ArrowLeft") setAba("favorito");
    if (e.key === "ArrowRight") setAba("depois");
  }

  const abas = [
    ["favorito", "Favoritos", links.filter((l) => l.kind === "favorito").length],
    ["depois", "Ver depois", contagemDepois],
  ] as const;

  return (
    <Dialogo
      aberto={aberta}
      posicao="lateral"
      largura="max-w-md"
      rotulo="Gaveta de links"
      focoInicial={campoRef}
      onFechar={onFechar}
    >
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={teclasDaGaveta}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-sm font-semibold text-titulo">Links</h2>
          <BotaoIcone
            rotulo="Fechar a gaveta"
            icone={<IconeFechar className="size-3.5" />}
            onClick={onFechar}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-4 pb-3">
          <div role="group" aria-label="Lista" className="flex rounded-controle bg-ink-900 p-0.5">
            {abas.map(([valor, rotulo, total]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                aria-pressed={aba === valor}
                className={`rounded-controle px-2.5 py-1 text-xs font-medium transition ${
                  aba === valor
                    ? "bg-superficie text-titulo shadow-e1"
                    : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {rotulo}
                <span className="ml-1.5 tabular-nums opacity-70">{total}</span>
              </button>
            ))}
          </div>

          <input
            ref={campoRef}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="filtrar…"
            aria-label="Filtrar links"
            className="ml-auto w-32 min-w-0 rounded-controle bg-ink-900 px-2 py-1 text-xs
                       text-ink-200 outline-none placeholder:text-ink-400/60 focus:ring-1
                       focus:ring-accent-400"
          />
        </div>

        {erroCaptura && (
          <Aviso tom="erro" onFechar={onLimparErro} className="mx-4 mt-3 shrink-0">
            {erroCaptura}
          </Aviso>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
              onDragStart={() => {
                arrastando.current = true;
              }}
              onDragCancel={() => {
                arrastando.current = false;
              }}
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
                          className="w-full rounded-controle bg-ink-900 px-2 py-1 text-xs
                                     text-ink-200 outline-none focus:ring-1 focus:ring-accent-400"
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
                    {/* RNF-10: item velho tem símbolo, não só cor — e a idade em texto. */}
                    <span className="flex w-4 shrink-0 justify-center text-amber-300">
                      {velho && <IconeAlerta className="size-3.5" />}
                    </span>
                    <MiniaturaLink link={link} />

                    <a
                      href={link.url}
                      {...ALVO}
                      title={link.url}
                      className="min-w-0 flex-1 rounded-etiqueta outline-none focus-visible:ring-2
                                 focus-visible:ring-accent-400"
                      onKeyDown={(e) => {
                        if (e.key === "Delete" || e.key === "Backspace") {
                          e.preventDefault();
                          onRemover(link);
                        }
                      }}
                    >
                      <span className="block truncate text-sm text-ink-200">{link.title}</span>
                      <span className="block truncate text-miudo text-ink-400">
                        {link.domain}
                      </span>
                    </a>

                    <span
                      className={`shrink-0 text-miudo tabular-nums ${
                        velho ? "text-amber-300" : "text-ink-400"
                      }`}
                    >
                      {idadeRelativa(link.createdAt)}
                      {velho && <span className="sr-only"> (antigo)</span>}
                    </span>

                    <span
                      className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100
                                 group-focus-within:opacity-100"
                    >
                      {link.semTitulo && (
                        <button
                          type="button"
                          onClick={() => rebuscar.mutate(link.id)}
                          aria-label={`Buscar o título de ${link.domain}`}
                          title="Tentar ler o título da página"
                          className="rounded-etiqueta p-1 text-ink-400 hover:text-ink-200"
                        >
                          <IconeRecarregar className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Concluir ${link.title}`}
                        title="Concluir — remove da fila"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-emerald-300"
                      >
                        <IconeCheck className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          atualizar.mutate({ id: link.id, input: { kind: "favorito" } })
                        }
                        aria-label={`Mover ${link.title} para favoritos`}
                        title="Mover para favoritos"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-amber-300"
                      >
                        <IconeEstrela className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemover(link)}
                        aria-label={`Excluir ${link.title}`}
                        title="Excluir"
                        className="rounded-etiqueta p-1 text-ink-400 hover:text-red-300"
                      >
                        <IconeFechar className="size-3.5" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RF-28: o desfazer, aqui dentro enquanto a gaveta está aberta. */}
        {desfazivel && (
          <Aviso tom="info" className="mx-4 mb-2 shrink-0">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">“{desfazivel.title}” saiu da gaveta</span>
              <Botao variante="fantasma" onClick={onDesfazer} className="-my-1">
                Desfazer
              </Botao>
            </span>
          </Aviso>
        )}

        {/* RF-06: o campo mora no pé, fora da rolagem — sempre à mão. */}
        <form
          className="flex shrink-0 items-center gap-2 border-t border-ink-700 px-4 py-2.5"
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
            className="min-w-0 flex-1 rounded-controle bg-ink-900 px-2 py-1.5 text-sm text-ink-200
                       outline-none placeholder:text-ink-400/60 focus:ring-1
                       focus:ring-accent-400"
          />
          <Botao
            icone={<IconeEstrela className="size-3.5" />}
            onClick={() => salvarNovaUrl("favorito")}
          >
            favorito
          </Botao>
          <Botao
            icone={<IconeRelogio className="size-3.5" />}
            onClick={() => salvarNovaUrl("depois")}
          >
            ver depois
          </Botao>
          {/* Enter no campo salva na aba visível; os botões escolhem a lista. */}
          <button type="submit" className="sr-only">
            Salvar na aba atual
          </button>
        </form>

        <div
          className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 px-4 py-2
                     text-miudo text-ink-400"
        >
          <span className="flex items-center gap-1.5">
            <Tecla combo="←" />
            <Tecla combo="→" /> trocar de aba
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Enter" /> abrir
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Del" /> remover
          </span>
          <span className="flex items-center gap-1.5">
            <Tecla combo="Esc" /> fechar
          </span>
        </div>
      </div>
    </Dialogo>
  );
}
