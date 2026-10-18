import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { IconeCalendario, IconeMais } from "@yu-book/cliente/icones";
import type { EventItem, TaskItem } from "@yu-book/shared";
import { useId } from "react";
import { diaLongo, diaPorExtenso, diaRelativo } from "../../lib/datas";
import { TOM_DO_TIPO } from "./Calendario";
import { EstadoVazio, ItemAgenda } from "./ItemAgenda";
import type { ItemDoDia } from "./itens";
const DIAS_RELATIVOS = new Set(["hoje", "amanhã", "ontem"]);

/**
 * A lista do dia escolhido, embaixo do calendário (ao lado, no desktop). Cada
 * item diz o tipo por extenso — Evento, Tarefa, Prazo —, além do tom; a tarefa
 * tem a caixa de concluir com um toque; evento e tarefa abrem a folha de
 * edição; o prazo do card é só leitura, e mostra de que quadro ele é.
 */
export function ListaDoDia({
  dia,
  hoje,
  itens,
  carregando,
  erro,
  aviso,
  onTentar,
  onFecharAviso,
  onCriar,
  onAbrir,
  onConcluir,
  onCheckIn,
}: {
  dia: string | null;
  hoje: string | null;
  itens: ItemDoDia[];
  carregando: boolean;
  erro: boolean;
  /** Falha de uma ação da lista (concluir), que voltou atrás. */
  aviso: string | null;
  onTentar: () => void;
  onFecharAviso: () => void;
  onCriar: () => void;
  onAbrir: (item: ItemDoDia) => void;
  onConcluir: (tarefa: TaskItem) => void;
  /** O check-in do evento ligado a hábito (frente Ritmo, RF-29). */
  onCheckIn?: (evento: EventItem) => void;
}) {
  const idTitulo = useId();
  const relativo = dia ? diaRelativo(dia, hoje) : null;
  const especial = relativo !== null && DIAS_RELATIVOS.has(relativo);

  return (
    <section
      aria-labelledby={idTitulo}
      aria-busy={carregando || undefined}
      data-foco-retorno={idTitulo}
    >
      <div className="flex items-center gap-3">
        <h2 id={idTitulo} tabIndex={-1} className="mr-auto min-w-0">
          {dia ? (
            <>
              {especial && (
                <span className="block text-sm font-medium capitalize text-accent-400">
                  {relativo}
                </span>
              )}
              <span
                className="block truncate text-lg font-semibold tracking-tight text-titulo
                           first-letter:uppercase"
              >
                {diaLongo(dia)}
              </span>
            </>
          ) : (
            <span className="block h-7 w-48 animate-pulse rounded-etiqueta bg-ink-800" />
          )}
        </h2>
        <button
          type="button"
          onClick={onCriar}
          disabled={!dia}
          aria-label={dia ? `Criar em ${diaPorExtenso(dia)}` : "Criar"}
          title="Criar neste dia"
          aria-haspopup="dialog"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-500
                     text-white shadow-e1 transition duration-150 hover:brightness-110
                     active:scale-95 disabled:opacity-50"
        >
          <IconeMais className="size-5" />
        </button>
      </div>

      {aviso && (
        <Aviso tom="erro" onFechar={onFecharAviso} className="mt-3">
          {aviso}
        </Aviso>
      )}

      <div className="mt-4">
        {erro ? (
          <Aviso tom="erro">
            Não deu para carregar a agenda.{" "}
            <button type="button" onClick={onTentar} className="font-medium underline">
              Tentar de novo
            </button>
          </Aviso>
        ) : carregando || !dia ? (
          // Do tamanho de dois itens: a lista que chega não empurra a página.
          <ul aria-hidden="true" className="space-y-2">
            {[0, 1].map((i) => (
              <li key={i} className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900" />
            ))}
          </ul>
        ) : itens.length === 0 ? (
          <EstadoVazio
            Icone={IconeCalendario}
            tom={TOM_DO_TIPO.evento}
            titulo="Dia livre"
            texto={`Nada marcado ${
              relativo && DIAS_RELATIVOS.has(relativo) ? relativo : `em ${relativo ?? ""}`
            }. Um evento, uma tarefa — o que vier.`}
            acao={
              <Botao
                variante="secundario"
                tamanho="g"
                onClick={onCriar}
                icone={<IconeMais className="size-4" />}
              >
                Criar neste dia
              </Botao>
            }
          />
        ) : (
          <ul className="space-y-2">
            {itens.map((item) => (
              <ItemAgenda
                key={item.id}
                item={item}
                onAbrir={onAbrir}
                onConcluir={onConcluir}
                onCheckIn={onCheckIn}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
