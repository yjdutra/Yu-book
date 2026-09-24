import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimation,
  KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { AI_TASKS } from "@yu-book/shared";
import type { AiFavorite, AiTask } from "@yu-book/shared";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ApiError } from "../../lib/api";
import { useAiAjustes, useDefinirModeloDaTarefa, useDesfavoritar } from "../../lib/ia";
import { useMovimentoReduzido } from "../../lib/movimento";
import { Esqueleto, Vazio } from "../base/Bloco";
import { BotaoIcone } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { Menu } from "../base/Menu";
import { IconeAlca, IconeAlerta, IconeFechar, IconeOpcoes } from "../Icones";
import { CartaoModelo } from "./CartaoModelo";
import {
  EXIGE_FERRAMENTA,
  MOTIVO_SEM_FERRAMENTA,
  ROTULO_DA_TAREFA,
  podeServir,
} from "./comum";

/**
 * O quadro de modelos (redesenho de UI, Etapa 4): os favoritos numa coluna,
 * uma coluna por tarefa, e escolher o modelo de uma tarefa é arrastá-lo até
 * ela. É o segundo arraste do projeto, e copia o padrão do kanban
 * (`Quadro.tsx`) sem tocar nele.
 *
 * **O que vai para a tarefa é uma cópia.** Um favorito pode servir a mais de
 * uma tarefa, então a coluna de favoritos nunca perde itens; cada tarefa tem
 * um lugar só (`taskModels` guarda um id por tarefa), e soltar ali troca o que
 * estava.
 *
 * **As colunas saem de `AI_TASKS`** (INV-54): a tarefa nova aparece aqui
 * sozinha, e o `Record` de `ROTULO_DA_TAREFA` cobra o rótulo dela.
 */

type Origem =
  | { tipo: "favorito"; modelId: string }
  | { tipo: "tarefa"; modelId: string; tarefa: AiTask };

const ID_FAVORITOS = "favoritos";
const idTarefa = (t: AiTask) => `tarefa:${t}`;
const idDomDaColuna = (id: string) => `coluna-${id.replace(":", "-")}`;

/**
 * Tirar, remover ou mover desmonta o cartão que tinha o foco, e ele cairia no
 * `<body>` (RNF-06 da Fase 1). Vai para a coluna onde a mudança aconteceu.
 */
function focarColuna(id: string) {
  requestAnimationFrame(() => document.getElementById(idDomDaColuna(id))?.focus());
}

const ASSENTAMENTO: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * `pointerWithin` e, se vazio, `rectIntersection` — a mesma cadeia do kanban.
 * Sem ponteiro (teclado) o primeiro sempre volta vazio; o segundo é o que
 * acha a coluna.
 */
const detectarColisao: CollisionDetection = (args) => {
  const porPonteiro = pointerWithin(args);
  return porPonteiro.length > 0 ? porPonteiro : rectIntersection(args);
};

/**
 * Setas pulam de coluna em coluna. O padrão do dnd-kit anda 25px por tecla, e
 * atravessar o quadro levaria dezenas de toques; aqui cada seta é um destino.
 */
const coordenadasPorColuna: KeyboardCoordinateGetter = (evento, { context }) => {
  const { active, collisionRect, droppableRects, droppableContainers } = context;
  if (!active || !collisionRect) return undefined;

  const avancar = evento.code === "ArrowRight" || evento.code === "ArrowDown";
  const voltar = evento.code === "ArrowLeft" || evento.code === "ArrowUp";
  if (!avancar && !voltar) return undefined;
  evento.preventDefault();

  const colunas = droppableContainers
    .getEnabled()
    .flatMap((c) => {
      const rect = droppableRects.get(c.id);
      return rect ? [rect] : [];
    })
    .sort((a, b) => a.left - b.left);

  const centro = collisionRect.left + collisionRect.width / 2;
  const atual = colunas.findIndex((r) => centro >= r.left && centro <= r.left + r.width);
  const indice =
    atual === -1
      ? avancar
        ? 0
        : colunas.length - 1
      : Math.min(Math.max(atual + (avancar ? 1 : -1), 0), colunas.length - 1);
  const alvo = colunas[indice];
  if (!alvo) return undefined;

  return {
    x: alvo.left + alvo.width / 2 - collisionRect.width / 2,
    y: alvo.top + Math.min(alvo.height, 160) / 2 - collisionRect.height / 2,
  };
};

/** A alça: único ponto que pega o cartão, por mouse ou por Espaço. */
function Arrastavel({
  id,
  origem,
  nome,
  children,
}: {
  id: string;
  origem: Origem;
  nome: string;
  children: (alca: ReactNode, arrastando: boolean) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id,
    data: origem,
  });

  const alca = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Arrastar ${nome}`}
      title="Arrastar para uma tarefa"
      className="-ml-1 mt-0.5 cursor-grab rounded-etiqueta p-0.5 text-ink-400 transition-colors
                 hover:bg-ink-800 hover:text-ink-200"
    >
      <IconeAlca />
    </button>
  );

  return <div ref={setNodeRef}>{children(alca, isDragging)}</div>;
}

function Coluna({
  id,
  titulo,
  descricao,
  etiqueta,
  recusando,
  aceitando,
  children,
}: {
  id: string;
  titulo: string;
  descricao?: string;
  etiqueta?: ReactNode;
  recusando: boolean;
  aceitando: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      id={idDomDaColuna(id)}
      tabIndex={-1}
      aria-label={titulo}
      className={`flex min-w-0 flex-col rounded-cartao border p-3 transition-colors ${
        recusando
          ? "border-dashed border-red-500 bg-red-500/5"
          : aceitando
            ? "border-accent-400 bg-accent-500/5"
            : "border-ink-800 bg-ink-900/60"
      }`}
    >
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <h4 className="rotulo">{titulo}</h4>
          {etiqueta}
        </div>
        {descricao && <p className="mt-0.5 text-miudo text-ink-400">{descricao}</p>}
      </header>
      {/* RNF-09: a recusa tem forma (tracejado), ícone e texto — não só a cor.
          Sem `role="status"`: o anúncio do arraste já diz isso, e dizer duas
          vezes atrapalha. */}
      {recusando && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-red-300">
          <IconeAlerta className="size-3.5" />
          {MOTIVO_SEM_FERRAMENTA}
        </p>
      )}
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </section>
  );
}

export function QuadroDeModelos({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const ajustes = useAiAjustes();
  const definir = useDefinirModeloDaTarefa();
  const desfavoritar = useDesfavoritar();
  const reduzido = useMovimentoReduzido();

  const [arrastando, setArrastando] = useState<Origem | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const favoritos = ajustes.data?.favorites ?? [];
  const escolhidos = ajustes.data?.taskModels ?? {};
  const modeloDe = (id: string): AiFavorite | undefined => favoritos.find((f) => f.id === id);
  const nomeDe = (id: string) => modeloDe(id)?.name ?? id;

  const sensors = useSensors(
    // 4px de folga: um clique na alça não pode virar arraste.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: coordenadasPorColuna,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  /** RF-23 do kanban, aqui também: o cursor diz "segurando" o gesto inteiro. */
  useEffect(() => {
    if (!arrastando) return;
    document.documentElement.setAttribute("data-arrastando", "");
    return () => document.documentElement.removeAttribute("data-arrastando");
  }, [arrastando]);

  const tarefaDe = (overId: string | null): AiTask | null => {
    if (!overId?.startsWith("tarefa:")) return null;
    const t = overId.slice("tarefa:".length);
    return (AI_TASKS as readonly string[]).includes(t) ? (t as AiTask) : null;
  };

  async function atribuir(tarefa: AiTask, modelId: string, deTarefa?: AiTask) {
    onErro(null);
    try {
      await definir.mutateAsync({ task: tarefa, modelId });
      // Mover de uma tarefa para outra é pôr no destino e tirar da origem.
      if (deTarefa && deTarefa !== tarefa) {
        await definir.mutateAsync({ task: deTarefa, modelId: null });
        focarColuna(idTarefa(tarefa));
      }
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível escolher o modelo.");
    }
  }

  async function tirar(tarefa: AiTask) {
    onErro(null);
    try {
      await definir.mutateAsync({ task: tarefa, modelId: null });
      focarColuna(idTarefa(tarefa));
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível tirar o modelo da tarefa.");
    }
  }

  async function remover(favorito: AiFavorite) {
    onErro(null);
    try {
      // O servidor limpa a tarefa que apontava para ele junto.
      await desfavoritar.mutateAsync(favorito.favoriteId);
      focarColuna(ID_FAVORITOS);
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível remover o favorito.");
    }
  }

  function aoIniciar({ active }: DragStartEvent) {
    setArrastando(active.data.current as Origem);
  }

  function aoPassar({ over }: DragOverEvent) {
    setSobre(over ? String(over.id) : null);
  }

  function aoTerminar({ active, over }: DragEndEvent) {
    const origem = active.data.current as Origem;
    setArrastando(null);
    setSobre(null);
    if (!over) return;

    const destino = String(over.id);
    if (destino === ID_FAVORITOS) {
      if (origem.tipo === "tarefa") void tirar(origem.tarefa);
      return;
    }

    const tarefa = tarefaDe(destino);
    const modelo = modeloDe(origem.modelId);
    if (!tarefa || !modelo) return;
    // Já é o modelo dela — nem pedido redundante ao servidor.
    if (escolhidos[tarefa] === modelo.id) return;
    // Recusa: soltar não faz nada — o motivo já estava na coluna e é anunciado.
    if (!podeServir(modelo, tarefa)) return;

    void atribuir(tarefa, modelo.id, origem.tipo === "tarefa" ? origem.tarefa : undefined);
  }

  /** CA-15 do kanban, aqui também: cada etapa do arraste é dita em voz alta. */
  const anuncios: Announcements = {
    onDragStart: ({ active }) =>
      `${nomeDe((active.data.current as Origem).modelId)} pego. ` +
      "Setas escolhem a tarefa, Espaço solta, Esc cancela.",
    onDragOver: ({ active, over }) => {
      if (!over) return "Fora das colunas.";
      if (String(over.id) === ID_FAVORITOS) return "Sobre os favoritos: solta para tirar da tarefa.";
      const tarefa = tarefaDe(String(over.id));
      const modelo = modeloDe((active.data.current as Origem).modelId);
      if (!tarefa || !modelo) return undefined;
      const nome = ROTULO_DA_TAREFA[tarefa].titulo;
      return podeServir(modelo, tarefa)
        ? `Sobre ${nome}: aceita.`
        : `Sobre ${nome}: recusa, ${MOTIVO_SEM_FERRAMENTA.toLowerCase()}.`;
    },
    onDragEnd: ({ active, over }) => {
      const origem = active.data.current as Origem;
      if (!over) return "Solto fora das colunas. Nada mudou.";
      if (String(over.id) === ID_FAVORITOS) {
        return origem.tipo === "tarefa"
          ? `${nomeDe(origem.modelId)} saiu de ${ROTULO_DA_TAREFA[origem.tarefa].titulo}.`
          : "Nada mudou.";
      }
      const tarefa = tarefaDe(String(over.id));
      const modelo = modeloDe(origem.modelId);
      if (!tarefa || !modelo) return undefined;
      if (escolhidos[tarefa] === modelo.id) {
        return `${modelo.name} já é o modelo de ${ROTULO_DA_TAREFA[tarefa].titulo}. Nada mudou.`;
      }
      return podeServir(modelo, tarefa)
        ? `${modelo.name} agora é o modelo de ${ROTULO_DA_TAREFA[tarefa].titulo}.`
        : `Recusado: ${MOTIVO_SEM_FERRAMENTA.toLowerCase()}. Nada mudou.`;
    },
    onDragCancel: () => "Cancelado. Nada mudou.",
  };

  if (ajustes.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 rounded-cartao border border-ink-800 bg-ink-900/60">
            <Esqueleto linhas={3} alturaLinha={28} />
          </div>
        ))}
      </div>
    );
  }

  const modeloArrastado = arrastando ? modeloDe(arrastando.modelId) : undefined;
  const tarefaSobre = tarefaDe(sobre);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectarColisao}
      accessibility={{ announcements: anuncios }}
      onDragStart={aoIniciar}
      onDragOver={aoPassar}
      onDragEnd={aoTerminar}
      onDragCancel={() => {
        setArrastando(null);
        setSobre(null);
      }}
    >
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `minmax(0, 1.4fr) repeat(${AI_TASKS.length}, minmax(0, 1fr))`,
        }}
      >
        <Coluna
          id={ID_FAVORITOS}
          titulo="Seus favoritos"
          descricao="Arraste um modelo até a tarefa que ele vai fazer."
          recusando={false}
          aceitando={sobre === ID_FAVORITOS && arrastando?.tipo === "tarefa"}
        >
          {favoritos.length === 0 && (
            <Vazio texto="Nenhum favorito ainda. Favorite modelos no catálogo acima." />
          )}
          {favoritos.map((f) => {
            const serve = AI_TASKS.filter((t) => escolhidos[t] === f.id);
            return (
              <Arrastavel
                key={f.favoriteId}
                id={`fav:${f.favoriteId}`}
                origem={{ tipo: "favorito", modelId: f.id }}
                nome={f.name}
              >
                {(alca, emArraste) => (
                  <CartaoModelo
                    modelo={f}
                    alca={alca}
                    // Cópia: a origem continua à vista, esmaecida.
                    className={emArraste ? "opacity-50" : ""}
                    acoes={
                      <Menu
                        rotulo={`Ações de ${f.name}`}
                        lado="baixo-fim"
                        gatilho={(p) => (
                          <button
                            {...p}
                            type="button"
                            aria-label={`Ações de ${f.name}`}
                            title="Usar para…"
                            className="-mr-1 rounded-etiqueta p-1 text-ink-400 transition-colors
                                       hover:bg-ink-800 hover:text-ink-200"
                          >
                            <IconeOpcoes />
                          </button>
                        )}
                        itens={[
                          // A mesma escolha do arraste, sem arrastar.
                          ...AI_TASKS.map((t) => ({
                            rotulo: `Usar para ${ROTULO_DA_TAREFA[t].titulo}`,
                            desabilitado: !podeServir(f, t) || escolhidos[t] === f.id,
                            motivo: !podeServir(f, t) ? MOTIVO_SEM_FERRAMENTA : "Já é o modelo dela",
                            aoEscolher: () => void atribuir(t, f.id),
                          })),
                          { rotulo: "Remover dos favoritos", aoEscolher: () => void remover(f) },
                        ]}
                      />
                    }
                    rodape={
                      serve.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {serve.map((t) => (
                            <Etiqueta key={t} tom="ia">
                              {ROTULO_DA_TAREFA[t].titulo}
                            </Etiqueta>
                          ))}
                        </div>
                      )
                    }
                  />
                )}
              </Arrastavel>
            );
          })}
        </Coluna>

        {AI_TASKS.map((tarefa) => {
          const modelId = escolhidos[tarefa];
          const modelo = modelId ? modeloDe(modelId) : undefined;
          const rotulo = ROTULO_DA_TAREFA[tarefa];
          return (
            <Coluna
              key={tarefa}
              id={idTarefa(tarefa)}
              titulo={rotulo.titulo}
              descricao={`Usado por ${rotulo.usa}.`}
              etiqueta={
                // A regra aparece antes do arraste, não só na recusa.
                EXIGE_FERRAMENTA.has(tarefa) && (
                  <Etiqueta tom="destaque">precisa de ferramentas</Etiqueta>
                )
              }
              recusando={
                tarefaSobre === tarefa && !!modeloArrastado && !podeServir(modeloArrastado, tarefa)
              }
              aceitando={
                tarefaSobre === tarefa && !!modeloArrastado && podeServir(modeloArrastado, tarefa)
              }
            >
              {modelo ? (
                <Arrastavel
                  id={`slot:${tarefa}`}
                  origem={{ tipo: "tarefa", modelId: modelo.id, tarefa }}
                  nome={modelo.name}
                >
                  {(alca, emArraste) => (
                    <CartaoModelo
                      modelo={modelo}
                      alca={alca}
                      destaque
                      // INV-30: some com opacidade, nunca com `visibility` —
                      // o foco do teclado precisa sobreviver ao gesto.
                      className={emArraste ? "opacity-0" : ""}
                      acoes={
                        <BotaoIcone
                          rotulo={`Tirar ${modelo.name} de ${rotulo.titulo}`}
                          icone={<IconeFechar />}
                          onClick={() => void tirar(tarefa)}
                          tamanho="p"
                          className="-mr-1"
                        />
                      }
                    />
                  )}
                </Arrastavel>
              ) : (
                <div
                  className="flex min-h-32 flex-1 items-center justify-center rounded-cartao border
                             border-dashed border-ink-700 px-3 text-center text-xs text-ink-400"
                >
                  {modelId
                    ? "O modelo escolhido saiu dos favoritos."
                    : "Solte um modelo aqui"}
                </div>
              )}
            </Coluna>
          );
        })}
      </div>

      <DragOverlay dropAnimation={reduzido ? null : ASSENTAMENTO}>
        {modeloArrastado ? (
          <CartaoModelo
            modelo={modeloArrastado}
            destaque={arrastando?.tipo === "tarefa"}
            className="rotate-1 scale-[1.02] shadow-e3"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
