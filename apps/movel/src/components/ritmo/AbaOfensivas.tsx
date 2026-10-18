import { Aviso } from "@yu-book/cliente/base/Aviso";
import { useOfensivas } from "@yu-book/cliente/habitos";
import { IconeChevron } from "@yu-book/cliente/icones";
import { CalendarioOfensiva } from "@yu-book/cliente/ritmo/CalendarioOfensiva";
import { CartaoChama } from "@yu-book/cliente/ritmo/CartaoChama";
import { MAX_DIAS_DO_HISTORICO, somarDias } from "@yu-book/shared";
import type { HabitsStreaks } from "@yu-book/shared";
import { useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { diaLongo, diaMesCurto, mesDoDia, somarMeses, tituloDoMes } from "../../lib/datas";
import { gradeDaOfensiva, periodoDaSequencia } from "./ofensivas";

const ABAS_DO_RANKING = [
  { chave: "dias", rotulo: "Dias seguidos" },
  { chave: "habitos", rotulo: "Hábitos" },
  { chave: "semanas", rotulo: "Semanas" },
] as const;
type AbaDoRanking = (typeof ABAS_DO_RANKING)[number]["chave"];

/** A medalha do pódio: o anel em ouro, prata (`ink-400`) e bronze (`chama-600`). */
const MEDALHA = ["border-ouro-500", "border-ink-400", "border-chama-600"] as const;

const SUAVE_DA_CHAMA = "bg-[color-mix(in_srgb,var(--color-chama-500)_14%,transparent)]";

/**
 * Ritmo › Ofensivas (frente Ritmo, RF-36): o cartão da chama, o calendário do
 * mês com a faixa dos dias seguidos e o ranking pessoal. Uma leitura só,
 * `GET /habits/streaks`.
 */
export function AbaOfensivas() {
  const ofensivas = useOfensivas();
  if (ofensivas.isError) {
    return (
      <Aviso tom="erro">
        Não deu para carregar as ofensivas.{" "}
        <button type="button" className="underline" onClick={() => void ofensivas.refetch()}>
          Tentar de novo
        </button>
      </Aviso>
    );
  }
  if (ofensivas.isPending) {
    return (
      <div aria-hidden="true" className="space-y-3">
        <div className="h-48 animate-pulse rounded-dialogo bg-ink-900" />
        <div className="h-80 animate-pulse rounded-dialogo bg-ink-900" />
      </div>
    );
  }
  return <Conteudo dados={ofensivas.data} />;
}

function Conteudo({ dados }: { dados: HabitsStreaks }) {
  const { today: hoje, general } = dados;
  const ativos = useMemo(() => new Set(dados.activeDays), [dados.activeDays]);
  const [mes, setMes] = useState(() => mesDoDia(hoje));
  // RN-25: o calendário não navega antes da janela dos dias ativos.
  const primeiroMes = mesDoDia(somarDias(hoje, -(MAX_DIAS_DO_HISTORICO - 1)));
  const grade = useMemo(() => gradeDaOfensiva(mes, ativos, hoje), [mes, ativos, hoje]);
  const casas = grade.filter((c) => c !== null);
  const ativosNoMes = casas.filter((c) => c.ativo).length;
  const perdidosNoMes = casas.filter((c) => c.perdido).length;
  const idCalendario = useId();
  const idRanking = useId();
  const botaoDoMes =
    "grid size-11 place-items-center rounded-controle bg-ink-800 text-ink-200 disabled:opacity-40";

  return (
    <div className="space-y-4">
      <CartaoChama
        dias={general.current}
        recorde={general.best}
        hojeFeito={general.todayDone}
        grande
      />

      <section
        aria-labelledby={idCalendario}
        className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={idCalendario} aria-live="polite" className="text-base font-bold text-titulo">
            {tituloDoMes(mes)}
          </h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setMes(somarMeses(mes, -1))}
              disabled={mes <= primeiroMes}
              aria-label="Mês anterior"
              className={botaoDoMes}
            >
              <IconeChevron direcao="esquerda" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setMes(somarMeses(mes, 1))}
              disabled={mes >= mesDoDia(hoje)}
              aria-label="Mês seguinte"
              className={botaoDoMes}
            >
              <IconeChevron direcao="direita" className="size-4" />
            </button>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-cartao border border-ink-800 px-3 py-2">
            <dt className="text-miudo text-ink-400">dias ativos</dt>
            <dd className="text-lg font-extrabold tabular-nums text-titulo">{ativosNoMes}</dd>
          </div>
          <div className="rounded-cartao border border-ink-800 px-3 py-2">
            <dt className="text-miudo text-ink-400">dias perdidos</dt>
            <dd className="text-lg font-extrabold tabular-nums text-titulo">{perdidosNoMes}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <CalendarioOfensiva dias={grade} rotulo={tituloDoMes(mes)} formatarDia={diaLongo} />
        </div>
      </section>

      <section
        aria-labelledby={idRanking}
        className="rounded-dialogo border border-ink-800/70 bg-superficie p-4 shadow-e1"
      >
        <h2 id={idRanking} className="text-base font-bold text-titulo">
          Ranking pessoal
        </h2>
        <Ranking dados={dados} />
        <p className="mt-3 text-miudo text-ink-400">
          Calculado a partir dos registros. Quando a sequência em andamento passa a de cima, ela
          sobe na hora.
        </p>
      </section>
    </div>
  );
}

interface Linha {
  chave: string;
  valor: string;
  quando: string;
  viva: boolean;
}

function linhasDe(dados: HabitsStreaks, aba: AbaDoRanking): Linha[] {
  const periodo = (a: string, b: string) => periodoDaSequencia(a, b, dados.today, diaMesCurto);
  if (aba === "dias") {
    return dados.records.days.map((s) => ({
      chave: s.start,
      valor: `${s.length} ${s.length === 1 ? "dia" : "dias"}`,
      quando: periodo(s.start, s.end),
      viva: s.alive,
    }));
  }
  if (aba === "habitos") {
    return dados.records.habitWeeks.map((s) => ({
      chave: `${s.habitId}-${s.start}`,
      valor: `${s.habitName} · ${s.length} ${s.length === 1 ? "semana" : "semanas"}`,
      quando: periodo(s.start, s.end),
      viva: s.alive,
    }));
  }
  return dados.records.weeks.map((w) => ({
    chave: w.start,
    valor: `${w.points} pts`,
    quando: periodo(w.start, w.end),
    viva: false,
  }));
}

/** O ranking pessoal (RF-34), em três abas. Medalha só no pódio. */
function Ranking({ dados }: { dados: HabitsStreaks }) {
  const [aba, setAba] = useState<AbaDoRanking>("dias");
  const idAba = useId();
  const linhas = linhasDe(dados, aba);

  // As setas trocam de aba e levam o foco junto (ativação automática).
  function teclas(ev: KeyboardEvent<HTMLDivElement>) {
    const i = ABAS_DO_RANKING.findIndex((a) => a.chave === aba);
    const passo = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
    if (!passo) return;
    ev.preventDefault();
    const n = ABAS_DO_RANKING.length;
    const proxima = ABAS_DO_RANKING[(i + passo + n) % n];
    if (!proxima) return;
    setAba(proxima.chave);
    ev.currentTarget.querySelector<HTMLElement>(`[data-aba="${proxima.chave}"]`)?.focus();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Tipo de recorde"
        onKeyDown={teclas}
        className="mt-3 grid grid-cols-3 gap-1 rounded-cartao bg-ink-900 p-1"
      >
        {ABAS_DO_RANKING.map((a) => {
          const ativa = a.chave === aba;
          return (
            <button
              key={a.chave}
              type="button"
              role="tab"
              id={`${idAba}-${a.chave}`}
              data-aba={a.chave}
              aria-selected={ativa}
              aria-controls={`${idAba}-painel`}
              tabIndex={ativa ? 0 : -1}
              onClick={() => setAba(a.chave)}
              className={`min-h-11 rounded-controle text-xs transition-colors ${
                ativa
                  ? "bg-superficie font-semibold text-titulo shadow-e1"
                  : "font-medium text-ink-400 hover:text-ink-200"
              }`}
            >
              {a.rotulo}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${idAba}-painel`}
        aria-labelledby={`${idAba}-${aba}`}
        className="mt-3"
      >
        {linhas.length === 0 ? (
          <p className="text-sm text-ink-400">Nenhum recorde ainda. O primeiro registro já conta.</p>
        ) : (
          <ol className="space-y-2">
            {linhas.map((l, i) => (
              <li
                key={l.chave}
                className={`flex items-center gap-3 rounded-cartao border-[1.5px] px-3 py-2.5 ${
                  l.viva ? `border-chama-500 ${SUAVE_DA_CHAMA}` : "border-transparent bg-ink-900"
                }`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-sm
                              font-extrabold tabular-nums ${
                                i < 3
                                  ? `border-[3px] ${MEDALHA[i] ?? ""} text-titulo`
                                  : "bg-ink-800 text-ink-400"
                              }`}
                >
                  <span className="sr-only">{i + 1}º lugar: </span>
                  <span aria-hidden="true">{i + 1}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-titulo">{l.valor}</span>
                  <span className="block text-miudo text-ink-400">{l.quando}</span>
                </span>
                {l.viva && (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold
                                text-chama-300 ${SUAVE_DA_CHAMA}`}
                  >
                    em andamento
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
