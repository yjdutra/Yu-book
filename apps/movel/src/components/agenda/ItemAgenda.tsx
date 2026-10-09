import {
  IconeBoard,
  IconeCalendario,
  IconeCheck,
  IconeChevron,
  IconeRelogio,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import type { TaskItem } from "@yu-book/shared";
import { useLayoutEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { TOM_DO_TIPO } from "./Calendario";
import { tituloDe } from "./itens";
import type { ItemDoDia } from "./itens";

const NOME_DO_TIPO = { evento: "Evento", tarefa: "Tarefa", prazo: "Prazo" } as const;

/**
 * O vazio de uma lista da agenda: um halo no tom da área, o que não há e o
 * que fazer. Nenhuma lista fica em branco (RF-06 da Fase 4 de produto).
 */
export function EstadoVazio({
  Icone,
  tom,
  titulo,
  texto,
  acao,
}: {
  Icone: (p: IconeProps) => ReactElement;
  /** Classe que declara `--tom` (um de `TOM_DO_TIPO`). */
  tom: string;
  titulo: string;
  texto: string;
  acao?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-dialogo border border-dashed border-ink-700
                 px-6 py-9 text-center"
    >
      <span
        aria-hidden="true"
        className={`cartao-pastel ${tom} flex size-16 items-center justify-center rounded-full`}
      >
        <span
          className="flex size-10 items-center justify-center rounded-full bg-(--tom) text-white
                     shadow-e1"
        >
          <Icone className="size-5" />
        </span>
      </span>
      <p className="mt-4 text-base font-semibold text-titulo">{titulo}</p>
      <p className="mt-1 max-w-xs text-sm text-ink-400">{texto}</p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}

/**
 * O item que some com o foco dentro — excluído pela folha, concluído na aba
 * de abertas, que o refetch tira — levaria o foco ao `<body>` (WCAG 2.4.3).
 * Na limpeza do layout, o `<li>` ainda está no documento: guarda-se a lista e
 * a posição, e depois do commit o foco vai ao item que ocupou o lugar (ou ao
 * último). Sem lista, ao título da seção mais próxima que sobreviveu: quem
 * hospeda itens marca a seção com `data-foco-retorno="<id do título>"`, e o
 * título tem `tabIndex={-1}`.
 */
function useFocoQueSobrevive() {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const li = ref.current;
    return () => {
      if (!li || !li.contains(document.activeElement)) return;
      const lista = li.parentElement;
      const posicao = lista ? [...lista.children].indexOf(li) : -1;
      const retornos: HTMLElement[] = [];
      for (let el = li.parentElement; el; el = el.parentElement) {
        if (el.dataset.focoRetorno) retornos.push(el);
      }
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        if (lista?.isConnected && lista.children.length > 0) {
          const vizinho = lista.children[Math.min(posicao, lista.children.length - 1)];
          const alvo = vizinho?.querySelector<HTMLElement>("button");
          if (alvo) return alvo.focus();
        }
        const secao = retornos.find((el) => el.isConnected);
        const titulo = secao?.dataset.focoRetorno
          ? document.getElementById(secao.dataset.focoRetorno)
          : null;
        (titulo ?? secao)?.focus();
      });
    };
  }, []);
  return ref;
}

/**
 * Um item da agenda, onde quer que ele apareça — o dia da Agenda, "O seu
 * dia" do Início, Tarefas, o projeto. Diz o tipo por extenso (Evento, Tarefa,
 * Prazo), além do tom; a tarefa tem a caixa de concluir com um toque; evento e
 * tarefa abrem a folha de edição; o prazo do card é só leitura, e mostra de
 * que quadro e coluna ele é.
 */
export function ItemAgenda({
  item,
  atrasada = false,
  rodape,
  onAbrir,
  onConcluir,
}: {
  item: ItemDoDia;
  /** A tarefa vencida, em destaque: glifo e palavra, não só a cor. */
  atrasada?: boolean;
  /** Uma linha a mais, sob o projeto (quando e por quem foi concluída). */
  rodape?: ReactNode;
  onAbrir: (item: ItemDoDia) => void;
  onConcluir: (tarefa: TaskItem) => void;
}) {
  const ref = useFocoQueSobrevive();
  const tom = TOM_DO_TIPO[item.tipo];
  const concluida = item.tipo === "tarefa" && item.tarefa.completedAt !== null;
  const titulo = tituloDe(item);
  const projeto =
    item.tipo === "evento"
      ? item.evento.board?.name
      : item.tipo === "tarefa"
        ? item.tarefa.board?.name
        : `${item.card.boardName} · ${item.card.columnName}`;

  const conteudo = (
    <>
      <span className="flex flex-wrap items-center gap-x-1.5 text-miudo text-ink-400">
        <span className="font-semibold uppercase tracking-wide">{NOME_DO_TIPO[item.tipo]}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{item.hora}</span>
        {atrasada && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-red-300">
              <span aria-hidden="true">! </span>atrasada
            </span>
          </>
        )}
        {/* Com rodapé (a aba de concluídas), é ele quem diz quando foi. */}
        {concluida && !rodape && (
          <>
            <span aria-hidden="true">·</span>
            <span>concluída</span>
          </>
        )}
      </span>
      <span
        className={`mt-0.5 block truncate text-base font-medium ${
          concluida ? "text-ink-400 line-through" : "text-titulo"
        }`}
      >
        {titulo}
      </span>
      {projeto && (
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-ink-400">
          <IconeBoard className="size-3 shrink-0" />
          <span className="truncate">{projeto}</span>
        </span>
      )}
      {rodape && <span className="mt-0.5 block text-xs text-ink-400">{rodape}</span>}
    </>
  );

  return (
    <li
      ref={ref}
      className={`${tom} flex items-center gap-3 rounded-cartao border bg-superficie py-2 pl-2 pr-3
                  shadow-e1 ${concluida ? "opacity-80" : ""} ${
                    atrasada ? "border-red-500/40" : "border-ink-800"
                  }`}
    >
      {item.tipo === "tarefa" ? (
        <CaixaConcluir tarefa={item.tarefa} onConcluir={onConcluir} />
      ) : (
        <Bolha Icone={item.tipo === "evento" ? IconeCalendario : IconeRelogio} />
      )}
      {item.tipo === "prazo" ? (
        // Só leitura: o card mora no quadro, e o móvel não tem quadro.
        <div className="min-w-0 flex-1 py-1">{conteudo}</div>
      ) : (
        <button
          type="button"
          onClick={() => onAbrir(item)}
          aria-haspopup="dialog"
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-controle py-1 text-left"
        >
          <span className="min-w-0 flex-1">{conteudo}</span>
          <IconeChevron direcao="direita" className="size-4 shrink-0 text-ink-400" />
        </button>
      )}
    </li>
  );
}

function Bolha({ Icone }: { Icone: (p: IconeProps) => ReactElement }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--tom) text-white"
    >
      <Icone className="size-5" />
    </span>
  );
}

/**
 * Concluir com um toque. A caixa marca na hora (o otimismo é do
 * `useConcluirTarefa`) e é uma `checkbox` de verdade para o leitor de tela. O
 * marcado muda de forma — cheio e com o check —, não só de cor.
 */
function CaixaConcluir({
  tarefa,
  onConcluir,
}: {
  tarefa: TaskItem;
  onConcluir: (tarefa: TaskItem) => void;
}): ReactNode {
  const feita = tarefa.completedAt !== null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={feita}
      aria-label={`Concluir “${tarefa.title}”`}
      onClick={() => onConcluir(tarefa)}
      className="flex size-11 shrink-0 items-center justify-center rounded-full"
    >
      <span
        aria-hidden="true"
        className={`flex size-7 items-center justify-center rounded-full border-2 border-(--tom)
                    transition duration-150 ease-(--ease-padrao) ${
                      feita ? "bg-(--tom) text-white" : "text-transparent"
                    }`}
      >
        <IconeCheck className="size-4" />
      </span>
    </button>
  );
}
