import { Aviso } from "@yu-book/cliente/base/Aviso";
import { useResumoRitmo } from "@yu-book/cliente/habitos";
import { useCruzamentoDoHumor, useHumor } from "@yu-book/cliente/humor";
import { TOM_DO_HABITO } from "@yu-book/cliente/ritmo/Emblema";
import { GraficoHumor } from "@yu-book/cliente/ritmo/GraficoHumor";
import { RostoHumor } from "@yu-book/cliente/ritmo/RostoHumor";
import {
  MOMENTOS_DO_HUMOR,
  NOMES_DO_HUMOR,
  NOMES_DOS_MOMENTOS,
  mediaDoDia,
  somarDias,
} from "@yu-book/shared";
import type { MomentoDoHumor, MoodDayItem, MoodInsight } from "@yu-book/shared";
import { useId, useState } from "react";
import { DIAS_CURTOS } from "@yu-book/cliente/agenda";
import { diaDaSemana, diaMesCurto, numeroDoDia } from "../../lib/datas";

const DIAS_DO_GRAFICO = 14;
const FILTROS: { chave: "media" | MomentoDoHumor; rotulo: string }[] = [
  { chave: "media", rotulo: "Média" },
  ...MOMENTOS_DO_HUMOR.map((m) => ({ chave: m, rotulo: NOMES_DOS_MOMENTOS[m] })),
];

/** "3,8" — uma casa, com vírgula. */
const umaCasa = (v: number) => v.toFixed(1).replace(".", ",");

/**
 * Ritmo › Humor (frente Ritmo, RF-45): o gráfico dos últimos 14 dias, com a
 * linha do humor sobre os pontos e o filtro por momento; os cartões "O que
 * anda junto"; e os registros recentes. Três leituras: o humor dos 30 dias, o
 * cruzamento (que traz os pontos por dia) e o resumo, pelo hoje do usuário.
 */
export function AbaHumor() {
  const resumo = useResumoRitmo();
  const hoje = resumo.data?.today ?? null;
  const humor = useHumor(hoje ? somarDias(hoje, -29) : null, hoje);
  const cruzamento = useCruzamentoDoHumor();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["chave"]>("media");
  const idGrafico = useId();
  const idJunto = useId();
  const idRegistros = useId();

  if (resumo.isError || humor.isError || cruzamento.isError) {
    return (
      <Aviso tom="erro">
        Não deu para carregar o humor.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            void resumo.refetch();
            void humor.refetch();
            void cruzamento.refetch();
          }}
        >
          Tentar de novo
        </button>
      </Aviso>
    );
  }
  if (!hoje || !humor.data || !cruzamento.data) {
    return (
      <div aria-hidden="true" className="space-y-3">
        <div className="h-64 animate-pulse rounded-dialogo bg-ink-900" />
        <div className="h-32 animate-pulse rounded-dialogo bg-ink-900" />
      </div>
    );
  }

  const porDia = new Map(humor.data.map((d) => [d.day, d]));
  const pontos = new Map(cruzamento.data.points.map((p) => [p.day, p.points]));
  const valorDe = (d: MoodDayItem | undefined) =>
    !d ? null : filtro === "media" ? mediaDoDia(d) : d[filtro];
  const dias = Array.from({ length: DIAS_DO_GRAFICO }, (_, i) => {
    const dia = somarDias(hoje, i - (DIAS_DO_GRAFICO - 1));
    return { dia, humor: valorDe(porDia.get(dia)), pontos: pontos.get(dia) ?? 0 };
  });
  const comHumor = dias.filter((d) => d.humor !== null);
  const media = comHumor.length
    ? comHumor.reduce((s, d) => s + (d.humor ?? 0), 0) / comHumor.length
    : null;
  const nomeDoFiltro = FILTROS.find((f) => f.chave === filtro)?.rotulo.toLowerCase() ?? "";

  return (
    <div className="space-y-4">
      <section
        aria-labelledby={idGrafico}
        className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={idGrafico} className="text-base font-bold text-titulo">
            Últimos {DIAS_DO_GRAFICO} dias
          </h2>
          <p className="text-xs text-ink-400">
            {media ? `média ${umaCasa(media)}` : "sem registro"}
          </p>
        </div>
        <div
          role="group"
          aria-label="Momento do dia"
          className="mt-3 grid grid-cols-4 gap-1 rounded-cartao bg-ink-900 p-1"
        >
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              aria-pressed={filtro === f.chave}
              onClick={() => setFiltro(f.chave)}
              className={`min-h-11 rounded-controle text-xs transition-colors ${
                filtro === f.chave
                  ? "bg-superficie font-semibold text-titulo shadow-e1"
                  : "font-medium text-ink-400 hover:text-ink-200"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <div aria-hidden="true" className="flex flex-col justify-between pb-6 pt-0.5">
            {[5, 3, 1].map((v) => (
              <RostoHumor key={v} valor={v} className="size-4.5" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <GraficoHumor
              dias={dias}
              rotulo={
                `Humor (${nomeDoFiltro}) nos últimos ${DIAS_DO_GRAFICO} dias` +
                (media ? `, média ${umaCasa(media)} de 5` : ", sem registro") +
                ", sobre os pontos de cada dia"
              }
            />
            <div aria-hidden="true" className="mt-1.5 flex justify-between text-miudo text-ink-400">
              <span>{diaMesCurto(dias[0]?.dia ?? hoje)}</span>
              <span>hoje</span>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="mt-2 flex gap-4 text-miudo text-ink-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.75 w-3.5 rounded-full bg-accent-400" />
            humor
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-accent-500/35" />
            pontos do dia
          </span>
        </div>
      </section>

      <section aria-labelledby={idJunto}>
        <div className="flex items-baseline justify-between px-0.5 pb-2 pt-1">
          <h2 id={idJunto} className="text-base font-bold text-titulo">
            O que anda junto
          </h2>
          <span className="text-xs text-ink-400">últimos 30 dias</span>
        </div>
        {cruzamento.data.habits.length === 0 ? (
          <p
            className="rounded-dialogo border border-dashed border-ink-700 px-5 py-5 text-sm
                       text-ink-400"
          >
            Com 7 dias de humor com um hábito e 7 sem, aparece aqui como os dois andam juntos.
          </p>
        ) : (
          <ul className="space-y-3">
            {cruzamento.data.habits.map((c) => (
              <CartaoJunto key={c.habitId} cartao={c} />
            ))}
          </ul>
        )}
        <p className="mt-2 px-0.5 text-miudo text-ink-400">
          Mostra o que acontece junto, não o que causa o quê. Com menos de 7 dias em cada lado, o
          cartão não aparece.
        </p>
      </section>

      <section
        aria-labelledby={idRegistros}
        className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
      >
        <h2 id={idRegistros} className="text-base font-bold text-titulo">
          Registros
        </h2>
        {humor.data.length === 0 ? (
          <p className="mt-2 text-sm text-ink-400">Nenhum humor nos últimos 30 dias.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {humor.data.slice(0, 10).map((d) => (
              <li key={d.day} className="flex gap-3 rounded-cartao bg-ink-900 p-3">
                <span className="flex w-10 shrink-0 flex-col items-center">
                  <span className="text-xl font-extrabold leading-none tabular-nums text-titulo">
                    {numeroDoDia(d.day)}
                  </span>
                  <span className="text-miudo text-ink-400">{DIAS_CURTOS[diaDaSemana(d.day)]}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex gap-1.5">
                    {MOMENTOS_DO_HUMOR.map((m) => {
                      const v = d[m];
                      const nome = NOMES_DOS_MOMENTOS[m].toLowerCase();
                      return v ? (
                        <RostoHumor
                          key={m}
                          valor={v}
                          className="size-6"
                          rotulo={`${nome}: ${NOMES_DO_HUMOR[v - 1]?.toLowerCase()}`}
                        />
                      ) : (
                        <span
                          key={m}
                          role="img"
                          aria-label={`${nome}: sem registro`}
                          className="size-6 rounded-full bg-ink-800"
                        />
                      );
                    })}
                  </span>
                  {d.note && <span className="mt-1.5 block text-sm text-ink-200">{d.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** RF-42: a média com e sem o hábito, com o `n` de cada lado à mostra. */
function CartaoJunto({ cartao }: { cartao: MoodInsight }) {
  const delta = Math.round((cartao.with.average - cartao.without.average) * 10) / 10;
  const sinal = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return (
    <li
      className={`${TOM_DO_HABITO[cartao.color]} rounded-dialogo border border-ink-800/70
                  bg-superficie p-4 shadow-e1`}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-(--tom)" />
        <span className="flex-1 font-bold text-titulo">Dias com {cartao.habitName}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            delta >= 0 ? "bg-sucesso-500/14 text-sucesso-300" : "bg-chama-500/15 text-chama-300"
          }`}
        >
          {sinal}
          {umaCasa(Math.abs(delta))}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-x-2.5 gap-y-2">
        {(
          [
            ["com", cartao.with, "bg-(--tom)"],
            ["sem", cartao.without, "bg-ink-400"],
          ] as const
        ).map(([rotulo, lado, cor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-xs text-ink-400">{rotulo}</dt>
            <dd aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className={`h-full rounded-full ${cor}`}
                style={{ width: `${(lado.average / 5) * 100}%` }}
              />
            </dd>
            <dd className="text-right text-xs font-bold tabular-nums text-titulo">
              {umaCasa(lado.average)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-miudo text-ink-400">
        Média do dia · {cartao.with.n} dias com, {cartao.without.n} sem
      </p>
    </li>
  );
}
