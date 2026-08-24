import type { CardSummary, ColumnDetail } from "@yu-book/shared";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import type { SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useAtualizarColuna, useCriarCard, useExcluirColuna } from "../lib/kanban";
import { CartaoCard } from "./CartaoCard";

export const idColunaArrastavel = (id: string) => `coluna:${id}`;
export const idZonaDeSoltura = (id: string) => `zona:${id}`;

/**
 * Nenhum deslocamento por transform entre os cards.
 *
 * Quem abre o vão aqui é o DOM: `moverLocal` reordena o estado local a cada
 * `dragOver` e o React repinta a lista já na ordem nova. Uma estratégia de
 * ordenação por cima disso desloca *de novo* o que já foi deslocado —
 * `verticalListSortingStrategy` empurra o vizinho pela altura do card ativo, em
 * cima da lista que o DOM já reordenou, e o vizinho pula com a mão parada.
 *
 * Não é sempre: o `SortableContext` desliga os transforms enquanto os `items`
 * estão mudando, e volta a ligá-los no primeiro frame em que a lista se repete
 * — que é exatamente quando você para a mão para mirar.
 *
 * O arraste de COLUNA continua usando `horizontalListSortingStrategy` em
 * `Quadro.tsx`: lá os `items` não mudam durante o gesto, e o transform é o
 * único mecanismo que existe.
 */
const SEM_DESLOCAMENTO: SortingStrategy = () => null;

interface CardArrastavelProps {
  card: CardSummary;
  ativo: boolean;
  /** RN-05: filtro de tag ativo desliga o arraste, mas não o resto do card. */
  desativado: boolean;
  onAbrir: () => void;
}

function CardArrastavel({ card, ativo, desativado, onAbrir }: CardArrastavelProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: card.id,
    data: { tipo: "card", columnId: card.columnId },
    disabled: desativado,
  });

  return (
    // Sem `transform` nem `transition`: ver SEM_DESLOCAMENTO acima.
    <li
      ref={setNodeRef}
      // RF-22: o card que está no cursor deixa aqui o vão que ele vai ocupar.
      //
      // `outline` e não `border` de propósito — borda mudaria o box em 2px, e o
      // ResizeObserver de cada card remediria a coluna inteira no meio do gesto.
      //
      // E o card de dentro some com `opacity-0`, nunca com `visibility`: ele é
      // o elemento focado, e é nele que o KeyboardSensor escuta. Escondê-lo de
      // verdade tiraria o foco e mataria o arraste por teclado (INV-30).
      className={
        isDragging ? "rounded-lg outline-2 outline-dashed outline-accent-400" : undefined
      }
    >
      {/* O próprio card é o alvo de arrasto e o botão que abre o painel:
          Espaço pega (RF-25), Enter abre (RNF-01). */}
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label={`Card ${card.title}`}
        onClick={onAbrir}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAbrir();
          }
        }}
        className={`rounded-lg outline-none ring-accent-400 focus-visible:ring-2 ${
          desativado ? "cursor-pointer" : "cursor-grab"
        } ${ativo ? "ring-2" : ""} ${isDragging ? "opacity-0" : ""}`}
      >
        <CartaoCard card={card} />
      </div>
    </li>
  );
}

interface ColunaQuadroProps {
  coluna: ColumnDetail;
  /** As outras colunas: destino possível ao excluir esta com cards (RF-16). */
  colunas: ColumnDetail[];
  /**
   * O recorte de `coluna.cards` que o filtro de tag deixou passar (RF-08).
   * Sem filtro é a lista inteira. `coluna.cards` continua sendo a verdade para
   * contagem, limite de WIP e cálculo de posição.
   */
  cardsVisiveis: CardSummary[];
  arrasteDesativado: boolean;
  cardAtivoId: string | null;
  onAbrirCard: (id: string) => void;
}

export function ColunaQuadro({
  coluna,
  colunas,
  cardsVisiveis,
  arrasteDesativado,
  cardAtivoId,
  onAbrirCard,
}: ColunaQuadroProps) {
  const criarCard = useCriarCard();
  const atualizar = useAtualizarColuna();
  const excluir = useExcluirColuna();

  const [titulo, setTitulo] = useState("");
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(coluna.name);
  const [menu, setMenu] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const campoNovoRef = useRef<HTMLInputElement>(null);

  const sortable = useSortable({
    id: idColunaArrastavel(coluna.id),
    data: { tipo: "coluna" },
    disabled: arrasteDesativado,
  });
  // A zona de soltura cobre a coluna inteira: sem ela, coluna vazia não
  // aceitaria card nenhum.
  const { setNodeRef: refZona, isOver } = useDroppable({
    id: idZonaDeSoltura(coluna.id),
    data: { tipo: "zona", columnId: coluna.id },
  });

  /**
   * RF-25: o `SortableContext` guarda `items` por identidade e o valor de
   * contexto dele muda junto — array novo a cada render faria todo `useSortable`
   * da coluna repintar a cada frame do arraste.
   */
  const idsVisiveis = useMemo(() => cardsVisiveis.map((c) => c.id), [cardsVisiveis]);

  const excedido = coluna.wipLimit !== null && coluna.cards.length > coluna.wipLimit;
  const filtrada = cardsVisiveis.length !== coluna.cards.length;
  const outras = colunas.filter((c) => c.id !== coluna.id);

  function novoCard(e: React.FormEvent) {
    e.preventDefault();
    const title = titulo.trim();
    if (!title) return;
    // RF-22: o campo continua focado e vazio para o próximo.
    setTitulo("");
    criarCard.mutate({ columnId: coluna.id, title });
  }

  function confirmarExclusao(deleteCards: boolean) {
    setErro(null);
    excluir.mutate(
      {
        id: coluna.id,
        ...(deleteCards ? { deleteCards: true } : { moveCardsTo: destino }),
      },
      {
        onSuccess: () => setExcluindo(false),
        onError: (e) =>
          setErro(e instanceof ApiError ? e.message : "Não foi possível excluir a coluna."),
      },
    );
  }

  return (
    <section
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      aria-label={`Coluna ${coluna.name}`}
      onKeyDown={(e) => {
        // RNF-01: `N` cria card na coluna com foco, sem tirar a mão do teclado.
        const alvo = e.target as HTMLElement;
        if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey) return;
        if (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT") {
          return;
        }
        e.preventDefault();
        campoNovoRef.current?.focus();
      }}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-ink-900/60 ${
        sortable.isDragging ? "opacity-50" : ""
      }`}
    >
      <header className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          {/* Alça de arrasto separada: arrastar a coluna não pode competir
              com clicar no nome para renomear (RF-17). */}
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            disabled={arrasteDesativado}
            aria-label={`Mover coluna ${coluna.name}`}
            className="cursor-grab rounded px-0.5 text-ink-400 hover:text-ink-200
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⠿
          </button>

          {renomeando ? (
            <form
              className="flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const novo = nome.trim();
                if (novo && novo !== coluna.name) atualizar.mutate({ id: coluna.id, name: novo });
                setRenomeando(false);
              }}
            >
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onBlur={() => setRenomeando(false)}
                aria-label={`Novo nome da coluna ${coluna.name}`}
                className="w-full rounded bg-ink-800 px-1.5 py-0.5 text-sm text-ink-200
                           outline-none focus:ring-1 focus:ring-accent-400"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNome(coluna.name);
                setRenomeando(true);
              }}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink-200"
            >
              {coluna.name}
            </button>
          )}

          {/* RF-20 / RF-19: contagem e limite; estourado é sinalizado, não bloqueado. */}
          <span
            className={`shrink-0 rounded px-1 text-xs tabular-nums ${
              excedido ? "bg-amber-500/20 text-amber-300" : "text-ink-400"
            }`}
            title={
              filtrada
                ? `${cardsVisiveis.length} de ${coluna.cards.length} cards passam pelo filtro`
                : coluna.wipLimit === null
                  ? `${coluna.cards.length} cards`
                  : `${coluna.cards.length} de ${coluna.wipLimit} (limite de WIP)`
            }
          >
            {excedido && <span aria-hidden="true">⚠ </span>}
            {/* RF-09: filtrando, a contagem diz o recorte e o total. O aviso de
                WIP continua olhando o total — o limite é do trabalho em curso,
                não do que está na tela. */}
            {filtrada ? `${cardsVisiveis.length} de ${coluna.cards.length}` : coluna.cards.length}
            {!filtrada && coluna.wipLimit !== null && `/${coluna.wipLimit}`}
          </span>

          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            aria-label={`Opções da coluna ${coluna.name}`}
            className="shrink-0 rounded px-1 text-ink-400 hover:text-ink-200"
          >
            ⋯
          </button>
        </div>

        {excedido && (
          <p className="mt-1 text-[11px] text-amber-300">
            Acima do limite de WIP ({coluna.wipLimit}).
          </p>
        )}

        {menu && (
          <div className="mt-2 space-y-2 rounded border border-ink-700 bg-ink-800 p-2">
            <label className="flex items-center gap-2 text-[11px] text-ink-400">
              Limite de WIP
              <input
                type="number"
                min={1}
                max={99}
                defaultValue={coluna.wipLimit ?? ""}
                onBlur={(e) => {
                  const valor = e.target.value.trim();
                  const wipLimit = valor === "" ? null : Number(valor);
                  if (wipLimit !== coluna.wipLimit) atualizar.mutate({ id: coluna.id, wipLimit });
                }}
                placeholder="sem limite"
                aria-label={`Limite de WIP da coluna ${coluna.name}`}
                className="w-20 rounded bg-ink-900 px-1.5 py-0.5 text-ink-200 outline-none
                           focus:ring-1 focus:ring-accent-400"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                if (coluna.cards.length === 0) {
                  if (confirm(`Excluir a coluna "${coluna.name}"?`)) confirmarExclusao(true);
                  return;
                }
                setDestino(outras[0]?.id ?? "");
                setExcluindo(true);
              }}
              className="w-full rounded px-1 py-0.5 text-left text-[11px] text-ink-400
                         hover:text-red-300"
            >
              Excluir coluna
            </button>
          </div>
        )}

        {/* RF-16: com cards dentro, é preciso dizer o que fazer com eles. */}
        {excluindo && (
          <div role="group" aria-label="Excluir coluna com cards"
               className="mt-2 space-y-2 rounded border border-red-500/30 bg-red-500/5 p-2">
            <p className="text-[11px] text-ink-200">
              “{coluna.name}” tem {coluna.cards.length} card(s). O que fazer com eles?
            </p>
            {outras.length > 0 && (
              <div className="flex gap-1">
                <select
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  aria-label="Coluna de destino dos cards"
                  className="min-w-0 flex-1 rounded bg-ink-900 px-1.5 py-1 text-[11px] text-ink-200
                             outline-none focus:ring-1 focus:ring-accent-400"
                >
                  {outras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => confirmarExclusao(false)}
                  className="rounded border border-ink-700 px-2 text-[11px] text-ink-200
                             hover:border-accent-400"
                >
                  Mover
                </button>
              </div>
            )}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => confirmarExclusao(true)}
                className="flex-1 rounded border border-red-500/40 px-2 py-1 text-[11px]
                           text-red-300 hover:bg-red-500/10"
              >
                Excluir os {coluna.cards.length} cards
              </button>
              <button
                type="button"
                onClick={() => setExcluindo(false)}
                className="rounded px-2 py-1 text-[11px] text-ink-400 hover:text-ink-200"
              >
                Cancelar
              </button>
            </div>
            {erro && (
              <p role="alert" className="text-[11px] text-red-300">
                {erro}
              </p>
            )}
          </div>
        )}
      </header>

      <div
        ref={refZona}
        className={`min-h-16 flex-1 overflow-y-auto px-2 pb-2 ${
          isOver ? "rounded bg-accent-500/5" : ""
        }`}
      >
        <SortableContext items={idsVisiveis} strategy={SEM_DESLOCAMENTO}>
          <ul className="flex flex-col gap-2">
            {cardsVisiveis.map((card) => (
              <CardArrastavel
                key={card.id}
                card={card}
                ativo={card.id === cardAtivoId}
                desativado={arrasteDesativado}
                onAbrir={() => onAbrirCard(card.id)}
              />
            ))}
          </ul>
        </SortableContext>

        {cardsVisiveis.length === 0 && (
          // RNF-19: coluna vazia diz o que fazer, em vez de ficar em branco.
          // Vazia por causa do filtro é outra coisa, e diz outra coisa.
          <p className="px-1 py-3 text-center text-[11px] text-ink-400/70">
            {coluna.cards.length === 0
              ? "Sem cards. Escreva abaixo para criar."
              : "Nenhum card com as tags do filtro."}
          </p>
        )}
      </div>

      <form onSubmit={novoCard} className="shrink-0 px-2 pb-2">
        <input
          ref={campoNovoRef}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="+ novo card"
          aria-label={`Novo card em ${coluna.name}`}
          className="w-full rounded bg-transparent px-2 py-1.5 text-sm text-ink-200 outline-none
                     placeholder:text-ink-400/60 hover:bg-ink-800 focus:bg-ink-800"
        />
      </form>
    </section>
  );
}
