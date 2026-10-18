import { useTarefas } from "@yu-book/cliente/agenda";
import { useAlternarTarefa } from "@yu-book/cliente/concluirTarefa";
import { useAgendaAdiante } from "@yu-book/cliente/hoje";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import {
  IconeBoard,
  IconeCalendario,
  IconeChevron,
  IconeHoje,
  IconeMais,
  IconeTarefa,
} from "@yu-book/cliente/icones";
import type { IconeProps } from "@yu-book/cliente/icones";
import { contar } from "@yu-book/cliente/texto";
import { horaLocal, somarDias } from "@yu-book/shared";
import type { AgendaRange, TaskItem } from "@yu-book/shared";
import { useId, useMemo } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { EstadoVazio, ItemAgenda } from "../components/agenda/ItemAgenda";
import { indexarPorDia, inicioDe, itemDeTarefa, tituloDe } from "../components/agenda/itens";
import type { ItemDoDia, ResumoDoDia } from "../components/agenda/itens";
import { useFolhaItem } from "../components/folha/FolhaItem";
import { HojeNoRitmo } from "../components/ritmo/HojeNoRitmo";
import { useMarcarAtividade } from "../components/ritmo/marcar";
import { diaCurto, diaRelativo } from "../lib/datas";
import { DIAS_DA_SEMANA_ADIANTE } from "../lib/hoje";
import { useQuadros } from "../lib/quadros";

interface Resumo {
  para: string;
  titulo: string;
  Icone: (p: IconeProps) => ReactElement;
  /** Classe que declara `--tom`: um token de cor existente, nunca cor nova. */
  tom: string;
  /** `null` enquanto carrega. */
  numero: number | null;
  /** O que o número conta ("eventos e tarefas"). */
  detalhe: string;
  /** A linha de baixo: o próximo, as atrasadas. */
  nota: string | null;
  /** A nota pede atenção (atrasadas): glifo e cor. */
  alerta?: boolean;
  /** Do que o número é feito, só para o leitor de tela ("1 evento e 2 tarefas"). */
  composicao?: string;
  /** A consulta do número falhou: traço, e não o esqueleto eterno. */
  indisponivel?: boolean;
}

function CartaoResumo({ resumo, ordem }: { resumo: Resumo; ordem: number }) {
  const { para, titulo, Icone, tom, numero, detalhe, nota, alerta, composicao, indisponivel } =
    resumo;
  // O nome do link diz tudo o que o cartão mostra, na ordem em que se lê.
  const rotulo =
    numero === null
      ? `${titulo}: ${indisponivel ? "não carregou" : "carregando"}`
      : `${titulo}: ${numero} ${detalhe}${composicao ? ` (${composicao})` : ""}${
          nota && nota !== composicao ? `; ${nota}` : ""
        }`;
  return (
    <Link
      to={para}
      aria-label={rotulo}
      // Entrada em cascata, curta; `backwards` segura o cartão invisível
      // durante o atraso, em vez de piscar inteiro antes de entrar.
      style={{ animationDelay: `${ordem * 50}ms` }}
      className={`cartao-pastel ${tom} group flex min-h-36 flex-col justify-between rounded-dialogo
                  p-4 shadow-e2 transition duration-150 ease-(--ease-padrao) animate-surgir
                  [animation-fill-mode:backwards] hover:shadow-e3 active:scale-[0.98]`}
    >
      <span className="flex items-start justify-between">
        <span
          className="flex size-10 items-center justify-center rounded-full bg-(--tom) text-white
                     shadow-e1"
        >
          <Icone className="size-5" />
        </span>
        <IconeChevron
          direcao="direita"
          className="size-4 text-ink-400 transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-4 block" aria-hidden="true">
        {numero === null && indisponivel ? (
          <span className="block text-3xl font-semibold leading-none text-ink-400">—</span>
        ) : numero === null ? (
          <span className="block h-8 w-10 animate-pulse rounded-etiqueta bg-ink-700/60" />
        ) : (
          <span className="block text-3xl font-semibold leading-none tabular-nums text-titulo">
            {numero}
          </span>
        )}
        <span className="mt-2 block text-sm font-semibold text-titulo">{titulo}</span>
        <span
          className={`block truncate text-xs ${
            alerta ? "font-semibold text-red-300" : "text-ink-400"
          }`}
        >
          {alerta && "! "}
          {nota ?? detalhe}
        </span>
      </span>
    </Link>
  );
}

/** A agenda não veio: a seção diz, em vez de mostrar "Dia livre" de mentira. */
function FalhaDaAgenda({ onTentar }: { onTentar: () => void }) {
  return (
    <Aviso tom="erro">
      Não deu para carregar a agenda.{" "}
      <button type="button" className="underline" onClick={onTentar}>
        Tentar de novo
      </button>
    </Aviso>
  );
}

/** Os números dos cartões, de uma agenda de sete dias e da lista de abertas. */
function resumir(
  agenda: AgendaRange | undefined,
  porDia: Map<string, ResumoDoDia> | null,
  abertas: TaskItem[] | undefined,
  quadros: number | null,
  fuso: string | null,
): Resumo[] {
  const hoje = agenda?.today ?? null;
  const doDia = (hoje && porDia?.get(hoje)?.itens) || [];
  const eventosHoje = doDia.filter((i) => i.tipo === "evento").length;
  const tarefasHoje = doDia.filter((i) => i.tipo === "tarefa" && !i.tarefa.completedAt).length;
  const totalHoje = eventosHoje + tarefasHoje;
  const porTipo = [
    eventosHoje ? contar(eventosHoje, "evento", "eventos") : null,
    tarefasHoje ? contar(tarefasHoje, "tarefa", "tarefas") : null,
  ]
    .filter(Boolean)
    .join(" e ");

  // O próximo com hora, pela hora de agora **no fuso do usuário**.
  const agora = fuso ? horaLocal(new Date(), fuso) : null;
  const proximo = agora
    ? doDia.find((i) => {
        const inicio = inicioDe(i);
        const aberto = i.tipo !== "tarefa" || !i.tarefa.completedAt;
        return inicio !== null && inicio >= agora && aberto;
      })
    : undefined;

  const emAberto = abertas?.filter((t) => !t.completedAt);
  const atrasadas = emAberto?.filter((t) => t.overdue).length ?? 0;

  // Projeto ativo: tem tarefa aberta ou evento na semana.
  const ativos = new Set<string>();
  for (const t of emAberto ?? []) if (t.board) ativos.add(t.board.id);
  for (const e of agenda?.events ?? []) if (e.board) ativos.add(e.board.id);

  return [
    {
      para: hoje ? `/agenda?dia=${hoje}` : "/agenda",
      titulo: "Hoje",
      Icone: IconeHoje,
      tom: "[--tom:var(--color-accent-500)]",
      numero: agenda ? totalHoje : null,
      detalhe: "para hoje",
      composicao: porTipo || "nada marcado",
      nota: proximo
        ? `próximo: ${tituloDe(proximo)} ${inicioDe(proximo)}`
        : agenda && totalHoje === 0
          ? "dia livre"
          : porTipo || null,
    },
    {
      para: "/agenda",
      titulo: "Agenda",
      Icone: IconeCalendario,
      tom: "[--tom:var(--color-agente-azul)]",
      numero: agenda ? agenda.events.length : null,
      detalhe: agenda?.events.length === 1 ? "evento em 7 dias" : "eventos em 7 dias",
      nota: null,
    },
    {
      para: "/projetos",
      titulo: "Projetos",
      Icone: IconeBoard,
      tom: "[--tom:var(--color-agente-ambar)]",
      numero: abertas && agenda ? ativos.size : null,
      detalhe: ativos.size === 1 ? "projeto em andamento" : "projetos em andamento",
      nota: quadros !== null ? `de ${contar(quadros, "quadro", "quadros")}` : null,
    },
    {
      para: "/tarefas",
      titulo: "Tarefas",
      Icone: IconeTarefa,
      tom: "[--tom:var(--color-agente-verde)]",
      numero: emAberto ? emAberto.length : null,
      detalhe: "em aberto",
      nota: atrasadas > 0 ? contar(atrasadas, "atrasada", "atrasadas") : "nenhuma atrasada",
      alerta: atrasadas > 0,
    },
  ];
}

/**
 * O Início do móvel (frente de agenda, Fase 4): quatro cartões com os números
 * do dia e da semana, "O seu dia" e os próximos dias.
 *
 * **Três consultas, todas de saída, nenhuma em cascata:** a agenda de hoje a
 * seis dias adiante (`useAgendaAdiante`, a mesma que a casca mantém para o
 * "hoje" — normalmente já em cache), as tarefas abertas (a lista de Tarefas) e
 * os quadros. Concluir aqui marca as três telas de uma vez, porque o otimismo
 * de `useConcluirTarefa` escreve em todo cache de agenda e de tarefas.
 */
export function InicioPage() {
  const { hoje, fuso, consulta } = useAgendaAdiante(DIAS_DA_SEMANA_ADIANTE);
  const abertas = useTarefas({ status: "abertas" });
  const quadros = useQuadros();
  const { abrir } = useFolhaItem();
  const { alternar, aviso: avisoDaTarefa, limparAviso: limparAvisoDaTarefa } = useAlternarTarefa();
  const { marcarEvento, aviso: avisoDoCheckIn, limparAviso: limparAvisoDoCheckIn } =
    useMarcarAtividade();
  const aviso = avisoDaTarefa ?? avisoDoCheckIn;
  const limparAviso = () => {
    limparAvisoDaTarefa();
    limparAvisoDoCheckIn();
  };
  const idResumo = useId();
  const idDia = useId();
  const idProximos = useId();
  const agenda = consulta.data;

  const porDia = useMemo(() => (agenda ? indexarPorDia(agenda) : null), [agenda]);
  const falhas = {
    Hoje: consulta.isError,
    Agenda: consulta.isError,
    Projetos: consulta.isError || abertas.isError,
    Tarefas: abertas.isError,
  } as Record<string, boolean>;
  const resumos = resumir(agenda, porDia, abertas.data, quadros.data?.length ?? null, fuso).map(
    (r) => ({ ...r, indisponivel: falhas[r.titulo] ?? false }),
  );
  const doDia = (hoje && porDia?.get(hoje)?.itens) || [];
  const atrasadas = agenda?.overdueTasks ?? [];
  const proximos = hoje
    ? Array.from({ length: DIAS_DA_SEMANA_ADIANTE }, (_, i) => somarDias(hoje, i + 1))
        .map((dia) => ({ dia, itens: porDia?.get(dia)?.itens ?? [] }))
        .filter((d) => d.itens.length > 0)
    : [];

  function abrirItem(item: ItemDoDia) {
    if (item.tipo === "evento") abrir({ modo: "editar", evento: item.evento });
    else if (item.tipo === "tarefa") abrir({ modo: "editar", tarefa: item.tarefa });
  }

  const carregando = consulta.isPending;

  return (
    <>
      <section aria-labelledby={idResumo}>
        <h2 id={idResumo} className="sr-only">
          Resumo
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {resumos.map((resumo, i) => (
            <li key={resumo.titulo}>
              <CartaoResumo resumo={resumo} ordem={i} />
            </li>
          ))}
        </ul>
        {(consulta.isError || abertas.isError) && (
          <Aviso tom="erro" className="mt-3">
            Não deu para carregar os números.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (consulta.isError) void consulta.refetch();
                if (abertas.isError) void abertas.refetch();
              }}
            >
              Tentar de novo
            </button>
          </Aviso>
        )}
      </section>

      {/* Frente Ritmo, RF-26: logo depois dos números, antes do dia inteiro. */}
      {hoje && porDia && (
        <div className="mt-6">
          <HojeNoRitmo hoje={hoje} itens={porDia.get(hoje)?.itens ?? []} />
        </div>
      )}

      {aviso && (
        <Aviso tom="erro" onFechar={limparAviso} className="mt-6">
          {aviso}
        </Aviso>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby={idDia} data-foco-retorno={idDia}>
          <div className="flex items-center justify-between gap-3">
            <h2 id={idDia} tabIndex={-1} className="rotulo">
              O seu dia
            </h2>
            {hoje && (
              <button
                type="button"
                onClick={() => abrir({ modo: "criar", tipo: "evento", dia: hoje })}
                aria-label="Criar hoje"
                title="Criar hoje"
                aria-haspopup="dialog"
                className="flex size-11 items-center justify-center rounded-full text-accent-400
                           transition-colors hover:bg-accent-500/10"
              >
                <IconeMais className="size-5" />
              </button>
            )}
          </div>
          <div className="mt-2">
            {consulta.isError ? (
              <FalhaDaAgenda onTentar={() => void consulta.refetch()} />
            ) : carregando ? (
              <ul aria-hidden="true" className="space-y-2">
                {[0, 1].map((i) => (
                  <li key={i} className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900" />
                ))}
              </ul>
            ) : atrasadas.length === 0 && doDia.length === 0 ? (
              <EstadoVazio
                Icone={IconeHoje}
                tom="[--tom:var(--color-accent-500)]"
                titulo="Dia livre"
                texto="Nada marcado para hoje e nada atrasado. Aproveite — ou anote o que vier."
                acao={
                  hoje ? (
                    <Botao
                      variante="secundario"
                      tamanho="g"
                      icone={<IconeMais className="size-4" />}
                      onClick={() => abrir({ modo: "criar", tipo: "evento", dia: hoje })}
                    >
                      Criar hoje
                    </Botao>
                  ) : undefined
                }
              />
            ) : (
              // Atrasadas no topo, em destaque: são o que já passou da hora.
              <ul className="space-y-2">
                {atrasadas.map((tarefa) => (
                  <ItemAgenda
                    key={tarefa.id}
                    item={itemDeTarefa(tarefa, tarefa.date ? diaCurto(tarefa.date) : "sem data")}
                    atrasada={tarefa.completedAt === null}
                    onAbrir={abrirItem}
                    onConcluir={alternar}
                  />
                ))}
                {doDia.map((item) => (
                  <ItemAgenda
                    key={item.id}
                    item={item}
                    onAbrir={abrirItem}
                    onConcluir={alternar}
                    onCheckIn={marcarEvento}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby={idProximos} data-foco-retorno={idProximos}>
          <h2 id={idProximos} tabIndex={-1} className="rotulo flex min-h-11 items-center">
            Próximos dias
          </h2>
          <div className="mt-2">
            {consulta.isError ? (
              <FalhaDaAgenda onTentar={() => void consulta.refetch()} />
            ) : carregando ? (
              <div
                aria-hidden="true"
                className="h-[4.5rem] animate-pulse rounded-cartao bg-ink-900"
              />
            ) : proximos.length === 0 ? (
              <p
                className="rounded-dialogo border border-dashed border-ink-700 px-5 py-6
                           text-center text-sm text-ink-400"
              >
                Nada nos próximos seis dias.
              </p>
            ) : (
              <div className="space-y-5">
                {proximos.map(({ dia, itens }) => (
                  <div key={dia}>
                    <h3 className="text-sm font-semibold text-titulo first-letter:uppercase">
                      <Link to={`/agenda?dia=${dia}`} className="hover:underline">
                        {diaRelativo(dia, hoje)}
                      </Link>
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {itens.map((item) => (
                        <ItemAgenda
                          key={item.id}
                          item={item}
                          onAbrir={abrirItem}
                          onConcluir={alternar}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
