import {
  INTERVALO_ENTRE_TENTATIVAS_MS,
  JANELA_DO_AGENDADOR_MS,
  MAX_HORARIOS_DA_AGENDA,
  PROXIMOS_HORARIOS,
  TENTATIVAS_DO_HORARIO,
  proximaTentativa,
  proximosHorarios,
} from "@yu-book/shared";
import type { RoutineRunSummary, RoutineSchedule, RoutineSummary } from "@yu-book/shared";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Aviso } from "../base/Aviso";
import { Botao, BotaoIcone } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { Interruptor } from "../base/Interruptor";
import { Parte } from "../base/Parte";
import {
  IconeAlerta,
  IconeCheck,
  IconeFechar,
  IconeInfo,
  IconeMais,
  IconeRelogio,
} from "../Icones";
import { DIAS_DA_SEMANA, horaNoFuso, horarioNoFuso, nomeDoFuso, ROTULO_GATILHO } from "./comum";

/**
 * A agenda das rotinas (Etapa F da frente de IA) na tela: a seção do editor,
 * o selo "Agendada · próxima …" e o que o histórico, a execução e o Início
 * dizem de uma execução agendada ou pulada.
 *
 * Este arquivo importa **valor** de `agenda.ts` de `shared`, que monta schema
 * no escopo do módulo: ele só pode ser alcançado pelos chunks preguiçosos (as
 * rotinas e o bloco Rotinas do Início). O painel contextual, que está no
 * bundle inicial, olha `schedule` e `nextRuns` do servidor, por `import type`.
 *
 * Todo horário é mostrado no fuso de `/ajustes`, nunca no do navegador: é por
 * ele que o servidor dispara (`horarioNoFuso`, `comum.tsx`).
 */

const MINUTOS_ENTRE_TENTATIVAS = INTERVALO_ENTRE_TENTATIVAS_MS / 60_000;
const MINUTOS_DA_JANELA = JANELA_DO_AGENDADOR_MS / 60_000;

/** Os dias úteis, para o atalho da seção. */
const DIAS_UTEIS = [1, 2, 3, 4, 5];

/** "1 vez", "3 vezes". */
const vezes = (n: number) => `${n} ${n === 1 ? "vez" : "vezes"}`;

/**
 * O primeiro horário cheio que a agenda ainda não tem, a partir das 8h — o
 * horário novo nasce preenchido e diferente dos outros, ou nasceria repetido.
 */
function horarioLivre(existentes: string[]): string {
  for (let i = 0; i < 24; i++) {
    const hora = `${String((8 + i) % 24).padStart(2, "0")}:00`;
    if (!existentes.includes(hora)) return hora;
  }
  return "08:00";
}

/* ------------------------------------------------------ execução agendada */

/**
 * A pulada que ainda vai tentar de novo não é um fim: diz quando. A que
 * esgotou as tentativas diz quantas foram. `proximaTentativa` é a mesma
 * função que o agendador usa para decidir — as duas não divergem.
 */
export function textoDaPulada(run: RoutineRunSummary, fuso: string | null): string {
  const proxima = proximaTentativa(run);
  if (proxima) {
    return fuso
      ? `tenta de novo às ${horaNoFuso(proxima, fuso)}`
      : "vai tentar de novo em alguns minutos";
  }
  return `tentou ${vezes(run.attempts ?? TENTATIVAS_DO_HORARIO)}`;
}

/**
 * Quem disparou, em palavras: "manual" ou "agendada · ter 30/09 08:00 · 2ª
 * tentativa". A tentativa só aparece quando não foi a primeira — é a notícia
 * de que houve recusa antes.
 */
export function textoDoGatilho(run: RoutineRunSummary, fuso: string | null): string {
  if (run.trigger !== "agenda") return ROTULO_GATILHO.manual;
  const partes: string[] = [ROTULO_GATILHO.agenda];
  if (run.scheduledFor) partes.push(fuso ? horarioNoFuso(run.scheduledFor, fuso) : "…");
  if (run.status === "pulada") partes.push(textoDaPulada(run, fuso));
  else if ((run.attempts ?? 1) > 1) partes.push(`${run.attempts}ª tentativa`);
  return partes.join(" · ");
}

/* ------------------------------------------------------------ selo e ação */

/** Há o que agendar: dias e horários gravados. Sem eles, não existe "pausada". */
export const temAgenda = (s: RoutineSchedule) => s.days.length > 0 && s.times.length > 0;

/**
 * O estado da agenda gravada, com ícone e palavra (RNF-09): "Agendada ·
 * próxima ter 08:00", "Agendada · não roda até resolver" ou "Pausada". Nada
 * sem agenda. Sem expressão de cron à vista — dia e hora, como se fala.
 */
export function SeloAgenda({
  rotina,
  fuso,
}: {
  rotina: Pick<RoutineSummary, "schedule" | "nextRuns" | "valid">;
  fuso: string | null;
}) {
  if (!temAgenda(rotina.schedule)) return null;
  if (!rotina.schedule.active) {
    return <Etiqueta icone={<span aria-hidden="true">‖</span>}>Pausada</Etiqueta>;
  }
  const proxima = rotina.nextRuns[0];
  if (!rotina.valid || !proxima) {
    return (
      <span
        className="inline-flex max-w-full items-center gap-1 rounded-etiqueta border
                   border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-miudo text-amber-300"
      >
        <IconeAlerta className="size-3 shrink-0" />
        <span className="truncate">Agendada · não roda até resolver</span>
      </span>
    );
  }
  return (
    <Etiqueta tom="destaque" icone={<IconeRelogio className="size-3 shrink-0" />}>
      Agendada · próxima {fuso ? horarioNoFuso(proxima, fuso, "curto") : "…"}
    </Etiqueta>
  );
}

/* --------------------------------------------------------- seção do editor */

/** Id da seção — o alvo de foco de "ir ao problema" da agenda. */
export const ID_AGENDA = "yb-rotina-agenda";

/**
 * A seção Agenda do editor de rotina. Faz parte do rascunho, como o resto: só
 * vale ao salvar — o "Pausar/Retomar" do cabeçalho é que age na hora.
 *
 * `rotinaComProblema` é o resto do editor: com a agenda ligada e a rotina
 * inválida, a agenda **não desliga sozinha** — o servidor registra cada
 * horário como pulado, com o motivo, e é isso que a seção avisa.
 */
export function SecaoAgenda({
  agenda,
  onMudar,
  fuso,
  problemas,
  rotinaComProblema,
  salvaAtiva,
}: {
  agenda: RoutineSchedule;
  onMudar: (agenda: RoutineSchedule) => void;
  fuso: string | null;
  problemas: string[];
  rotinaComProblema: boolean;
  /// A agenda gravada está ligada — para dizer o que o interruptor muda.
  salvaAtiva: boolean | null;
}) {
  const lista = useRef<HTMLOListElement>(null);
  const idMais = `${ID_AGENDA}-mais`;
  const cheia = agenda.times.length >= MAX_HORARIOS_DA_AGENDA;

  /// A prévia sai da mesma função que o servidor usa para `nextRuns` e o
  /// agendador para disparar: a tela e o relógio concordam por construção.
  const previa = useMemo(
    () =>
      fuso && problemas.length === 0
        ? proximosHorarios(agenda, fuso, new Date(), PROXIMOS_HORARIOS)
        : [],
    [agenda, fuso, problemas.length],
  );

  function alternarDia(dia: number) {
    const days = agenda.days.includes(dia)
      ? agenda.days.filter((d) => d !== dia)
      : [...agenda.days, dia];
    onMudar({ ...agenda, days });
  }

  function mudarHorario(i: number, valor: string) {
    onMudar({ ...agenda, times: agenda.times.map((t, j) => (j === i ? valor : t)) });
  }

  function focarHorario(i: number) {
    requestAnimationFrame(() => {
      const campos = lista.current?.querySelectorAll<HTMLInputElement>("input[type=time]");
      const alvo = campos?.[i];
      if (alvo) alvo.focus();
      else document.getElementById(idMais)?.focus();
    });
  }

  function adicionar() {
    if (cheia) return;
    const times = [...agenda.times, horarioLivre(agenda.times)];
    onMudar({ ...agenda, times });
    focarHorario(times.length - 1);
  }

  /// O botão de remover some com a linha: o foco vai para o horário que ficou
  /// no lugar, ou para o anterior, ou para "Adicionar" (RNF-06 da Fase 1).
  function remover(i: number) {
    const times = agenda.times.filter((_, j) => j !== i);
    onMudar({ ...agenda, times });
    focarHorario(times.length === 0 ? -1 : Math.min(i, times.length - 1));
  }

  const idProblemas = `${ID_AGENDA}-problemas`;
  const selecionados = agenda.days.length;

  return (
    <div id={ID_AGENDA} tabIndex={-1} className="min-w-0 rounded-cartao">
      <Parte
        titulo="Agenda"
        variante="ia"
        descricao={
          "Rodar sozinha em dias e horários fixos, no seu fuso. Nada é publicado fora do " +
          "Yu-book: o que a rotina fizer fica esperando você."
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-6">
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <Interruptor
              ligado={agenda.active}
              onMudar={(active) => onMudar({ ...agenda, active })}
              rotulo="Rodar sozinha"
              descricao={
                salvaAtiva === null
                  ? "Vale a partir de quando a rotina for criada."
                  : salvaAtiva === agenda.active
                    ? "Faz parte da rotina: muda ao salvar. Para pausar sem salvar o resto, " +
                      "use Pausar no topo."
                    : agenda.active
                      ? "Liga ao salvar."
                      : "Desliga ao salvar."
              }
            />

            <div
              role="group"
              aria-labelledby={`${ID_AGENDA}-dias`}
              aria-describedby={problemas.length > 0 ? idProblemas : undefined}
              className="min-w-0"
            >
              <p id={`${ID_AGENDA}-dias`} className="rotulo">
                Dias
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DIAS_DA_SEMANA.map((d, i) => {
                  const marcado = agenda.days.includes(i);
                  return (
                    <button
                      key={d.curto}
                      type="button"
                      aria-pressed={marcado}
                      aria-label={d.longo}
                      title={d.longo}
                      onClick={() => alternarDia(i)}
                      className={`inline-flex h-8 w-14 items-center justify-center gap-1
                                  rounded-full border text-xs font-medium transition-colors
                                  duration-[120ms] ease-(--ease-padrao) ${
                                    marcado
                                      ? "border-accent-400 bg-accent-500/15 text-titulo"
                                      : "border-dashed border-ink-700 text-ink-400 " +
                                        "hover:border-ink-400 hover:text-ink-200"
                                  }`}
                    >
                      {/* Marcado tem forma, não só cor: o visto e a borda cheia (RNF-09). */}
                      {marcado && <IconeCheck className="size-3 shrink-0 text-accent-400" />}
                      {d.curto}
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <p className="mr-auto text-miudo text-ink-400">
                  {selecionados === 0
                    ? "Nenhum dia escolhido."
                    : selecionados === 7
                      ? "Todos os dias."
                      : `${selecionados} ${selecionados === 1 ? "dia" : "dias"} por semana.`}
                </p>
                <Botao
                  variante="fantasma"
                  onClick={() => onMudar({ ...agenda, days: [...DIAS_UTEIS] })}
                >
                  Dias úteis
                </Botao>
                <Botao
                  variante="fantasma"
                  onClick={() => onMudar({ ...agenda, days: [0, 1, 2, 3, 4, 5, 6] })}
                >
                  Todos
                </Botao>
              </div>
            </div>

            <div role="group" aria-labelledby={`${ID_AGENDA}-horarios`} className="min-w-0">
              <p className="flex items-baseline justify-between">
                <span id={`${ID_AGENDA}-horarios`} className="rotulo">
                  Horários
                </span>
                <span className="text-miudo tabular-nums text-ink-400">
                  {agenda.times.length}/{MAX_HORARIOS_DA_AGENDA}
                </span>
              </p>
              {agenda.times.length > 0 && (
                <ol ref={lista} className="mt-2 flex flex-wrap gap-2">
                  {agenda.times.map((t, i) => (
                    // A posição é a chave: o valor muda a cada tecla, e o campo
                    // perderia o foco se a chave mudasse junto.
                    <li
                      key={i}
                      className="flex items-center gap-0.5 rounded-controle border border-ink-700
                                 bg-ink-900 pl-2 focus-within:border-accent-400"
                    >
                      <IconeRelogio className="size-3.5 shrink-0 text-ink-400" />
                      <input
                        type="time"
                        step={60}
                        value={t}
                        required
                        onChange={(e) => mudarHorario(i, e.target.value)}
                        aria-label={`Horário ${i + 1}`}
                        aria-invalid={
                          t === "" || agenda.times.indexOf(t) !== i ? true : undefined
                        }
                        className="h-8 w-[5.5rem] bg-transparent px-1 text-sm tabular-nums
                                   text-ink-200 outline-none aria-invalid:text-red-300"
                      />
                      <BotaoIcone
                        rotulo={t ? `Remover o horário ${t}` : `Remover o horário ${i + 1}`}
                        tamanho="p"
                        icone={<IconeFechar className="size-3" />}
                        onClick={() => remover(i)}
                      />
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-2 flex items-center gap-2">
                <Botao
                  id={idMais}
                  variante="secundario"
                  icone={<IconeMais className="size-3.5" />}
                  disabled={cheia}
                  onClick={adicionar}
                >
                  Adicionar horário
                </Botao>
                {cheia && (
                  <span className="text-miudo text-ink-400">
                    No máximo {MAX_HORARIOS_DA_AGENDA} por rotina.
                  </span>
                )}
              </div>
            </div>

            {problemas.length > 0 && (
              <ul id={idProblemas} className="grid gap-0.5">
                {problemas.map((p) => (
                  <li key={p} className="flex items-center gap-1.5 text-xs text-amber-300">
                    <IconeAlerta className="size-3.5 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-1 content-start gap-3">
            <div>
              <p className="rotulo flex items-baseline justify-between gap-2">
                <span>{agenda.active ? "Próximas" : "Se estivesse ligada"}</span>
                {fuso && (
                  <Link
                    to="/ajustes/gasto"
                    title="O fuso é o mesmo do teto diário, em Ajustes › Gasto"
                    className="min-w-0 truncate normal-case tracking-normal text-ink-400
                               underline decoration-ink-700 underline-offset-2
                               hover:text-ink-200"
                  >
                    fuso {nomeDoFuso(fuso)}
                  </Link>
                )}
              </p>
              {!fuso ? (
                <div aria-hidden="true" className="mt-2 grid gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-5 w-40 animate-pulse rounded-etiqueta bg-ink-800"
                    />
                  ))}
                </div>
              ) : previa.length > 0 ? (
                <ol
                  className={`mt-2 grid gap-1 ${agenda.active ? "text-ink-200" : "text-ink-400"}`}
                >
                  {previa.map((t) => (
                    <li
                      key={t.toISOString()}
                      className="flex items-center gap-2 text-sm tabular-nums"
                    >
                      <IconeRelogio
                        className={`size-3.5 shrink-0 ${
                          agenda.active ? "text-accent-400" : "text-ink-400"
                        }`}
                      />
                      <time dateTime={t.toISOString()}>{horarioNoFuso(t, fuso)}</time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-xs text-ink-400">
                  Escolha pelo menos um dia e um horário para ver quando ela roda.
                </p>
              )}
              {!agenda.active && previa.length > 0 && (
                <p className="mt-1.5 text-miudo text-ink-400">
                  Desligada: nada roda sozinho até ligar e salvar.
                </p>
              )}
            </div>

            {agenda.active && rotinaComProblema && (
              <Aviso tom="alerta">
                Não vai rodar enquanto houver problema. A agenda continua ligada: cada horário
                fica registrado como pulado, com o motivo, até a rotina ser consertada.
              </Aviso>
            )}

            <div
              className="flex gap-2 rounded-controle bg-ink-900/60 px-3 py-2 text-miudo
                         text-ink-400"
            >
              <IconeInfo className="mt-px size-3.5 shrink-0" />
              <ul className="grid gap-1">
                <li>Cada horário respeita o teto diário e o teto por execução desta rotina.</li>
                <li>
                  Se não puder começar — outra rotina rodando, sem ideia na coluna, teto do dia
                  atingido —, tenta de novo a cada {MINUTOS_ENTRE_TENTATIVAS} minutos, até{" "}
                  {vezes(TENTATIVAS_DO_HORARIO)}; depois fica registrada como pulada. Recusa não
                  custa nada.
                </li>
                <li>
                  Uma execução que começou e falhou não se repete: não se paga duas vezes pelo
                  mesmo horário. Com o servidor fora por mais de {MINUTOS_DA_JANELA} minutos, o
                  horário se perde.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Parte>
    </div>
  );
}

/* ---------------------------------------------------- execução pulada */

/** O que fazer com cada recusa, pelo `code` — nunca pela mensagem. */
function caminhoDaRecusa(code: string | null): ReactNode {
  switch (code) {
    case "SEM_IDEIA":
      return "A coluna de entrada estava vazia, ou todas as ideias dela já tinham passado por " +
        "esta rotina. Ponha uma ideia nova na coluna para o próximo horário.";
    case "ROTINA_EM_ANDAMENTO":
      return "Outra execução estava rodando — uma por vez. Horários de rotinas diferentes " +
        "muito próximos disputam a vez.";
    case "TETO_DIARIO_ATINGIDO":
      return (
        <>
          O gasto do dia tinha chegado ao teto.{" "}
          <Link to="/ajustes/gasto" className="font-medium underline underline-offset-2">
            Ver o gasto do dia
          </Link>
        </>
      );
    case "ROTINA_INVALIDA":
      return "A rotina tinha problemas — uma coluna ou um agente que sumiu. A agenda segue " +
        "ligada; conserte a rotina para o próximo horário rodar.";
    default:
      return null;
  }
}

function Medida({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-miudo text-ink-400">{rotulo}</dt>
      <dd className="truncate text-sm tabular-nums text-ink-200">{children}</dd>
    </div>
  );
}

/**
 * A tela de uma execução pulada: só o resumo. Enquanto houver tentativa pela
 * frente, ela não é um fim — e a linha que está aqui é a mesma que vira
 * execução se a próxima tentativa começar.
 */
export function ResumoDaPulada({ run, fuso }: { run: RoutineRunSummary; fuso: string | null }) {
  const proxima = proximaTentativa(run);
  const tentativas = run.attempts ?? TENTATIVAS_DO_HORARIO;
  const caminho = caminhoDaRecusa(run.errorCode);

  return (
    <>
      <Aviso tom={proxima ? "info" : "alerta"}>
        <p>
          <span className="font-medium">Não começou:</span>{" "}
          {run.errorMessage ?? "a execução foi recusada no início."}
        </p>
        {caminho && <p className="mt-1">{caminho}</p>}
      </Aviso>

      <dl
        className="grid grid-cols-4 gap-4 rounded-cartao border border-ink-800 bg-superficie
                   px-4 py-3 shadow-e1"
      >
        <Medida rotulo="Horário da agenda">
          {run.scheduledFor && fuso ? horarioNoFuso(run.scheduledFor, fuso) : "—"}
        </Medida>
        <Medida rotulo="Tentativas">
          {tentativas} de {TENTATIVAS_DO_HORARIO}
        </Medida>
        <Medida rotulo="Última tentativa">
          {run.endedAt && fuso ? horaNoFuso(run.endedAt, fuso) : "—"}
        </Medida>
        <Medida rotulo="Próxima tentativa">
          {proxima ? (fuso ? horaNoFuso(proxima, fuso) : "em breve") : "nenhuma"}
        </Medida>
      </dl>

      <p className="text-xs text-ink-400">
        {proxima
          ? `Ainda tenta de novo, a cada ${MINUTOS_ENTRE_TENTATIVAS} minutos. Se começar, é ` +
            "esta mesma execução que passa a rodar — volte aqui para acompanhar."
          : `Tentou ${vezes(tentativas)} e o horário foi pulado. O próximo horário da agenda ` +
            "tenta do zero."}{" "}
        Nada foi gasto: a recusa acontece antes de chamar o modelo.
        {run.routineId && (
          <>
            {" "}
            <Link
              to={`/assistente/rotinas/${run.routineId}`}
              className="text-accent-400 underline decoration-accent-400/40 underline-offset-2
                         hover:text-titulo"
            >
              Abrir a rotina
            </Link>
          </>
        )}
      </p>
    </>
  );
}
