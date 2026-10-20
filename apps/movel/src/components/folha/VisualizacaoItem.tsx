import type { EventItem, TaskItem } from "@yu-book/shared";
import { descreverDias } from "@yu-book/shared";
import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { useConcluirTarefa } from "@yu-book/cliente/concluirTarefa";
import {
  IconeAssistente,
  IconeBoard,
  IconeCalendario,
  IconeCheck,
  IconeFechar,
  IconeLapis,
  IconeLink,
  IconeRepetir,
  IconeRitmo,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import { useState } from "react";
import type { ReactNode, RefObject } from "react";
import { diaLongo, diaRelativo } from "../../lib/datas";
import { useHoje } from "../../lib/hoje";
import { Alca } from "../Alca";
import { LocalDoEvento } from "./LocalDoEvento";

/** O item aberto para ver: o toque num evento ou numa tarefa mostra, não edita. */
export type AberturaVer = { modo: "ver"; evento: EventItem } | { modo: "ver"; tarefa: TaskItem };

/**
 * A visualização de evento e tarefa: o que se quer saber ao tocar num item —
 * quando, onde, o projeto, o hábito, a descrição — sem o formulário, que o
 * "Editar" abre na mesma folha. Na tarefa aberta, "Concluir" está à mão: é o
 * gesto mais comum depois de olhar. No evento com lugar, o mapa e o "Como
 * chegar".
 */
export function VisualizacaoItem({
  abertura,
  onEditar,
  onFechar,
  focoCabecalho,
}: {
  abertura: AberturaVer;
  onEditar: () => void;
  onFechar: () => void;
  focoCabecalho: RefObject<HTMLHeadingElement | null>;
}) {
  const { hoje } = useHoje();
  const concluir = useConcluirTarefa();
  const [erro, setErro] = useState<string | null>(null);
  const evento = "evento" in abertura ? abertura.evento : null;
  const tarefa = "tarefa" in abertura ? abertura.tarefa : null;
  const titulo = evento?.title ?? tarefa?.title ?? "";
  const descricao = evento?.description ?? tarefa?.descriptionMd ?? "";
  const board = evento?.board ?? tarefa?.board ?? null;
  const atividade = evento?.habitActivity ?? tarefa?.habitActivity ?? null;
  const regra = evento?.recurrence ?? tarefa?.series ?? null;
  const url = evento?.url ?? null;
  const ia = evento?.ai ?? tarefa?.ai ?? null;

  function alternarConclusao() {
    if (!tarefa) return;
    setErro(null);
    concluir.mutate(
      { id: tarefa.id, concluir: !tarefa.completedAt },
      {
        onSuccess: onFechar,
        onError: (e) => setErro(e instanceof ApiError ? e.message : "Não deu para concluir."),
      },
    );
  }

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="px-5 pt-3">
        <Alca />
      </div>
      <header className="flex items-start gap-3 px-5 pb-2 pt-2">
        <span
          aria-hidden="true"
          className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-cartao ${
            evento ? "bg-accent-500/15 text-accent-400" : "bg-sucesso-500/15 text-sucesso-300"
          }`}
        >
          {evento ? <IconeCalendario className="size-5" /> : <IconeTarefa className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="rotulo">{evento ? "Evento" : "Tarefa"}</p>
          <h2
            ref={focoCabecalho}
            tabIndex={-1}
            className={`break-words text-xl font-bold tracking-tight outline-none ${
              tarefa?.completedAt ? "text-ink-400 line-through" : "text-titulo"
            }`}
          >
            {titulo}
          </h2>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-400
                     hover:bg-ink-800"
        >
          <IconeFechar className="size-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
        <Linha icone={<IconeCalendario className="size-4" />}>
          {evento ? (
            <QuandoDoEvento evento={evento} />
          ) : tarefa?.date ? (
            <>
              <span className="block font-medium text-ink-200">
                {diaLongo(tarefa.date)}
                {tarefa.time ? ` · ${tarefa.time}` : ""}
              </span>
              <span className={`text-xs ${tarefa.overdue ? "text-amber-300" : "text-ink-400"}`}>
                {tarefa.overdue ? "Atrasada · " : ""}
                {diaRelativo(tarefa.date, hoje)}
              </span>
            </>
          ) : (
            <span className="text-ink-400">Sem dia</span>
          )}
        </Linha>

        {regra && (
          <Linha icone={<IconeRepetir className="size-4" />}>
            <span className="text-ink-200">
              Repete {descreverDias(regra.days)}
              {regra.until ? `, até ${diaLongo(regra.until)}` : ""}
            </span>
          </Linha>
        )}

        {evento?.location && (
          <LocalDoEvento local={evento.location} place={evento.place ?? null} />
        )}

        {url && (
          <Linha icone={<IconeLink className="size-4" />}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent-400 underline underline-offset-2"
            >
              {url}
            </a>
          </Linha>
        )}

        {board && (
          <Linha icone={<IconeBoard className="size-4" />}>
            <span className="text-ink-200">Projeto {board.name}</span>
          </Linha>
        )}

        {atividade && (
          <Linha icone={<IconeRitmo className="size-4" />}>
            <span className="text-ink-200">
              {atividade.name} · {atividade.habitName}
              <span className="ml-1.5 text-xs font-bold text-ouro-300">+{atividade.points}</span>
            </span>
          </Linha>
        )}

        {descricao.trim() && (
          <p className="whitespace-pre-wrap break-words rounded-cartao bg-ink-900 px-3.5 py-3 text-sm text-ink-200">
            {descricao}
          </p>
        )}

        {ia && (
          <p className="flex items-center gap-1.5 text-xs text-ink-400">
            <IconeAssistente className="size-3.5 text-ia-500" />
            Criado pelo assistente
          </p>
        )}

        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>

      <div
        className="flex gap-2 border-t border-ink-800/70 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]
                   pt-3"
      >
        <Botao
          tamanho="g"
          variante={tarefa ? "secundario" : "primario"}
          icone={<IconeLapis className="size-4" />}
          onClick={onEditar}
          className="flex-1"
        >
          Editar
        </Botao>
        {tarefa && (
          <Botao
            tamanho="g"
            variante="primario"
            icone={<IconeCheck className="size-4" />}
            onClick={alternarConclusao}
            disabled={concluir.isPending}
            className="flex-1"
          >
            {tarefa.completedAt ? "Reabrir" : "Concluir"}
          </Botao>
        )}
      </div>
    </div>
  );
}

function Linha({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-400">
        {icone}
      </span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

function QuandoDoEvento({ evento }: { evento: EventItem }) {
  const varios = evento.endDate !== evento.date;
  const horas = evento.allDay
    ? "Dia inteiro"
    : `${evento.startTime ?? ""}${evento.endTime ? ` – ${evento.endTime}` : ""}`;
  return (
    <>
      <span className="block font-medium text-ink-200">
        {diaLongo(evento.date)}
        {varios ? ` até ${diaLongo(evento.endDate)}` : ""}
      </span>
      <span className="text-xs text-ink-400">{horas}</span>
    </>
  );
}
