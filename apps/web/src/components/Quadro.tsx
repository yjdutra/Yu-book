import type { BoardDetail, CardSummary, ColumnDetail } from "@yu-book/shared";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  Announcements,
  ClientRect,
  CollisionDetection,
  DragOverEvent,
  DropAnimation,
  DragStartEvent,
  DragEndEvent,
  Over,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useConcluirCard, useMoverCard, useMoverColuna } from "../lib/kanban";
import { cardCasaFiltro } from "../lib/tags";
import { Aviso } from "./base/Aviso";
import { CartaoCard } from "./CartaoCard";
import { ColunaQuadro, idColunaArrastavel } from "./ColunaQuadro";

/**
 * RF-21: a faixa que dispara a rolagem automática, por eixo.
 *
 * O default é 0,2 da medida do contêiner nos DOIS eixos — num board de 1400px
 * isso é uma faixa horizontal de 280px em cada borda. Como o dnd-kit percorre
 * os contêineres roláveis do mais externo para o mais interno e **para no
 * primeiro que consegue rolar**, essa faixa engole o gesto antes de chegar na
 * coluna: a primeira e a última coluna de um board largo nunca rolariam na
 * vertical. Faixa horizontal estreita, faixa vertical um pouco mais generosa.
 */
const ROLAGEM = { threshold: { x: 0.06, y: 0.22 } };

const ASSENTAMENTO: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

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

/**
 * RF-18: o índice de destino é **quantos cards da coluna têm o ponto médio
 * acima do ponteiro**, ignorando o card que está sendo arrastado.
 *
 * A formulação óbvia — "estou sobre qual card, antes ou depois da metade dele" —
 * oscila: inserir empurra o card sob o cursor, a metade dele cruza o ponteiro,
 * e a conta se inverte no frame seguinte, de volta e de novo, com a mão parada.
 *
 * Esta é idempotente por construção. Inserir na posição k empurra para baixo só
 * quem tem índice >= k; quem estava acima do ponteiro continua acima, quem
 * estava abaixo continua abaixo, e recontar devolve k. É um ponto fixo, e não
 * depende da altura do card arrastado nem de onde ele foi pego.
 *
 * De quebra, funciona nos 8px de `gap` entre dois cards e no espaço vazio da
 * coluna, onde não existe "card sob o cursor" nenhum.
 */
function indicePorPonteiro(
  cards: CardSummary[],
  cardAtivoId: string,
  y: number,
  rects: Map<UniqueIdentifier, ClientRect>,
): number {
  let indice = 0;
  for (const card of cards) {
    if (card.id === cardAtivoId) continue;
    const rect = rects.get(card.id);
    // Card ainda não medido não conta: contá-lo por engano deslocaria a fila
    // inteira. Ele entra na conta assim que o dnd-kit o medir.
    if (rect && rect.top + rect.height / 2 < y) indice += 1;
  }
  return indice;
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
  const concluir = useConcluirCard(board.id);

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

  /**
   * O que a última detecção de colisão viu. `onDragOver` não recebe ponteiro
   * nem retângulos, e lê-los daqui garante que sejam exatamente os dados que
   * produziram aquele `over` — não uma segunda medição, um frame fora de fase.
   */
  const ultimaColisao = useRef<{
    ponteiro: { x: number; y: number } | null;
    rects: Map<UniqueIdentifier, ClientRect>;
  }>({ ponteiro: null, rects: new Map() });

  /**
   * RF-19: o ponteiro decide; o retângulo é a rede de segurança.
   *
   * Encadeado, nunca concatenado: `data.value` tem escalas incompatíveis entre
   * os algoritmos (distância ascendente em `pointerWithin` e `closestCorners`,
   * razão de interseção descendente em `rectIntersection`), e só o primeiro
   * item do array importa — o dnd-kit usa `getFirstCollision`.
   *
   * `pointerWithin` devolve vazio quando não há ponteiro, que é sempre o caso
   * do teclado (RF-26 / INV-30). Por isso o fallback é obrigatório, não
   * refinamento: sem ele o arraste por teclado para de achar destino.
   */
  const detectarColisao = useCallback<CollisionDetection>((args) => {
    ultimaColisao.current = { ponteiro: args.pointerCoordinates, rects: args.droppableRects };

    const porPonteiro = pointerWithin(args);
    if (porPonteiro.length > 0) return porPonteiro;

    const porIntersecao = rectIntersection(args);
    if (porIntersecao.length > 0) return porIntersecao;

    return closestCorners(args);
  }, []);

  /**
   * RF-23: o cursor de "segurando" enquanto o gesto durar.
   *
   * Num efeito com limpeza, e não em `aoTerminar`: aquele tem quatro saídas
   * antecipadas, e o componente ainda pode desmontar no meio do arraste (trocar
   * de board). Qualquer um desses caminhos deixaria a página travada em
   * `grabbing`.
   */
  useEffect(() => {
    if (!arrastando) return;
    document.documentElement.setAttribute("data-arrastando", "");
    return () => document.documentElement.removeAttribute("data-arrastando");
  }, [arrastando]);

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
    const { ponteiro, rects } = ultimaColisao.current;

    setColunas((atual) => {
      // `over` responde uma pergunta só: qual coluna. A posição dentro dela é
      // geometria, não "sobre qual card estou".
      const destinoId = colunaDeOver(atual, over);
      if (!destinoId) return atual;

      const destino = atual.find((c) => c.id === destinoId);
      if (!destino) return atual;

      let indice: number;
      if (ponteiro) {
        indice = indicePorPonteiro(destino.cards, cardId, ponteiro.y, rects);
      } else {
        /*
         * Ramo do teclado (INV-30), inalterado desde a Fase 2.
         *
         * O off-by-one aparente está certo: `moverLocal` remove o card ANTES do
         * splice, então "inserir no índice do alvo" já significa DEPOIS dele
         * quando o movimento é para baixo na mesma coluna — que é a semântica
         * que as setas querem. O bug do "nunca depois do último" era só entre
         * colunas, onde o card não está na lista e o filtro não desloca nada.
         */
        const sobreCard = over.data.current?.tipo === "card";
        const alvo = sobreCard ? destino.cards.findIndex((c) => c.id === String(over.id)) : -1;
        indice = alvo >= 0 ? alvo : destino.cards.length;
      }

      // `indice` é posição na lista sem o card ativo; `posicaoDoCard` devolve a
      // posição na lista com ele. Os dois coincidem no resultado final, porque
      // inserir em k na lista filtrada deixa o card em k na lista completa.
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

  // Estável: vai até cada card, e as colunas que o arraste não tocou não
  // podem repintar por causa de uma função nova (RF-25).
  const { mutate: mutarConclusao } = concluir;
  const concluirCard = useCallback(
    (id: string, completed: boolean) => {
      setErro(null);
      mutarConclusao(
        { id, completed },
        { onError: (e) => setErro(mensagem(e, "Não foi possível concluir o card.")) },
      );
    },
    [mutarConclusao],
  );

  const idsDasColunas = useMemo(
    () => colunas.map((c) => idColunaArrastavel(c.id)),
    [colunas],
  );

  const cardArrastado =
    arrastando?.tipo === "card"
      ? colunas.flatMap((c) => c.cards).find((c) => c.id === arrastando.id)
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* RNF-20: o erro fica na tela até você fechar — o board não recarrega. */}
      {erro && (
        <Aviso tom="erro" onFechar={() => setErro(null)} className="mx-4 mt-3">
          {erro}
        </Aviso>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={detectarColisao}
        autoScroll={ROLAGEM}
        accessibility={{ announcements: anuncios }}
        onDragStart={aoIniciar}
        onDragOver={aoPassar}
        onDragEnd={aoTerminar}
        onDragCancel={() => setArrastando(null)}
      >
        {/* RNF-06: o board rola na horizontal; cada coluna rola sozinha. */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          <SortableContext items={idsDasColunas} strategy={horizontalListSortingStrategy}>
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
                onConcluirCard={concluirCard}
              />
            ))}
          </SortableContext>
        </div>

        {/* O assentamento ao soltar: sem ele o card some do cursor e reaparece
            na coluna, e o olho perde o movimento. */}
        <DragOverlay dropAnimation={ASSENTAMENTO}>
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
