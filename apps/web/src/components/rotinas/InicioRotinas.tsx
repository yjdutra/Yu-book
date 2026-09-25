import type { Dashboard, DashboardRoutineRun } from "@yu-book/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAiAjustes } from "../../lib/ia";
import { useMarcarExecucoesVistas } from "../../lib/rotinas";
import { Aviso } from "../base/Aviso";
import { Bloco } from "../base/Bloco";
import { Botao } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { IconeBoard, IconeNotas, IconeRelogio, IconeRotina } from "../Icones";
import { textoDaPulada, textoDoGatilho } from "./Agenda";
import { horarioNoFuso, nomeDoFuso, pedeAtencao, quando, SeloStatus } from "./comum";
import { rotaDaExecucao } from "./rodar";

/**
 * O bloco Rotinas do Início (Etapa F da frente de IA): o que as rotinas
 * fizeram desde a última visita e o que vem a seguir. É o "nada falha calado"
 * da agenda — a rotina roda sem ninguém olhar, e a falha e a pulada aparecem
 * aqui, em destaque.
 *
 * Preguiçoso, fora do bundle inicial: `textoDaPulada` usa `proximaTentativa`,
 * de `agenda.ts`, que monta schema no escopo do módulo.
 */

type Rotinas = Dashboard["rotinas"];

const atencaoDe = (r: DashboardRoutineRun) => pedeAtencao(r.status) !== null;

/**
 * Junta o que já estava na tela com o que chegou: a execução nova entra, a que
 * mudou (a pulada que virou execução) é trocada, e **nenhuma sai**. Marcar como
 * visto não apaga a lista da tela — a volta de foco da janela refaz a consulta,
 * e o servidor já não mandaria as vistas.
 */
function juntar(antes: DashboardRoutineRun[], agora: DashboardRoutineRun[]) {
  const porId = new Map(antes.map((r) => [r.id, r]));
  for (const r of agora) porId.set(r.id, r);
  const fim = (r: DashboardRoutineRun) => new Date(r.endedAt ?? r.startedAt).getTime();
  return [...porId.values()].sort((a, b) => fim(b) - fim(a));
}

function LinhaExecucao({
  run,
  fuso,
  onAbrirNota,
}: {
  run: DashboardRoutineRun;
  fuso: string | null;
  onAbrirNota: (id: string) => void;
}) {
  const navigate = useNavigate();
  const atencao = atencaoDe(run);
  const detalhe =
    run.status === "pulada"
      ? `Não começou: ${run.errorMessage ?? "recusada no início"} · ${textoDaPulada(run, fuso)}`
      : atencao
        ? (run.errorMessage ?? "Parou antes de criar alguma coisa.")
        : null;

  return (
    <li className="flex items-center gap-3 rounded-controle px-3 py-2 hover:bg-ink-800/40">
      <span className="w-[6.5rem] shrink-0">
        <SeloStatus status={run.status} />
      </span>
      <span className="min-w-0 flex-1">
        <Link
          to={rotaDaExecucao(run.routineId, run.id)}
          className="block truncate rounded-etiqueta text-sm text-ink-200 hover:text-titulo"
          title="Ver a execução"
        >
          {run.routineName}
        </Link>
        <span
          className={`block truncate text-miudo ${
            !atencao ? "text-ink-400" : run.status === "falhou" ? "text-red-300" : "text-amber-300"
          }`}
          title={detalhe ?? undefined}
        >
          {detalhe ?? textoDoGatilho(run, fuso)}
        </span>
      </span>

      {/* O que ela deixou, a um clique: o card pela rota do quadro, a nota pelo
          `abrirNota` da casca (INV-55). */}
      {run.outputCardId && run.outputBoardId ? (
        <Etiqueta
          como="button"
          tom="ia"
          icone={<IconeBoard className="size-3 shrink-0" />}
          titulo="Abrir o card — aguardando revisão"
          onClick={() => navigate(`/b/${run.outputBoardId}/c/${run.outputCardId}`)}
        >
          {run.outputTitle ? `«${run.outputTitle}»` : "Card"} · para revisar
        </Etiqueta>
      ) : run.outputNoteId ? (
        <Etiqueta
          como="button"
          tom="ia"
          icone={<IconeNotas className="size-3 shrink-0" />}
          titulo="Abrir a nota — aguardando revisão"
          onClick={() => run.outputNoteId && onAbrirNota(run.outputNoteId)}
        >
          {run.outputTitle ? `«${run.outputTitle}»` : "Nota"} · para revisar
        </Etiqueta>
      ) : null}

      <time
        dateTime={run.endedAt ?? run.startedAt}
        className="w-24 shrink-0 text-right text-miudo tabular-nums text-ink-400"
      >
        {quando(run.endedAt ?? run.startedAt)}
      </time>
    </li>
  );
}

export function BlocoRotinas({
  dados,
  onAbrirNota,
}: {
  dados: Rotinas;
  onAbrirNota: (id: string) => void;
}) {
  const navigate = useNavigate();
  const fuso = useAiAjustes().data?.timezone ?? null;
  const [novas, setNovas] = useState(dados.novas);
  /// O corte da primeira leitura: "desde a última visita" fala dele, e não
  /// do marco que esta mesma visita acabou de gravar.
  const [vistoEm] = useState(dados.vistoEm);
  const marcar = useMarcarExecucoesVistas();
  const marcadoAte = useRef<string | null>(null);

  useEffect(() => {
    setNovas((antes) => juntar(antes, dados.novas));
  }, [dados.novas]);

  /**
   * Mostrou execuções novas: marca como visto, com o `ate` que veio junto
   * delas. Uma vez por leitura que trouxe novidade — a mesma leitura não
   * marca de novo, e a vazia não tem o que marcar.
   */
  const { mutate } = marcar;
  useEffect(() => {
    if (dados.novas.length === 0) return;
    if (marcadoAte.current && marcadoAte.current >= dados.ate) return;
    marcadoAte.current = dados.ate;
    mutate({ seenAt: dados.ate });
  }, [dados.novas.length, dados.ate, mutate]);

  const atencao = novas.filter(atencaoDe);
  const semNada = novas.length === 0 && dados.proximas.length === 0;

  return (
    <Bloco
      titulo="Rotinas"
      variante="ia"
      acao={
        <Botao
          variante="fantasma"
          className="-my-1"
          icone={<IconeRotina className="size-3.5" />}
          onClick={() => navigate("/assistente/rotinas")}
        >
          Ver rotinas
        </Botao>
      }
    >
      {semNada ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-sm text-ink-400">Nenhuma rotina agendada.</p>
          <p className="max-w-md text-xs text-ink-400">
            Uma rotina agendada roda sozinha nos dias e horários que você escolher, e o que ela
            fizer — ou deixar de fazer — aparece aqui.
          </p>
          <Link
            to="/assistente/rotinas"
            className="text-xs text-accent-400 underline decoration-accent-400/40
                       underline-offset-2 hover:text-titulo"
          >
            Agendar uma rotina
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <section aria-labelledby="inicio-rotinas-novas" className="min-w-0 p-1.5">
            <h4
              id="inicio-rotinas-novas"
              className="flex items-baseline gap-2 px-3 pt-1.5 pb-1 text-xs text-ink-400"
            >
              <span className="font-medium text-ink-200">Desde a última visita</span>
              <span className="text-miudo">
                · {vistoEm ? quando(vistoEm) : "nas últimas 24 horas"}
              </span>
            </h4>

            {atencao.length > 0 && (
              <div className="px-3 pb-1.5">
                <Aviso tom={atencao.some((r) => r.status === "falhou") ? "erro" : "alerta"}>
                  {atencao.length === 1
                    ? "Uma execução não criou nada: "
                    : `${atencao.length} execuções não criaram nada: `}
                  {atencao.map((r) => `«${r.routineName}» ${r.status}`).join(", ")}. O motivo
                  está em cada linha.
                </Aviso>
              </div>
            )}

            {novas.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink-400">Nada novo desde a última visita.</p>
            ) : (
              <ul>
                {/* As que pedem atenção primeiro: são as que ninguém viu dar errado. */}
                {[...atencao, ...novas.filter((r) => !atencaoDe(r))].map((r) => (
                  <LinhaExecucao key={r.id} run={r} fuso={fuso} onAbrirNota={onAbrirNota} />
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="inicio-rotinas-proximas"
            className="min-w-0 border-l border-ink-800 px-4 py-3"
          >
            <h4
              id="inicio-rotinas-proximas"
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="font-medium text-ink-200">Próximas</span>
              {fuso && (
                <span className="truncate text-miudo text-ink-400" title="O fuso de Ajustes">
                  fuso {nomeDoFuso(fuso)}
                </span>
              )}
            </h4>
            {dados.proximas.length === 0 ? (
              <p className="mt-2 text-xs text-ink-400">
                Nenhuma rotina agendada.{" "}
                <Link
                  to="/assistente/rotinas"
                  className="text-accent-400 underline decoration-accent-400/40
                             underline-offset-2 hover:text-titulo"
                >
                  Agendar uma rotina
                </Link>
              </p>
            ) : (
              <ol className="mt-2 grid gap-1.5">
                {dados.proximas.map((p) => (
                  <li key={`${p.routineId}-${p.at}`} className="flex min-w-0 items-center gap-2">
                    <IconeRelogio className="size-3.5 shrink-0 text-accent-400" />
                    <time
                      dateTime={p.at}
                      className="shrink-0 text-xs tabular-nums text-ink-200"
                    >
                      {fuso ? horarioNoFuso(p.at, fuso, "curto") : "…"}
                    </time>
                    <Link
                      to={`/assistente/rotinas/${p.routineId}`}
                      className="min-w-0 truncate rounded-etiqueta text-xs text-ink-400
                                 hover:text-titulo"
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Bloco>
  );
}
