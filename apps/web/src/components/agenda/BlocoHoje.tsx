import { diaDaAgenda } from "@yu-book/cliente/agenda";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { useAlternarTarefa } from "@yu-book/cliente/concluirTarefa";
import { useFocoQueSobrevive } from "@yu-book/cliente/focoQueSobrevive";
import {
  compararNoDia,
  horaDoEvento,
  ordemDaTarefa,
  ordemDoEvento,
  useAgendaAdiante,
} from "@yu-book/cliente/hoje";
import {
  IconeBoard,
  IconeCalendario,
  IconeCheck,
  IconeHoje,
  IconeRepetir,
} from "@yu-book/cliente/icones";
import { contar } from "@yu-book/cliente/texto";
import { descreverDias, diasDoEvento, somarDias } from "@yu-book/shared";
import type { AgendaRange, EventItem, TaskItem } from "@yu-book/shared";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { EsqueletoHoje, MolduraHoje } from "./MolduraHoje";

/**
 * O bloco "Hoje" do Início (frente de agenda, Fase 6): atrasadas, os eventos e
 * as tarefas do dia, e um resumo de amanhã quando hoje está vazio. O desktop
 * **só lê** — não há tela de agenda no web; cria-se e edita-se pelo celular ou
 * pedindo ao assistente —, salvo concluir, que é um clique.
 *
 * Preguiçoso, fora do bundle inicial: `diasDoEvento` e `somarDias` são valor de
 * `shared` (`eventos.ts`, que monta schema no escopo do módulo, e `agenda.ts`),
 * e `@yu-book/cliente/hoje` os importa também (contrato §2.6).
 *
 * **O hoje é o da resposta** (`AgendaRange.today`, INV-66): a janela de hoje e
 * amanhã parte da data do aparelho e se corrige pela resposta
 * (`useAgendaAdiante`, a mesma do móvel). Prazo de card fica de fora: o bloco
 * Prazos, ao lado, já os mostra.
 */

/// Quantas atrasadas o bloco lista antes do "e mais N": é o Início, não a
/// lista de tarefas.
const MAX_ATRASADAS = 5;

interface EventoDoDia {
  evento: EventItem;
  hora: string;
  /// As chaves de `compararNoDia`.
  ordem: string;
  titulo: string;
}

/// Os eventos que aparecem em `dia` (`diasDoEvento`, nunca `date..endDate`:
/// contrato §4.8), com a hora daquele dia, na ordem do dia do móvel
/// (`compararNoDia`): o de dia inteiro primeiro.
function eventosDoDia(agenda: AgendaRange, dia: string): EventoDoDia[] {
  return agenda.events
    .filter((evento) => diasDoEvento(evento).includes(dia))
    .map((evento) => {
      const { texto, inicio } = horaDoEvento(evento, dia);
      return { evento, hora: texto, ordem: ordemDoEvento(inicio), titulo: evento.title };
    })
    .sort(compararNoDia);
}

/// As tarefas com data `dia`, as com hora primeiro — a mesma ordem do móvel.
function tarefasDoDia(agenda: AgendaRange, dia: string): TaskItem[] {
  const chave = (t: TaskItem) => ({ ordem: ordemDaTarefa(t), titulo: t.title });
  return agenda.tasks
    .filter((t) => t.date === dia)
    .sort((a, b) => compararNoDia(chave(a), chave(b)));
}

/**
 * "Amanhã: 2 eventos, 1 tarefa" — ou o item, quando é um só. Conta só as
 * tarefas abertas: a já concluída de amanhã não é o que se planeja.
 */
function resumoDeAmanha(eventos: EventoDoDia[], tarefas: TaskItem[]): string {
  const abertas = tarefas.filter((t) => t.completedAt === null);
  const total = eventos.length + abertas.length;
  if (total === 0) return "Amanhã também está livre.";
  if (total === 1) {
    const evento = eventos[0];
    if (evento) return `Amanhã: ${evento.evento.title}, ${evento.hora}.`;
    const tarefa = abertas[0];
    if (tarefa) return `Amanhã: ${tarefa.title}${tarefa.time ? `, ${tarefa.time}` : ""}.`;
  }
  const partes = [
    eventos.length > 0 ? contar(eventos.length, "evento", "eventos") : null,
    abertas.length > 0 ? contar(abertas.length, "tarefa", "tarefas") : null,
  ].filter(Boolean);
  return `Amanhã: ${partes.join(", ")}.`;
}

/**
 * A segunda linha de um item: a hora (ou o dia, na atrasada) e o projeto. Sob
 * o título, e não numa coluna ao lado: o bloco divide a largura com Prazos e,
 * com o painel do assistente aberto, encolhe — o título fica com a linha
 * inteira, como nas linhas de Prazos e de "Onde você parou".
 */
function Detalhe({
  quando,
  projeto,
  repete = null,
  atrasada = false,
}: {
  quando: string;
  projeto: string | null;
  /** O evento que se repete: "repete seg, qua, sex", com o glifo ao lado. */
  repete?: string | null;
  atrasada?: boolean;
}) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-miudo text-ink-400">
      <span className={`shrink-0 tabular-nums ${atrasada ? "font-semibold text-red-300" : ""}`}>
        {atrasada && <span className="sr-only">Atrasada desde </span>}
        {quando}
      </span>
      {repete && (
        <>
          <span aria-hidden="true">·</span>
          <IconeRepetir className="size-3 shrink-0" />
          <span className="truncate">{repete}</span>
        </>
      )}
      {projeto && (
        <>
          <span aria-hidden="true">·</span>
          <IconeBoard className="size-3 shrink-0" />
          <span className="sr-only">Projeto:</span>
          <span className="truncate">{projeto}</span>
        </>
      )}
    </span>
  );
}

function LinhaEvento({ item }: { item: EventoDoDia }) {
  const { evento, hora } = item;
  return (
    <li className="flex items-start gap-3 rounded-controle px-3 py-2">
      <span className="flex size-5 shrink-0 items-center justify-center text-accent-400">
        <IconeCalendario className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink-200">{evento.title}</span>
        <Detalhe
          quando={hora}
          projeto={evento.board?.name ?? null}
          repete={evento.recurrence ? `repete ${descreverDias(evento.recurrence.days)}` : null}
        />
      </span>
    </li>
  );
}

/**
 * Concluir com um clique: uma `checkbox` de verdade para o leitor de tela, e o
 * marcado muda de forma — cheio e com o check —, não só de cor (RNF-09).
 */
function CaixaConcluir({
  tarefa,
  onConcluir,
}: {
  tarefa: TaskItem;
  onConcluir: (tarefa: TaskItem) => void;
}) {
  const feita = tarefa.completedAt !== null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={feita}
      aria-label={`Concluir “${tarefa.title}”`}
      onClick={() => onConcluir(tarefa)}
      className="group flex size-5 shrink-0 items-center justify-center rounded-full"
    >
      <span
        aria-hidden="true"
        className={`flex size-4 items-center justify-center rounded-full border-[1.5px]
                    transition duration-150 ease-(--ease-padrao) ${
                      feita
                        ? "border-accent-500 bg-accent-500 text-white"
                        : "border-ink-400 text-transparent group-hover:border-accent-400 " +
                          "group-hover:text-accent-400"
                    }`}
      >
        <IconeCheck className="size-3" />
      </span>
    </button>
  );
}

function LinhaTarefa({
  tarefa,
  quando,
  atrasada = false,
  onConcluir,
}: {
  tarefa: TaskItem;
  /** A hora, "sem hora" ou, na atrasada, o dia. */
  quando: string;
  atrasada?: boolean;
  onConcluir: (tarefa: TaskItem) => void;
}) {
  // A atrasada concluída sai da lista no refetch, com o foco na caixa dela.
  const ref = useFocoQueSobrevive();
  const feita = tarefa.completedAt !== null;
  return (
    <li ref={ref} className="flex items-start gap-3 rounded-controle px-3 py-2">
      <CaixaConcluir tarefa={tarefa} onConcluir={onConcluir} />
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${
            feita ? "text-ink-400 line-through" : "text-ink-200"
          }`}
        >
          {tarefa.title}
        </span>
        <Detalhe
          quando={quando}
          projeto={tarefa.board?.name ?? null}
          atrasada={atrasada && !feita}
        />
      </span>
    </li>
  );
}

/** Um grupo do bloco, com título e contagem; `atencao` é o das atrasadas: glifo e tom. */
function Grupo({
  id,
  titulo,
  contagem,
  atencao = false,
  children,
}: {
  id: string;
  titulo: string;
  contagem: number;
  atencao?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        atencao ? "rounded-controle bg-red-500/5 ring-1 ring-inset ring-red-500/25" : undefined
      }
    >
      <h4
        id={id}
        className={`px-3 pt-2 text-miudo font-semibold uppercase tracking-wide ${
          atencao ? "text-red-300" : "text-ink-400"
        }`}
      >
        {atencao && <span aria-hidden="true">! </span>}
        {titulo} <span className="tabular-nums">· {contagem}</span>
      </h4>
      <ul aria-labelledby={id}>{children}</ul>
    </div>
  );
}

function DiaLivre({ amanha }: { amanha: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-accent-500/15
                   text-accent-400"
      >
        <IconeHoje className="size-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-titulo">Dia livre</p>
      <p className="mt-1 max-w-xs text-xs text-ink-400">
        Nada marcado para hoje e nada atrasado. Aproveite — ou peça ao assistente para anotar o
        que vier.
      </p>
      <p className="mt-3 text-xs text-ink-200">{amanha}</p>
    </div>
  );
}

export function BlocoHoje() {
  const { consulta } = useAgendaAdiante(1);
  // O mesmo invólucro das listas do móvel: otimismo, rollback e o porquê.
  const { alternar, aviso, limparAviso } = useAlternarTarefa();
  const id = useId();
  const agenda = consulta.data;

  const dia = useMemo(() => {
    if (!agenda) return null;
    const hoje = agenda.today;
    const amanha = somarDias(hoje, 1);
    return {
      atrasadas: agenda.overdueTasks,
      eventos: eventosDoDia(agenda, hoje),
      tarefas: tarefasDoDia(agenda, hoje),
      amanha: resumoDeAmanha(eventosDoDia(agenda, amanha), tarefasDoDia(agenda, amanha)),
    };
  }, [agenda]);

  let corpo: ReactNode;
  if (consulta.isError) {
    corpo = (
      <div className="px-4 py-3">
        <Aviso tom="erro">
          Não deu para carregar a agenda de hoje.{" "}
          <button type="button" className="underline" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </button>
        </Aviso>
      </div>
    );
  } else if (!dia) {
    corpo = <EsqueletoHoje />;
  } else {
    const { atrasadas, eventos, tarefas, amanha } = dia;
    const hojeVazio = eventos.length === 0 && tarefas.length === 0;
    const sobrando = atrasadas.length - MAX_ATRASADAS;
    corpo =
      hojeVazio && atrasadas.length === 0 ? (
        <DiaLivre amanha={amanha} />
      ) : (
        <div className="space-y-1.5 p-1.5">
          {atrasadas.length > 0 && (
            <Grupo id={`${id}-atrasadas`} titulo="Atrasadas" contagem={atrasadas.length} atencao>
              {atrasadas.slice(0, MAX_ATRASADAS).map((tarefa) => (
                <LinhaTarefa
                  key={tarefa.id}
                  tarefa={tarefa}
                  quando={tarefa.date ? diaDaAgenda(tarefa.date) : "sem data"}
                  atrasada
                  onConcluir={alternar}
                />
              ))}
              {sobrando > 0 && (
                <li className="px-3 pb-2 text-miudo text-red-300">
                  e mais {contar(sobrando, "atrasada", "atrasadas")}
                </li>
              )}
            </Grupo>
          )}
          {eventos.length > 0 && (
            <Grupo id={`${id}-eventos`} titulo="Eventos" contagem={eventos.length}>
              {eventos.map((item) => (
                // Numa série, toda ocorrência traz o `id` dela: a chave leva o
                // dia da ocorrência (frente de eventos recorrentes); `?? date`
                // porque a API velha da janela do deploy não manda o campo.
                <LinhaEvento
                  key={`${item.evento.id}-${item.evento.occurrenceDate ?? item.evento.date}`}
                  item={item}
                />
              ))}
            </Grupo>
          )}
          {tarefas.length > 0 && (
            <Grupo id={`${id}-tarefas`} titulo="Tarefas" contagem={tarefas.length}>
              {tarefas.map((tarefa) => (
                <LinhaTarefa
                  key={tarefa.id}
                  tarefa={tarefa}
                  quando={tarefa.time ?? "sem hora"}
                  onConcluir={alternar}
                />
              ))}
            </Grupo>
          )}
          {hojeVazio && (
            <p className="px-3 py-2 text-xs text-ink-400">
              Nada marcado para hoje. <span className="text-ink-200">{amanha}</span>
            </p>
          )}
        </div>
      );
  }

  return (
    <MolduraHoje>
      {/* Quem perde o foco com a atrasada que sai (`useFocoQueSobrevive`) cai
          aqui, no próprio bloco, e não no `<body>`. */}
      <div
        id={`${id}-corpo`}
        data-foco-retorno={`${id}-corpo`}
        tabIndex={-1}
        role="group"
        aria-label="Hoje"
      >
        {aviso && (
          <div className="px-3 pt-3">
            <Aviso tom="erro" onFechar={limparAviso}>
              {aviso}
            </Aviso>
          </div>
        )}
        {corpo}
      </div>
    </MolduraHoje>
  );
}
