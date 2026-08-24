import type { BoardDetail, ColumnDetail } from "@yu-book/shared";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Announcements, DragOverEvent, DragStartEvent, DragEndEvent, Over } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { useMoverCard, useMoverColuna } from "../lib/kanban";
import { cardCasaFiltro } from "../lib/tags";
import { CartaoCard } from "./CartaoCard";
import { ColunaQuadro, idColunaArrastavel } from "./ColunaQuadro";

/** Qual coluna está embaixo do ponteiro: outro card, a área vazia ou a coluna. */
function colunaDeOver(colunas: ColumnDetail[], over: Over): string | null {
  const dados = over.data.current;
  if (dados?.tipo === "card") return String(dados.columnId);
  if (dados?.tipo === "zona") return String(dados.columnId);

  const id = String(over.id);
  if (id.startsWith("coluna:")) return id.slice("coluna:".length);
  return colunas.find((c) => c.cards.some((card) => card.id === id))?.id ?? null;
}

/** Move em memória; a mesma conta que a API refaz ao confirmar (RN-01). */
function moverLocal(
  colunas: ColumnDetail[],
  cardId: string,
  destinoId: string,
  indice: number,
): ColumnDetail[] {
  const card = colunas.flatMap((c) => c.cards).find((c) => c.id === cardId);
  if (!card) return colunas;

  return colunas.map((coluna) => {
    if (coluna.id === destinoId) {
      const cards = coluna.cards.filter((c) => c.id !== cardId);
      cards.splice(Math.min(Math.max(indice, 0), cards.length), 0, {
        ...card,
        columnId: destinoId,
      });
      return { ...coluna, cards };
    }
    if (coluna.cards.some((c) => c.id === cardId)) {
      return { ...coluna, cards: coluna.cards.filter((c) => c.id !== cardId) };
    }
    return coluna;
  });
}

function posicaoDoCard(colunas: ColumnDetail[], cardId: string) {
  for (const coluna of colunas) {
    const indice = coluna.cards.findIndex((c) => c.id === cardId);
    if (indice >= 0) return { columnId: coluna.id, indice, nomeColuna: coluna.name };
  }
  return null;
}

interface QuadroProps {
  board: BoardDetail;
  cardAtivoId: string | null;
  /** RF-08: tags selecionadas na barra de filtro. Vazio significa sem filtro. */
  tagsFiltro: string[];
  onAbrirCard: (id: string) => void;
}

export function Quadro({ board, cardAtivoId, tagsFiltro, onAbrirCard }: QuadroProps) {
  const mover = useMoverCard(board.id);
  const moverColuna = useMoverColuna();

  const [colunas, setColunas] = useState<ColumnDetail[]>(board.columns);
  const [arrastando, setArrastando] = useState<{ tipo: string; id: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * RN-05: com filtro ativo, o arraste é desligado.
   *
   * O índice de destino é contado sobre a lista renderizada. Se ela estiver
   * filtrada, "soltar na segunda posição" vira a segunda posição *do recorte*,
   * e o servidor renumera a coluna inteira em cima disso (RN-01/INV-11) — a
   * ordem real embaralha sem ninguém ver. Recusar o gesto é mais honesto do que
   * traduzir índices e torcer.
   */
  const filtrando = tagsFiltro.length > 0;

  // Durante o arrasto quem manda é o estado local; fora dele, o servidor.
  useEffect(() => {
    if (!arrastando) setColunas(board.columns);
  }, [board.columns, arrastando]);

  const sensors = useSensors(
    // 4px de folga: um clique para abrir o card não pode virar arrasto.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // RF-25: Espaço pega e solta, Esc cancela. Enter fica livre para abrir
      // o card — é o padrão do dnd-kit que precisaria roubá-lo.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const tituloDoCard = (id: string) =>
    colunas.flatMap((c) => c.cards).find((c) => c.id === id)?.title ?? "card";

  /** CA-15: cada etapa do arrasto é anunciada. */
  const anuncios: Announcements = {
    onDragStart: ({ active }) => {
      const pos = posicaoDoCard(colunas, String(active.id));
      return pos
        ? `${tituloDoCard(String(active.id))} pego, coluna ${pos.nomeColuna}, posição ${pos.indice + 1}.`
        : "Coluna pega.";
    },
    onDragOver: ({ active, over }) => {
      if (!over) return;
      const pos = posicaoDoCard(colunas, String(active.id));
      return pos
        ? `${tituloDoCard(String(active.id))} sobre a coluna ${pos.nomeColuna}, posição ${pos.indice + 1}.`
        : undefined;
    },
    onDragEnd: ({ active }) => {
      const pos = posicaoDoCard(colunas, String(active.id));
      return pos
        ? `${tituloDoCard(String(active.id))} solto em ${pos.nomeColuna}, posição ${pos.indice + 1}.`
        : "Solto.";
    },
    onDragCancel: ({ active }) =>
      `Movimento cancelado. ${tituloDoCard(String(active.id))} voltou para onde estava.`,
  };

  function aoIniciar(evento: DragStartEvent) {
    setErro(null);
    setArrastando({
      tipo: String(evento.active.data.current?.tipo ?? "card"),
      id: String(evento.active.id),
    });
  }

  function aoPassar(evento: DragOverEvent) {
    const { active, over } = evento;
    if (!over || active.data.current?.tipo !== "card") return;
    const cardId = String(active.id);

    setColunas((atual) => {
      const destinoId = colunaDeOver(atual, over);
      if (!destinoId) return atual;

      const destino = atual.find((c) => c.id === destinoId);
      if (!destino) return atual;

      const sobreCard = over.data.current?.tipo === "card";
      const alvo = sobreCard ? destino.cards.findIndex((c) => c.id === String(over.id)) : -1;
      const indice = alvo >= 0 ? alvo : destino.cards.length;

      const atualPos = posicaoDoCard(atual, cardId);
      if (atualPos?.columnId === destinoId && atualPos.indice === indice) return atual;

      return moverLocal(atual, cardId, destinoId, indice);
    });
  }

  function aoTerminar(evento: DragEndEvent) {
    const { active, over } = evento;
    const tipo = active.data.current?.tipo;
    setArrastando(null);

    if (tipo === "coluna") {
      if (!over) return;
      const alvo = String(over.id);
      const destino = alvo.startsWith("coluna:")
        ? alvo.slice("coluna:".length)
        : colunaDeOver(colunas, over);
      const id = String(active.id).slice("coluna:".length);
      const position = colunas.findIndex((c) => c.id === destino);
      if (position < 0 || destino === id) return;

      moverColuna.mutate(
        { id, position },
        { onError: (e) => setErro(mensagem(e, "Não foi possível mover a coluna.")) },
      );
      return;
    }

    const cardId = String(active.id);
    const destino = posicaoDoCard(colunas, cardId);
    const origem = posicaoDoCard(board.columns, cardId);
    if (!destino) return;
    if (origem && origem.columnId === destino.columnId && origem.indice === destino.indice) return;

    mover.mutate(
      { id: cardId, columnId: destino.columnId, position: destino.indice },
      { onError: (e) => setErro(mensagem(e, "Não foi possível mover o card.")) },
    );
  }

  const cardArrastado =
    arrastando?.tipo === "card"
      ? colunas.flatMap((c) => c.cards).find((c) => c.id === arrastando.id)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* RNF-20: o erro fica na tela até você fechar — o board não recarrega. */}
      {erro && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-3 rounded bg-red-500/15 px-3 py-2 text-xs
                     text-red-200 ring-1 ring-red-500/30"
        >
          {erro}
          <button
            type="button"
            onClick={() => setErro(null)}
            aria-label="Fechar aviso"
            className="ml-auto text-red-300"
          >
            ×
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements: anuncios }}
        onDragStart={aoIniciar}
        onDragOver={aoPassar}
        onDragEnd={aoTerminar}
        onDragCancel={() => setArrastando(null)}
      >
        {/* RNF-06: o board rola na horizontal; cada coluna rola sozinha. */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          <SortableContext
            items={colunas.map((c) => idColunaArrastavel(c.id))}
            strategy={horizontalListSortingStrategy}
          >
            {colunas.map((coluna) => (
              <ColunaQuadro
                key={coluna.id}
                coluna={coluna}
                colunas={colunas}
                // `coluna.cards` continua inteira: é dela que sai o índice de
                // destino (INV-33). O filtro só decide o que é pintado.
                //
                // RF-25: sem filtro, devolve a MESMA referência. Como INV-33
                // desliga o arraste quando há filtro, durante qualquer gesto
                // isto é sempre um no-op — e as colunas que `moverLocal` não
                // tocou preservam identidade e param de repintar.
                cardsVisiveis={
                  filtrando ? coluna.cards.filter((c) => cardCasaFiltro(c.tags, tagsFiltro)) : coluna.cards
                }
                arrasteDesativado={filtrando}
                cardAtivoId={cardAtivoId}
                onAbrirCard={onAbrirCard}
              />
            ))}
          </SortableContext>
        </div>

        <DragOverlay>
          {cardArrastado ? (
            <div className="w-72 rotate-1">
              <CartaoCard card={cardArrastado} arrastando />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function mensagem(erro: unknown, padrao: string): string {
  return erro instanceof ApiError ? erro.message : padrao;
}
