import { ApiError } from "@yu-book/cliente/api";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { BarrasPorDia } from "@yu-book/cliente/graficos/BarrasPorDia";
import {
  oQueFalta,
  useHabito,
  useOfensivas,
  useRegistros,
  useResumoRitmo,
} from "@yu-book/cliente/habitos";
import { IconeChevron, IconeCronometro, IconeMais } from "@yu-book/cliente/icones";
import { AnelProgresso } from "@yu-book/cliente/ritmo/AnelProgresso";
import { BarrasPonderadas } from "@yu-book/cliente/ritmo/BarrasPonderadas";
import { EmblemaHabito, TOM_DO_HABITO } from "@yu-book/cliente/ritmo/Emblema";
import { PilulaPontos } from "@yu-book/cliente/ritmo/LinhaAtividade";
import { MapaCalor } from "@yu-book/cliente/ritmo/MapaCalor";
import type { CelulaDoMapa } from "@yu-book/cliente/ritmo/MapaCalor";
import { inicioDaSemana, somarDias } from "@yu-book/shared";
import type { HabitEntryItem, HabitItem, HabitStreak } from "@yu-book/shared";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useRitmo } from "../components/ritmo/Ritmo";
import { diasDaBarra } from "../components/ritmo/semana";
import { diaCurto, diaMesCurto } from "../lib/datas";

/// O mapa de frequência: doze semanas, de segunda a domingo (RF-24).
const SEMANAS_DO_MAPA = 12;
const DIAS_DA_LINHA = 30;

function Bloco({
  titulo,
  extra,
  children,
}: {
  titulo: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-base font-bold text-titulo">
          {titulo}
        </h2>
        {extra && <p className="text-xs text-ink-400">{extra}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Os pontos por dia, de uma lista de registros. */
function somaPorDia(registros: HabitEntryItem[]): Map<string, number> {
  const porDia = new Map<string, number>();
  for (const r of registros) porDia.set(r.day, (porDia.get(r.day) ?? 0) + r.points);
  return porDia;
}

/**
 * O detalhe de um hábito (frente Ritmo, RF-21 a RF-24): o anel da meta, as
 * barras ponderadas com o teto, as atividades, os últimos 30 dias e o mapa de
 * 12 semanas. O histórico vem numa consulta só de registros (RF-11), das doze
 * semanas até hoje; os 30 dias saem do mesmo recorte.
 */
export function HabitoPage() {
  const { id } = useParams();
  const habito = useHabito(id);
  const resumo = useResumoRitmo();
  const hoje = resumo.data?.today ?? null;
  const inicioDoMapa = hoje ? somarDias(inicioDaSemana(hoje), -(SEMANAS_DO_MAPA - 1) * 7) : null;
  const registros = useRegistros(id, inicioDoMapa, hoje);
  const ofensivas = useOfensivas();

  const voltar = (
    <Link
      to="/ritmo"
      className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-controle px-2 text-sm
                 font-medium text-ink-400 hover:text-ink-200"
    >
      <IconeChevron direcao="esquerda" className="size-4" />
      Hábitos
    </Link>
  );

  const naoExiste = habito.error instanceof ApiError && habito.error.code === "NOT_FOUND";
  if (naoExiste) {
    return (
      <div className="mx-auto max-w-2xl">
        {voltar}
        <Aviso tom="info">Esse hábito não existe mais nesta conta.</Aviso>
      </div>
    );
  }
  if (habito.isError || resumo.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        {voltar}
        <Aviso tom="erro">
          Não deu para carregar o hábito.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              if (habito.isError) void habito.refetch();
              if (resumo.isError) void resumo.refetch();
            }}
          >
            Tentar de novo
          </button>
        </Aviso>
      </div>
    );
  }
  if (!habito.data || !hoje) {
    return (
      <div className="mx-auto max-w-2xl" aria-hidden="true">
        {voltar}
        <div className="mx-auto size-44 animate-pulse rounded-full bg-ink-900" />
        <div className="mt-6 h-48 animate-pulse rounded-dialogo bg-ink-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {voltar}
      <Detalhe
        habito={habito.data}
        hoje={hoje}
        registros={registros.data}
        ofensiva={ofensivas.data?.habits.find((o) => o.habitId === habito.data?.id)}
        falhaDoHistorico={registros.isError}
        onTentarHistorico={() => void registros.refetch()}
      />
    </div>
  );
}

function Detalhe({
  habito,
  hoje,
  registros,
  ofensiva,
  falhaDoHistorico,
  onTentarHistorico,
}: {
  habito: HabitItem;
  hoje: string;
  registros: HabitEntryItem[] | undefined;
  /** A ofensiva e os recordes do hábito (Ritmo 3, RF-38). */
  ofensiva: HabitStreak | undefined;
  falhaDoHistorico: boolean;
  onTentarHistorico: () => void;
}) {
  const { abrirRegistro } = useRitmo();
  const { week, weeklyGoal, targetDays } = habito;
  const ativas = habito.activities.filter((a) => !a.archived);

  const historico = useMemo(() => {
    if (!registros) return null;
    const porDia = somaPorDia(registros);
    const trinta = Array.from({ length: DIAS_DA_LINHA }, (_, i) => {
      const dia = somarDias(hoje, i - (DIAS_DA_LINHA - 1));
      return { dia, valor: porDia.get(dia) ?? 0 };
    });
    const inicio = somarDias(inicioDaSemana(hoje), -(SEMANAS_DO_MAPA - 1) * 7);
    const semanas: (CelulaDoMapa | null)[][] = Array.from({ length: SEMANAS_DO_MAPA }, (_, s) =>
      Array.from({ length: 7 }, (_, d) => {
        const dia = somarDias(inicio, s * 7 + d);
        return dia > hoje ? null : { dia, pontos: porDia.get(dia) ?? 0 };
      }),
    );
    const vezes = new Map<string, number>();
    for (const r of registros) {
      if (r.activity && r.day >= week.start) {
        vezes.set(r.activity.id, (vezes.get(r.activity.id) ?? 0) + 1);
      }
    }
    const diasAtivos = [...porDia.values()].filter((v) => v > 0).length;
    const media = Math.round(trinta.reduce((s, d) => s + d.valor, 0) / DIAS_DA_LINHA);
    return { trinta, semanas, vezes, diasAtivos, media };
  }, [registros, hoje, week.start]);

  const falhaDoBloco = (
    <Aviso tom="erro">
      Não deu para carregar o histórico.{" "}
      <button type="button" className="underline" onClick={onTentarHistorico}>
        Tentar de novo
      </button>
    </Aviso>
  );
  const esqueleto = (
    <div aria-hidden="true" className="h-24 animate-pulse rounded-cartao bg-ink-900" />
  );

  return (
    <div className={`${TOM_DO_HABITO[habito.color]} space-y-4`}>
      <section className="flex flex-col items-center gap-3 pb-1 text-center">
        <div className="flex items-center gap-2.5">
          <EmblemaHabito emblema={habito.emblem} tamanho="p" />
          <h2 className="text-xl font-bold text-titulo">{habito.name}</h2>
        </div>
        <AnelProgresso
          valor={week.progress}
          total={weeklyGoal}
          tamanho={168}
          espessura={16}
          rotulo={`${week.progress} de ${weeklyGoal} pontos que contam para a meta da semana`}
        >
          <span className="flex flex-col items-center">
            <span className="text-4xl font-extrabold leading-none tracking-tight tabular-nums text-titulo">
              {week.progress}
            </span>
            <span className="mt-1 text-miudo text-ink-400">de {weeklyGoal} pts</span>
          </span>
        </AnelProgresso>
        <p className="font-semibold text-titulo">{oQueFalta(habito, hoje)}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {ofensiva && ofensiva.current > 0 && (
            <span
              className="rounded-full bg-[color-mix(in_srgb,var(--color-chama-500)_16%,transparent)]
                         px-2.5 py-1 text-xs font-semibold text-chama-300"
            >
              {ofensiva.current} {ofensiva.current === 1 ? "semana seguida" : "semanas seguidas"}
            </span>
          )}
          <span className="rounded-full bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-200">
            {targetDays} {targetDays === 1 ? "dia" : "dias"} · teto {week.cap}/dia
          </span>
          {week.goalMet && (
            <span className="rounded-full bg-sucesso-500/14 px-2.5 py-1 text-xs font-semibold text-sucesso-300">
              meta batida
            </span>
          )}
          {habito.archived && (
            <span className="rounded-full bg-ink-800 px-2.5 py-1 text-xs font-semibold text-ink-400">
              arquivado
            </span>
          )}
        </div>
      </section>

      <Bloco
        titulo="Semana ponderada"
        extra={
          <span className="tabular-nums">
            {week.progress} contam{week.extra > 0 ? ` · +${week.extra} XP extra` : ""}
          </span>
        }
      >
        <BarrasPonderadas
          dias={diasDaBarra(week.days, hoje)}
          teto={week.cap}
          rotulo={`Pontos por dia nesta semana, com o teto de ${week.cap} por dia`}
        />
      </Bloco>

      <Bloco titulo="Atividades" extra="esta semana">
        {ativas.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nenhuma atividade. Registre um valor livre, ou crie atividades pelo assistente ou pelo MCP.
          </p>
        ) : (
          <ul className="space-y-2">
            {ativas.map((a) => {
              const vezes = historico?.vezes.get(a.id) ?? 0;
              return (
                // O nome inteiro em cima, quebrando linha; o resto embaixo — numa
                // linha só, os controles espremiam o nome até o truncar.
                <li key={a.id} className="rounded-cartao bg-ink-900 py-2 pl-3 pr-2">
                  <span className="block break-words text-[0.9375rem] font-semibold text-titulo">
                    {a.name}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs tabular-nums text-ink-400">
                      {historico ? `${vezes}× nesta semana` : ""}
                      {historico && a.pointsPerPomodoro ? " · " : ""}
                      {a.pointsPerPomodoro ? `+${a.pointsPerPomodoro} por pomodoro` : ""}
                    </span>
                    <PilulaPontos pontos={a.points} />
                    <Link
                      to={`/foco?atividade=${a.id}`}
                      aria-label={`Focar em “${a.name}”`}
                      className="grid size-11 shrink-0 place-items-center rounded-full"
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-9 place-items-center rounded-full bg-accent-500/15
                                   text-accent-400"
                      >
                        <IconeCronometro className="size-4.5" />
                      </span>
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!habito.archived && (
          <Botao
            variante="primario"
            tamanho="g"
            icone={<IconeMais className="size-4" />}
            onClick={() => abrirRegistro(habito.id)}
            aria-haspopup="dialog"
            className="mt-3 w-full"
          >
            Registrar fora do plano
          </Botao>
        )}
      </Bloco>

      <Bloco
        titulo={`Últimos ${DIAS_DA_LINHA} dias`}
        extra={historico ? `média ${historico.media} pts/dia` : undefined}
      >
        {falhaDoHistorico ? (
          falhaDoBloco
        ) : historico ? (
          <BarrasPorDia
            dias={historico.trinta}
            formatar={(v) => `${v} pts`}
            rotulo={`Pontos por dia em ${habito.name}`}
          />
        ) : (
          esqueleto
        )}
      </Bloco>

      <Bloco
        titulo="Frequência"
        extra={historico ? `${SEMANAS_DO_MAPA} semanas · ${historico.diasAtivos} dias ativos` : undefined}
      >
        {falhaDoHistorico ? (
          falhaDoBloco
        ) : historico ? (
          <MapaCalor
            semanas={historico.semanas}
            teto={week.cap}
            formatarDia={diaCurto}
            rotulo={
              `${habito.name}: ${historico.diasAtivos} dias com registro nas últimas ` +
              `${SEMANAS_DO_MAPA} semanas, desde ${diaMesCurto(historico.semanas[0]?.[0]?.dia ?? hoje)}`
            }
          />
        ) : (
          esqueleto
        )}
      </Bloco>

      {ofensiva && (
        <section aria-label="Recordes do hábito">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1">
              <dt className="rotulo">Melhor semana</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-titulo">
                {ofensiva.bestWeek ? `${ofensiva.bestWeek.points} pts` : "—"}
              </dd>
              {ofensiva.bestWeek && (
                <dd className="text-miudo text-ink-400">
                  {diaMesCurto(ofensiva.bestWeek.start)} – {diaMesCurto(ofensiva.bestWeek.end)}
                </dd>
              )}
            </div>
            <div className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1">
              <dt className="rotulo">Maior sequência</dt>
              <dd className="mt-1 text-2xl font-extrabold tabular-nums text-titulo">
                {ofensiva.best} {ofensiva.best === 1 ? "semana" : "semanas"}
              </dd>
              <dd className="text-miudo text-ink-400">
                {ofensiva.best === 0
                  ? "bata a meta para começar"
                  : ofensiva.current >= ofensiva.best
                    ? "é a de agora"
                    : `faltam ${ofensiva.best - ofensiva.current} para bater`}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
