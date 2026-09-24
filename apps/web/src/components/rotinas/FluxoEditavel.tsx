import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { Announcements, DragEndEvent, DragStartEvent, DropAnimation } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MAX_PASSOS_DA_ROTINA } from "@yu-book/shared";
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMovimentoReduzido } from "../../lib/movimento";
import { AvatarAgente } from "../agentes/AvatarAgente";
import { BotaoIcone } from "../base/Botao";
import { Menu } from "../base/Menu";
import {
  IconeAlca,
  IconeAlerta,
  IconeBoard,
  IconeChevron,
  IconeCheck,
  IconeLixeira,
  IconeMais,
  IconeOpcoes,
} from "../Icones";
import { GLIFO_MODO, ROTULO_MODO } from "./comum";
import type { BlocoEscolhido, PassoRascunho } from "./rascunho";

/**
 * O fluxo do editor de rotinas (Etapa E da IA): `Entrada → passos → Saída` em
 * linha, ligados por conectores com um "+" no meio para inserir um passo ali.
 * No espírito do organizador de integrações — blocos, não formulário.
 *
 * **Arraste.** Só os passos se movem, e **a alça é o único ativador**
 * (INV-57): o bloco tem o botão que o escolhe e o menu dentro, e com os
 * `listeners` no bloco inteiro o Espaço no menu viraria "pegar". O teclado é o
 * do contrato do projeto — Espaço pega e solta, setas andam de posição em
 * posição, Esc cancela — e cada etapa é anunciada com "posição N de M". A
 * origem some com `opacity-0` (INV-30), e o mesmo gesto existe sem arrastar,
 * no menu do bloco.
 *
 * Aqui a colisão é `closestCenter`, e não a cadeia `pointerWithin` →
 * `rectIntersection` do kanban e do quadro de modelos: aqueles têm colunas
 * como alvo, este é uma lista ordenável só, e `sortableKeyboardCoordinates`
 * anda de vizinho em vizinho pelo centro.
 */

export interface InfoDoBloco {
  /** Linha principal: "Ideias · LinkedIn". */
  titulo: string;
  /** Linhas menores abaixo. */
  detalhe: ReactNode;
}

const ASSENTAMENTO: DropAnimation = { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" };

/** Id do botão que escolhe um bloco — alvo de foco depois de inserir, mover, remover. */
export const idDoBloco = (b: BlocoEscolhido) =>
  b.tipo === "passo" ? `yb-bloco-${b.chave}` : `yb-bloco-${b.tipo}`;
const idDoMenu = (chave: string) => `yb-bloco-menu-${chave}`;
const idDoMais = (indice: number) => `yb-fluxo-mais-${indice}`;

export function focarDepois(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/** A casca comum dos três tipos de bloco. */
function CascaBloco({
  selecionado,
  problemas,
  rotulo,
  topo,
  onEscolher,
  idBotao,
  nomeAcessivel,
  children,
  className = "",
  variante = "passo",
}: {
  selecionado: boolean;
  problemas: string[];
  rotulo: ReactNode;
  topo?: ReactNode;
  onEscolher?: () => void;
  idBotao?: string;
  nomeAcessivel: string;
  children: ReactNode;
  className?: string;
  variante?: "passo" | "ponta";
}) {
  const idProblema = idBotao ? `${idBotao}-problema` : undefined;
  return (
    <div
      className={`relative flex w-52 shrink-0 flex-col rounded-cartao border bg-superficie
                  transition duration-[160ms] ease-(--ease-padrao) ${
                    selecionado
                      ? "border-accent-400 shadow-e2 ring-2 ring-accent-400/60"
                      : problemas.length > 0
                        ? "border-dashed border-amber-500/60 shadow-e1 hover:shadow-e2"
                        : "border-ink-800 shadow-e1 hover:border-ink-700 hover:shadow-e2"
                  } ${className}`}
    >
      {variante === "ponta" && (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <div className="flex h-9 items-center gap-1.5 px-2.5">
        <span className="rotulo flex min-w-0 items-center gap-1.5">{rotulo}</span>
        <span className="ml-auto flex items-center gap-0.5">{topo}</span>
      </div>
      <button
        type="button"
        id={idBotao}
        onClick={onEscolher}
        aria-pressed={selecionado}
        aria-label={nomeAcessivel}
        aria-describedby={problemas.length > 0 ? idProblema : undefined}
        className="flex min-h-0 flex-1 flex-col items-start gap-1.5 rounded-b-cartao px-3 pb-3
                   text-left"
      >
        {children}
      </button>
      {problemas.length > 0 && (
        // RNF-09: o problema tem glifo e texto, além da borda tracejada.
        <p
          id={idProblema}
          className="flex items-start gap-1 border-t border-amber-500/25 px-3 py-1.5 text-miudo
                     text-amber-300"
        >
          <IconeAlerta className="mt-px size-3" />
          <span className="line-clamp-2">
            {problemas.length === 1 ? problemas[0] : `${problemas.length} problemas`}
          </span>
        </p>
      )}
    </div>
  );
}

function ConteudoPasso({ passo }: { passo: PassoRascunho }) {
  const nome =
    passo.agentName || (passo.sugestao ? `Sugerido: ${passo.sugestao.nome}` : "Escolha um agente");
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <AvatarAgente
          nome={passo.agentName || passo.sugestao?.nome || "?"}
          cor={passo.agentColor ?? "cinza"}
          tamanho="g"
          excluido={!passo.agentId}
        />
        <span className="min-w-0">
          <span
            className={`block truncate text-sm font-medium ${
              passo.agentName ? "text-titulo" : "text-ink-400"
            }`}
          >
            {nome}
          </span>
          <span
            className={`mt-0.5 inline-flex items-center gap-1 rounded-etiqueta border px-1.5
                        text-miudo ${
                          passo.mode === "reescreve"
                            ? `border-ia-500/40 bg-linear-to-r from-accent-500/10 to-ia-500/10
                               text-accent-400`
                            : "border-ink-700 text-ink-400"
                        }`}
          >
            <span aria-hidden="true">{GLIFO_MODO[passo.mode]}</span>
            {ROTULO_MODO[passo.mode].curto}
          </span>
        </span>
      </span>
      <span className="line-clamp-2 text-xs text-ink-400">
        {passo.instruction.trim() || "Sem instrução própria — só as premissas do agente."}
      </span>
    </>
  );
}

function BlocoPasso({
  passo,
  indice,
  total,
  selecionado,
  problemas,
  onEscolher,
  onMover,
  onRemover,
}: {
  passo: PassoRascunho;
  indice: number;
  total: number;
  selecionado: boolean;
  problemas: string[];
  onEscolher: () => void;
  onMover: (para: number) => void;
  onRemover: () => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: passo.chave });
  const nome = passo.agentName || "sem agente";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // INV-30: some com opacidade, nunca com `visibility` — o foco do teclado
      // mora na alça, e ela precisa continuar na árvore durante o gesto.
      className={isDragging ? "opacity-0" : ""}
    >
      <CascaBloco
        selecionado={selecionado}
        problemas={problemas}
        idBotao={idDoBloco({ tipo: "passo", chave: passo.chave })}
        nomeAcessivel={`Passo ${indice + 1} de ${total}: ${nome}, ${
          ROTULO_MODO[passo.mode].curto
        }. Configurar`}
        onEscolher={onEscolher}
        rotulo={
          <>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Arrastar o passo ${indice + 1} (${nome})`}
              aria-roledescription="passo arrastável"
              title="Arrastar para reordenar (Espaço pega, setas movem)"
              className="-ml-1 cursor-grab rounded-etiqueta p-0.5 text-ink-400 transition-colors
                         hover:bg-ink-800 hover:text-ink-200"
            >
              <IconeAlca className="size-3.5" />
            </button>
            Passo {indice + 1}
          </>
        }
        topo={
          <Menu
            rotulo={`Ações do passo ${indice + 1}`}
            lado="baixo-fim"
            gatilho={(p) => (
              <button
                {...p}
                id={idDoMenu(passo.chave)}
                type="button"
                aria-label={`Ações do passo ${indice + 1} (${nome})`}
                title="Ações do passo"
                className="inline-flex size-6 items-center justify-center rounded-controle
                           text-ink-400 transition hover:bg-ink-800 hover:text-ink-200"
              >
                <IconeOpcoes className="size-3.5" />
              </button>
            )}
            itens={[
              {
                rotulo: "Mover para a esquerda",
                icone: <IconeChevron direcao="esquerda" className="size-3.5" />,
                aoEscolher: () => onMover(indice - 1),
                desabilitado: indice === 0,
                motivo: "Já é o primeiro passo",
              },
              {
                rotulo: "Mover para a direita",
                icone: <IconeChevron direcao="direita" className="size-3.5" />,
                aoEscolher: () => onMover(indice + 1),
                desabilitado: indice === total - 1,
                motivo: "Já é o último passo",
              },
              {
                rotulo: "Remover",
                icone: <IconeLixeira className="size-3.5" />,
                aoEscolher: onRemover,
                desabilitado: total === 1,
                motivo: "A rotina precisa de pelo menos um passo",
              },
            ]}
          />
        }
      >
        <ConteudoPasso passo={passo} />
      </CascaBloco>
    </div>
  );
}

/**
 * O conector entre dois blocos: o traço com a ponta, e o "+" no meio. O
 * gradiente do traço é o da IA — o fluxo inteiro é trabalho de agente.
 */
function Conector({
  indice,
  cheio,
  onInserir,
}: {
  indice: number;
  cheio: boolean;
  onInserir: () => void;
}) {
  return (
    <div className="relative flex w-14 shrink-0 items-center justify-center self-center">
      <svg
        viewBox="0 0 56 12"
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
      >
        <line x1="2" y1="6" x2="50" y2="6" className="stroke-ink-700" />
        <path d="M46 2.5 51.5 6 46 9.5" className="stroke-ink-400" />
      </svg>
      <BotaoIcone
        id={idDoMais(indice)}
        variante="secundario"
        tamanho="p"
        rotulo={
          cheio
            ? `Limite de ${MAX_PASSOS_DA_ROTINA} passos`
            : `Inserir um passo na posição ${indice + 1}`
        }
        icone={<IconeMais className="size-3.5" />}
        disabled={cheio}
        onClick={onInserir}
        className="relative"
      />
    </div>
  );
}

export function FluxoEditavel({
  passos,
  escolhido,
  onEscolher,
  onInserir,
  onMover,
  onRemover,
  entrada,
  saida,
  problemasDe,
  anunciar,
}: {
  passos: PassoRascunho[];
  escolhido: BlocoEscolhido;
  onEscolher: (b: BlocoEscolhido) => void;
  onInserir: (indice: number) => void;
  onMover: (de: number, para: number) => void;
  onRemover: (chave: string) => void;
  entrada: InfoDoBloco;
  saida: InfoDoBloco;
  problemasDe: (b: BlocoEscolhido) => string[];
  anunciar: (texto: string) => void;
}) {
  const reduzido = useMovimentoReduzido();
  const [arrastado, setArrastado] = useState<string | null>(null);
  const total = passos.length;
  const cheio = total >= MAX_PASSOS_DA_ROTINA;
  const posicaoDe = (chave: string) => passos.findIndex((p) => p.chave === chave);
  const nomeDe = (chave: string) => passos[posicaoDe(chave)]?.agentName || "sem agente";

  const sensors = useSensors(
    // 4px de folga: um clique na alça não pode virar arraste.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  /** RF-23 do kanban, aqui também: o cursor diz "segurando" o gesto inteiro. */
  useEffect(() => {
    if (!arrastado) return;
    document.documentElement.setAttribute("data-arrastando", "");
    return () => document.documentElement.removeAttribute("data-arrastando");
  }, [arrastado]);

  /// Escolher um bloco fora da vista o traz para ela — a linha rola na
  /// horizontal, e o anel de escolhido não pode ficar escondido.
  useEffect(() => {
    document
      .getElementById(idDoBloco(escolhido))
      ?.closest("[data-bloco]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [escolhido]);

  const anuncios: Announcements = {
    onDragStart: ({ active }) => {
      const i = posicaoDe(String(active.id));
      return (
        `Passo ${i + 1}, ${nomeDe(String(active.id))}, pego. Posição ${i + 1} de ${total}. ` +
        "Setas movem, Espaço solta, Esc cancela."
      );
    },
    onDragOver: ({ over }) =>
      over ? `Posição ${posicaoDe(String(over.id)) + 1} de ${total}.` : "Fora do fluxo.",
    onDragEnd: ({ active, over }) => {
      const de = posicaoDe(String(active.id));
      const para = over ? posicaoDe(String(over.id)) : de;
      return para === de
        ? `Solto na mesma posição, ${de + 1} de ${total}. Nada mudou.`
        : `${nomeDe(String(active.id))} agora está na posição ${para + 1} de ${total}.`;
    },
    onDragCancel: ({ active }) =>
      `Cancelado. O passo voltou à posição ${posicaoDe(String(active.id)) + 1} de ${total}.`,
  };

  function aoIniciar({ active }: DragStartEvent) {
    setArrastado(String(active.id));
  }

  function aoTerminar({ active, over }: DragEndEvent) {
    setArrastado(null);
    if (!over) return;
    const de = posicaoDe(String(active.id));
    const para = posicaoDe(String(over.id));
    if (de === -1 || para === -1 || de === para) return;
    onMover(de, para);
  }

  /// Pelo menu: o item que tinha o foco some com o menu, então o foco vai para
  /// o gatilho do menu do bloco que se moveu, e a nova posição é dita.
  function moverPeloMenu(chave: string, de: number, para: number) {
    if (para < 0 || para >= total) return;
    onMover(de, para);
    anunciar(`${nomeDe(chave)} agora está na posição ${para + 1} de ${total}.`);
    focarDepois(idDoMenu(chave));
  }

  const passoArrastado = arrastado ? passos[posicaoDe(arrastado)] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements: anuncios }}
      onDragStart={aoIniciar}
      onDragEnd={aoTerminar}
      onDragCancel={() => setArrastado(null)}
    >
      <div className="flex w-max min-w-full items-stretch px-6 py-8">
        <div data-bloco className="flex">
          <CascaBloco
            variante="ponta"
            selecionado={escolhido.tipo === "entrada"}
            problemas={problemasDe({ tipo: "entrada" })}
            idBotao={idDoBloco({ tipo: "entrada" })}
            nomeAcessivel={`Entrada: ${entrada.titulo}. Configurar`}
            onEscolher={() => onEscolher({ tipo: "entrada" })}
            rotulo={
              <>
                <IconeBoard className="size-3.5 text-accent-400" />
                Entrada
              </>
            }
          >
            <span className="line-clamp-2 text-sm font-medium text-titulo">{entrada.titulo}</span>
            <span className="text-miudo text-ink-400">{entrada.detalhe}</span>
          </CascaBloco>
        </div>

        <SortableContext
          items={passos.map((p) => p.chave)}
          strategy={horizontalListSortingStrategy}
        >
          {passos.map((p, i) => (
            <Fragment key={p.chave}>
              <Conector indice={i} cheio={cheio} onInserir={() => onInserir(i)} />
              <div data-bloco className="flex animate-surgir">
                <BlocoPasso
                  passo={p}
                  indice={i}
                  total={total}
                  selecionado={escolhido.tipo === "passo" && escolhido.chave === p.chave}
                  problemas={problemasDe({ tipo: "passo", chave: p.chave })}
                  onEscolher={() => onEscolher({ tipo: "passo", chave: p.chave })}
                  onMover={(para) => moverPeloMenu(p.chave, i, para)}
                  onRemover={() => onRemover(p.chave)}
                />
              </div>
            </Fragment>
          ))}
        </SortableContext>

        <Conector indice={total} cheio={cheio} onInserir={() => onInserir(total)} />
        <div data-bloco className="flex">
          <CascaBloco
            variante="ponta"
            selecionado={escolhido.tipo === "saida"}
            problemas={problemasDe({ tipo: "saida" })}
            idBotao={idDoBloco({ tipo: "saida" })}
            nomeAcessivel={`Saída: ${saida.titulo}. Configurar`}
            onEscolher={() => onEscolher({ tipo: "saida" })}
            rotulo={
              <>
                <IconeCheck className="size-3.5 text-accent-400" />
                Saída
              </>
            }
          >
            <span className="line-clamp-2 text-sm font-medium text-titulo">{saida.titulo}</span>
            <span className="text-miudo text-ink-400">{saida.detalhe}</span>
          </CascaBloco>
        </div>
      </div>

      <DragOverlay dropAnimation={reduzido ? null : ASSENTAMENTO}>
        {passoArrastado ? (
          // A cópia que segue o ponteiro é só imagem: `inert` a tira do foco e da
          // árvore de acessibilidade — quem fala é o anúncio do arraste.
          <div inert className="rotate-1 scale-[1.02]">
            <CascaBloco
              selecionado={false}
              problemas={[]}
              nomeAcessivel=""
              className="shadow-e3"
              rotulo={
                <>
                  <IconeAlca className="size-3.5" />
                  Passo
                </>
              }
            >
              <ConteudoPasso passo={passoArrastado} />
            </CascaBloco>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
