import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Indicador } from "@yu-book/cliente/graficos/Indicador";
import { useHabitos, useOfensivas, useResumoRitmo } from "@yu-book/cliente/habitos";
import { IconeAssistente, IconeRitmo } from "@yu-book/cliente/icones";
import { AnelProgresso } from "@yu-book/cliente/ritmo/AnelProgresso";
import { BarrasPonderadas } from "@yu-book/cliente/ritmo/BarrasPonderadas";
import { EmblemaHabito, TOM_DO_HABITO } from "@yu-book/cliente/ritmo/Emblema";
import { BarraXp, fracaoDoNivel, SeloNivel } from "@yu-book/cliente/ritmo/Nivel";
import type { HabitItem, HabitsSummary } from "@yu-book/shared";
import { useId } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { EstadoVazio } from "../components/agenda/ItemAgenda";
import { AbaHumor } from "../components/ritmo/AbaHumor";
import { AbaOfensivas } from "../components/ritmo/AbaOfensivas";
import { diasDaBarra, milhar, periodoCurto, semanaDeTodos } from "../components/ritmo/semana";

const ABAS = [
  { chave: "habitos", para: "/ritmo", rotulo: "Hábitos", fase: null },
  { chave: "ofensivas", para: "/ritmo/ofensivas", rotulo: "Ofensivas", fase: null },
  { chave: "skills", para: "/ritmo/skills", rotulo: "Skills", fase: "Ritmo 5" },
  { chave: "humor", para: "/ritmo/humor", rotulo: "Humor", fase: null },
] as const;

const EM_BREVE: Record<string, string> = {
  skills: "Os modos de agir que você quer internalizar, com emblema e nível.",
};

/**
 * Ritmo (frente Ritmo, RF-17 a RF-20): quatro abas no topo, e nesta fase só
 * Hábitos tem conteúdo — o cartão de nível, a semana em barras e a grade.
 *
 * As abas são rotas (`/ritmo`, `/ritmo/ofensivas`…): links com
 * `aria-current`, como o seletor de Plano, e não `tablist` — cada uma é uma
 * página que o Voltar desfaz.
 */
export function RitmoPage() {
  const { aba = "habitos" } = useParams();
  const atual = ABAS.find((a) => a.chave === aba);
  if (!atual) return <Navigate to="/ritmo" replace />;

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="Seções do Ritmo" className="mb-5">
        <ul className="grid grid-cols-4 gap-1 rounded-cartao border border-ink-800/70 bg-ink-900 p-1">
          {ABAS.map((a) => {
            const ativa = a.chave === atual.chave;
            return (
              <li key={a.chave}>
                <Link
                  to={a.para}
                  aria-current={ativa ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-center rounded-controle text-[0.8125rem]
                              transition-colors duration-150 ${
                                ativa
                                  ? "bg-superficie font-semibold text-titulo shadow-e1"
                                  : "font-medium text-ink-400 hover:text-ink-200"
                              }`}
                >
                  {a.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {atual.chave === "habitos" ? (
        <AbaHabitos />
      ) : atual.chave === "ofensivas" ? (
        <AbaOfensivas />
      ) : atual.chave === "humor" ? (
        <AbaHumor />
      ) : (
        <EstadoVazio
          Icone={IconeRitmo}
          tom="[--tom:var(--color-chama-600)]"
          titulo={`${atual.rotulo} chega na ${atual.fase}`}
          texto={EM_BREVE[atual.chave] ?? ""}
        />
      )}
    </div>
  );
}

function AbaHabitos() {
  const habitos = useHabitos();
  const resumo = useResumoRitmo();
  // A ofensiva de cada hábito (Ritmo 3, RF-38). Não segura a tela: a pílula
  // só aparece quando chega.
  const ofensivas = useOfensivas();
  const idSemana = useId();
  const idGrade = useId();

  if (habitos.isError || resumo.isError) {
    return (
      <Aviso tom="erro">
        Não deu para carregar os hábitos.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            if (habitos.isError) void habitos.refetch();
            if (resumo.isError) void resumo.refetch();
          }}
        >
          Tentar de novo
        </button>
      </Aviso>
    );
  }
  if (habitos.isPending || resumo.isPending) {
    return (
      <div aria-hidden="true" className="space-y-3">
        <div className="h-40 animate-pulse rounded-dialogo bg-ink-900" />
        <div className="h-44 animate-pulse rounded-dialogo bg-ink-900" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-40 animate-pulse rounded-dialogo bg-ink-900" />
          <div className="h-40 animate-pulse rounded-dialogo bg-ink-900" />
        </div>
      </div>
    );
  }

  const lista = habitos.data;
  const hoje = resumo.data.today;
  const semana = semanaDeTodos(lista);

  return (
    <div className="space-y-4">
      <CartaoNivel resumo={resumo.data} semana={semana} />

      {lista.length === 0 ? (
        <EstadoVazio
          Icone={IconeRitmo}
          tom="[--tom:var(--color-chama-600)]"
          titulo="Nenhum hábito ainda"
          texto="Peça ao assistente, ou pelo MCP: “crie o hábito Inglês, 120 pontos por semana em 4 dias”."
          acao={
            <Link
              to="/assistente/nova"
              className="inline-flex min-h-11 items-center gap-2 rounded-controle bg-ink-800 px-4
                         text-sm font-semibold text-titulo"
            >
              <IconeAssistente className="size-4" />
              Abrir o assistente
            </Link>
          }
        />
      ) : (
        <>
          <section
            aria-labelledby={idSemana}
            className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={idSemana} className="text-base font-bold text-titulo">
                Esta semana
              </h2>
              {semana.inicio && semana.fim && (
                <p className="text-xs text-ink-400">
                  {periodoCurto(semana.inicio, semana.fim)} ·{" "}
                  <span className="tabular-nums">
                    {semana.conta} de {semana.meta} pts
                  </span>
                </p>
              )}
            </div>
            <div className="mt-3">
              <BarrasPonderadas
                dias={diasDaBarra(semana.dias, hoje)}
                rotulo="Pontos por dia nesta semana, somados entre os hábitos"
              />
            </div>
          </section>

          <section aria-labelledby={idGrade}>
            <div className="flex items-baseline justify-between px-0.5 pb-2 pt-1">
              <h2 id={idGrade} className="text-base font-bold text-titulo">
                Hábitos
              </h2>
              <span className="text-xs text-ink-400">meta ponderada da semana</span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {lista.map((h) => (
                <li key={h.id}>
                  <CartaoHabito
                    habito={h}
                    hoje={hoje}
                    semanas={ofensivas.data?.habits.find((o) => o.habitId === h.id)?.current}
                  />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** RF-18: o nível, a barra de XP e três números da semana. */
function CartaoNivel({
  resumo,
  semana,
}: {
  resumo: HabitsSummary;
  semana: ReturnType<typeof semanaDeTodos>;
}) {
  const { xp, weekXp, level } = resumo;
  const falta = level.to - xp;
  const pct = semana.meta > 0 ? Math.min(100, Math.round((semana.conta / semana.meta) * 100)) : 0;
  return (
    <section
      aria-label={`Nível ${level.level}, ${level.name}`}
      className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
    >
      <div className="flex items-center gap-3.5">
        <SeloNivel nivel={level.level} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-lg font-extrabold text-titulo">{level.name}</p>
            <p className="text-miudo text-ink-400">
              Nível {level.level + 1} em <span className="tabular-nums">{milhar(falta)}</span> XP
            </p>
          </div>
          <div className="mt-1.5">
            <BarraXp fracao={fracaoDoNivel(xp, level)} />
          </div>
          <p className="mt-1.5 text-miudo text-ink-400">
            <span className="tabular-nums">
              {milhar(xp)} / {milhar(level.to)}
            </span>{" "}
            XP
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[
          { rotulo: "Semana", valor: `${pct}%`, detalhe: "da meta" },
          { rotulo: "XP", valor: `+${milhar(weekXp)}`, detalhe: "nesta semana" },
          { rotulo: "Dias", valor: `${semana.diasAtivos}/7`, detalhe: "com registro" },
        ].map((n) => (
          <Indicador
            key={n.rotulo}
            rotulo={n.rotulo}
            valor={n.valor}
            detalhe={n.detalhe}
            className="rounded-cartao bg-ink-900 px-3 py-2.5"
          />
        ))}
      </dl>
    </section>
  );
}

/** RF-20: um hábito na grade. O nome do link diz o que o cartão mostra. */
function CartaoHabito({
  habito,
  hoje,
  semanas,
}: {
  habito: HabitItem;
  hoje: string;
  /** Semanas seguidas com a meta batida (RF-38); `undefined` enquanto carrega. */
  semanas: number | undefined;
}) {
  const { week, weeklyGoal, targetDays } = habito;
  const pct = Math.min(100, Math.round((week.progress / Math.max(1, weeklyGoal)) * 100));
  return (
    <Link
      to={`/ritmo/habitos/${habito.id}`}
      aria-label={
        `${habito.name}: ${week.progress} de ${weeklyGoal} pontos, ` +
        `${week.activeDays} de ${targetDays} dias${week.goalMet ? ", meta batida" : ""}`
      }
      className={`${TOM_DO_HABITO[habito.color]} group flex h-full flex-col gap-2.5 rounded-dialogo
                  border border-ink-800/70 bg-superficie p-3.5 shadow-e1 transition duration-150
                  hover:shadow-e2 active:scale-[0.98]`}
    >
      <span className="flex items-start justify-between">
        <EmblemaHabito emblema={habito.emblem} />
        <AnelProgresso
          valor={week.progress}
          total={weeklyGoal}
          rotulo={`${pct}% da meta`}
          checkAoFechar
        >
          <span className="text-[0.6875rem] font-extrabold tabular-nums text-titulo">{pct}%</span>
        </AnelProgresso>
      </span>
      <span aria-hidden="true" className="block min-w-0">
        <span className="block truncate text-base font-bold text-titulo">{habito.name}</span>
        <span className="block text-miudo text-ink-400 tabular-nums">
          {week.progress} de {weeklyGoal} pts · {week.activeDays}/{targetDays} dias
        </span>
      </span>
      {semanas !== undefined && (
        <span
          className={`self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            semanas > 0
              ? "bg-[color-mix(in_srgb,var(--color-chama-500)_16%,transparent)] text-chama-300"
              : "bg-ink-800 text-ink-400"
          }`}
        >
          {semanas > 0 ? `${semanas} ${semanas === 1 ? "semana" : "semanas"}` : "comece hoje"}
        </span>
      )}
      <span aria-hidden="true" className="mt-auto flex gap-1">
        {week.days.map((d) => (
          <span
            key={d.day}
            className={`h-1.5 flex-1 rounded-full ${
              d.points > 0
                ? "bg-(--tom)"
                : d.day === hoje
                  ? "bg-ink-700"
                  : "bg-ink-800"
            }`}
          />
        ))}
      </span>
    </Link>
  );
}
