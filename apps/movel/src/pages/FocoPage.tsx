import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Botao } from "@yu-book/cliente/base/Botao";
import { Dialogo } from "@yu-book/cliente/base/Dialogo";
import { useGravarFoco, useSessoesDeFoco } from "@yu-book/cliente/focoDoRitmo";
import { useHabitos } from "@yu-book/cliente/habitos";
import {
  IconeCheck,
  IconeChevron,
  IconeCronometro,
  IconeAjustes,
  IconeFechar,
  IconeMais,
  IconePausar,
  IconePular,
  IconeRecomecar,
  IconeRodar,
} from "@yu-book/cliente/icones";
import { AnelProgresso } from "@yu-book/cliente/ritmo/AnelProgresso";
import {
  MAX_MINUTOS_DO_FOCO,
  MINUTOS_DO_POMODORO,
  MODOS_DO_FOCO,
  POMODOROS_DO_CICLO,
  pontosDoFoco,
} from "@yu-book/shared";
import type { FocusSessionResult, HabitItem, ModoDoFoco } from "@yu-book/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alca } from "../components/Alca";
import { useFolhaNoHistorico } from "../lib/historico";

/// O pomodoro em curso fica no aparelho (RF-54): recarregar ou a aba dormir não
/// perdem o tempo, porque o que se guarda é o instante final.
const CHAVE = "yb-foco";

interface Estado {
  modo: ModoDoFoco;
  /** A duração deste período, fixada quando ele nasce; vai no `minutes`. */
  minutos: number;
  /** Instante final (ms) com o timer rodando; `null` parado. */
  fim: number | null;
  /** O que falta, em ms, com o timer parado. */
  restante: number;
  /** O início do foco (ISO), da primeira vez que ele rodou; vai no `startedAt`. */
  inicio: string | null;
  /** O id que torna a gravação idempotente (RF-56); um por foco. */
  clientId: string;
  atividade: string | null;
}

type Tempos = Record<ModoDoFoco, number>;

/// O tempo de cada modo, ajustável e lembrado no aparelho (`yb-foco-tempos`):
/// o passo e os limites de cada um, e o padrão de `MODOS_DO_FOCO`.
const CHAVE_TEMPOS = "yb-foco-tempos";
const AJUSTE: Record<ModoDoFoco, { passo: number; min: number; max: number }> = {
  foco: { passo: 5, min: 5, max: MAX_MINUTOS_DO_FOCO },
  pausa: { passo: 1, min: 1, max: 30 },
  pausaLonga: { passo: 5, min: 5, max: 60 },
};
const PADRAO = Object.fromEntries(MODOS_DO_FOCO.map((m) => [m.key, m.minutes])) as Tempos;

const nomeDe = (modo: ModoDoFoco) => MODOS_DO_FOCO.find((m) => m.key === modo)?.name ?? "";

function limitar(modo: ModoDoFoco, minutos: number): number {
  const { min, max } = AJUSTE[modo];
  return Number.isInteger(minutos) ? Math.min(max, Math.max(min, minutos)) : PADRAO[modo];
}

function carregarTempos(): Tempos {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_TEMPOS) ?? "{}") as Partial<Tempos>;
    return {
      foco: limitar("foco", bruto.foco ?? PADRAO.foco),
      pausa: limitar("pausa", bruto.pausa ?? PADRAO.pausa),
      pausaLonga: limitar("pausaLonga", bruto.pausaLonga ?? PADRAO.pausaLonga),
    };
  } catch {
    return PADRAO;
  }
}

function guardarTempos(t: Tempos): void {
  try {
    localStorage.setItem(CHAVE_TEMPOS, JSON.stringify(t));
  } catch {
    // Sem armazenamento: o ajuste vale enquanto a tela está aberta.
  }
}

function novo(modo: ModoDoFoco, atividade: string | null, minutos: number): Estado {
  return {
    modo,
    minutos,
    fim: null,
    restante: minutos * 60_000,
    inicio: null,
    clientId: crypto.randomUUID(),
    atividade,
  };
}

/// Ler e gravar o aparelho pode falhar (janela privada, armazenamento cheio):
/// aí o timer vale só enquanto a tela está aberta.
function carregar(): Estado | null {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const e = bruto ? (JSON.parse(bruto) as Estado) : null;
    if (!e || !MODOS_DO_FOCO.some((m) => m.key === e.modo) || !e.clientId) return null;
    // Um foco guardado antes do tempo ajustável não tem `minutos`.
    return { ...e, minutos: e.minutos ?? PADRAO[e.modo] };
  } catch {
    return null;
  }
}

function guardar(e: Estado): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(e));
  } catch {
    // Sem armazenamento: o timer segue na memória.
  }
}

/**
 * A tela acesa enquanto o foco roda (RF-54), quando o navegador tem a Wake
 * Lock API. O sistema solta a trava quando a aba some; ao voltar, pede de novo.
 */
function useTelaAcesa(ativo: boolean): boolean {
  const [acesa, setAcesa] = useState(false);
  useEffect(() => {
    if (!ativo || !("wakeLock" in navigator)) return;
    let trava: WakeLockSentinel | null = null;
    let vivo = true;
    const pedir = () => {
      navigator.wakeLock
        .request("screen")
        .then((t) => {
          if (!vivo) return void t.release();
          trava = t;
          setAcesa(true);
          t.addEventListener("release", () => setAcesa(false));
        })
        .catch(() => setAcesa(false));
    };
    const aoVoltar = () => {
      if (document.visibilityState === "visible") pedir();
    };
    pedir();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      void trava?.release();
      setAcesa(false);
    };
  }, [ativo]);
  return acesa;
}

/// O halo atrás do anel, no tom do modo (o acento no foco, o sucesso na pausa).
const HALO =
  "radial-gradient(120% 70% at 50% 30%, " +
  "color-mix(in srgb, var(--tom) 22%, transparent) 0%, transparent 62%)";

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const relogio = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${doisDigitos(Math.floor(s / 60))}:${doisDigitos(s % 60)}`;
};

/**
 * O foco (frente Ritmo, Ritmo 6 — RF-54 a RF-59): tela cheia, sem a barra
 * (RNF-20). O timer roda aqui, e a fonte de verdade é o instante final, não o
 * tique (RNF-19). Só o foco concluído vai à API (RN-35).
 */
export function FocoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const habitos = useHabitos();
  const sessoes = useSessoesDeFoco();
  const gravar = useGravarFoco();
  const [tempos, setTempos] = useState<Tempos>(carregarTempos);
  const [estado, setEstado] = useState<Estado>(() => {
    const salvo = carregar();
    // `?livre` é o atalho do pomodoro genérico: abre sem atividade.
    const livre = params.has("livre");
    const daUrl = params.get("atividade");
    // A atividade da URL vale para um foco que ainda não começou.
    if (salvo && (salvo.inicio || (!daUrl && !livre))) return salvo;
    return novo("foco", livre ? null : (daUrl ?? salvo?.atividade ?? null), tempos.foco);
  });
  const [ajustando, setAjustando] = useState(false);
  const [agora, setAgora] = useState(Date.now);
  const [escolhendo, setEscolhendo] = useState(false);
  const [concluido, setConcluido] = useState<FocusSessionResult | null>(null);
  const [falha, setFalha] = useState<Estado | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const concluindo = useRef(false);

  const rodando = estado.fim !== null;
  const restante = rodando ? Math.max(0, (estado.fim ?? 0) - agora) : estado.restante;
  const total = estado.minutos * 60_000;
  const foco = estado.modo === "foco";
  const acesa = useTelaAcesa(rodando);

  useEffect(() => guardar(estado), [estado]);
  useEffect(() => guardarTempos(tempos), [tempos]);

  // O tique só redesenha: o restante sai de `fim − agora` (RNF-19).
  useEffect(() => {
    if (!rodando) return;
    const id = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(id);
  }, [rodando]);

  const atividades = (habitos.data ?? []).flatMap((h: HabitItem) =>
    h.activities.filter((a) => !a.archived).map((a) => ({ ...a, habito: h })),
  );
  const atividade = atividades.find((a) => a.id === estado.atividade) ?? null;
  const feitosHoje = sessoes.data?.length ?? 0;
  const noCiclo = feitosHoje % POMODOROS_DO_CICLO;

  const enviar = useCallback(
    (alvo: Estado) => {
      setFalha(null);
      gravar
        .mutateAsync({
          clientId: alvo.clientId,
          activityId: alvo.atividade,
          minutes: alvo.minutos,
          startedAt: alvo.inicio ?? new Date(Date.now() - alvo.minutos * 60_000).toISOString(),
        })
        .then((resultado) => {
          setConcluido(resultado);
          setAnuncio("Pomodoro concluído.");
        })
        .catch(() => setFalha(alvo));
    },
    [gravar.mutateAsync],
  );

  // O fim do tempo, visto no tique ou na volta da aba: conclui uma vez só.
  useEffect(() => {
    if (!rodando || restante > 0 || concluindo.current) return;
    concluindo.current = true;
    const terminado = estado;
    if (terminado.modo === "foco") {
      setEstado(novo("foco", terminado.atividade, tempos.foco));
      enviar(terminado);
    } else {
      setEstado(novo("foco", terminado.atividade, tempos.foco));
      setAnuncio("Pausa encerrada. Pronto para o próximo foco.");
    }
    concluindo.current = false;
  }, [rodando, restante, estado, enviar, tempos.foco]);

  function alternar() {
    const t = Date.now();
    setAgora(t);
    if (rodando) {
      setEstado((e) => ({ ...e, fim: null, restante: Math.max(0, (e.fim ?? t) - t) }));
      setAnuncio("Pausado.");
    } else {
      setEstado((e) => ({
        ...e,
        fim: t + e.restante,
        inicio: e.modo === "foco" ? (e.inicio ?? new Date(t).toISOString()) : e.inicio,
      }));
      setAnuncio(foco ? "Foco iniciado." : "Pausa iniciada.");
    }
  }

  function trocarModo(modo: ModoDoFoco) {
    setEstado((e) => novo(modo, e.atividade, tempos[modo]));
    setAnuncio(`${nomeDe(modo)} de ${tempos[modo]} min, pronto para começar.`);
  }

  /// Ajustar vale para os próximos períodos; o atual só muda se ainda não
  /// começou — um foco em curso mantém o tempo com que nasceu.
  function ajustar(modo: ModoDoFoco, delta: number) {
    const minutos = limitar(modo, tempos[modo] + delta);
    setTempos((t) => ({ ...t, [modo]: minutos }));
    setEstado((e) =>
      e.modo === modo && !e.fim && !e.inicio && e.restante === e.minutos * 60_000
        ? { ...e, minutos, restante: minutos * 60_000 }
        : e,
    );
  }

  const pausaLonga = feitosHoje > 0 && feitosHoje % POMODOROS_DO_CICLO === 0;

  function comecarPausa() {
    const modo = pausaLonga ? "pausaLonga" : "pausa";
    const pausa = novo(modo, estado.atividade, tempos[modo]);
    const t = Date.now();
    setAgora(t);
    setEstado({ ...pausa, fim: t + pausa.restante });
    setConcluido(null);
  }

  const fecharEscolha = useCallback(() => setEscolhendo(false), []);
  const fecharConcluido = useCallback(() => setConcluido(null), []);
  const fecharAjuste = useCallback(() => setAjustando(false), []);
  useFolhaNoHistorico(escolhendo, fecharEscolha);
  useFolhaNoHistorico(ajustando, fecharAjuste);
  useFolhaNoHistorico(concluido !== null, fecharConcluido);

  const status = rodando
    ? foco
      ? "uma coisa de cada vez"
      : "respire"
    : restante === total
      ? "pronto para começar"
      : "pausado";
  const tom = foco ? "[--tom:var(--color-accent-500)]" : "[--tom:var(--color-sucesso-500)]";

  return (
    <div
      className={`${tom} relative isolate flex min-h-dvh flex-col lg:pl-28`}
      style={{ background: HALO }}
    >
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5
                   pb-[calc(env(safe-area-inset-bottom)+1.5rem)]
                   pt-[calc(env(safe-area-inset-top)+1.25rem)]"
      >
        <header className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
            aria-label="Sair do foco"
            className="grid size-11 place-items-center rounded-cartao bg-ink-800 text-ink-200"
          >
            <IconeChevron direcao="esquerda" className="size-5" />
          </button>
          {acesa && (
            <span className="rounded-full bg-ink-800 px-3 py-1 text-xs font-semibold text-ink-200">
              Tela acesa
            </span>
          )}
          <button
            type="button"
            onClick={() => setAjustando(true)}
            aria-haspopup="dialog"
            aria-label="Ajustar tempos"
            className="grid size-11 place-items-center rounded-cartao bg-ink-800 text-ink-200"
          >
            <IconeAjustes className="size-5" />
          </button>
        </header>

        <div
          role="group"
          aria-label="Modo"
          className="grid grid-cols-3 gap-1 rounded-cartao bg-ink-900 p-1"
        >
          {MODOS_DO_FOCO.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={estado.modo === m.key}
              onClick={() => trocarModo(m.key)}
              className={`min-h-11 rounded-controle text-[0.8125rem] transition-colors ${
                estado.modo === m.key
                  ? "bg-superficie font-semibold text-titulo shadow-e1"
                  : "font-medium text-ink-400 hover:text-ink-200"
              }`}
            >
              {/* Na aba, "Longa": "Pausa longa 15" não cabe num terço de 375 px. */}
              {m.key === "pausaLonga" ? "Longa" : m.name} {tempos[m.key]}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-5">
          <AnelProgresso
            valor={restante}
            total={total}
            tamanho={264}
            espessura={14}
            rotulo={`${foco ? "Foco" : "Pausa"}: faltam ${relogio(restante)}`}
          >
            <span className="flex flex-col items-center gap-1.5">
              <span className="rotulo">{foco ? "Foco" : "Pausa"}</span>
              <span
                role="timer"
                aria-live="off"
                className="text-6xl font-extrabold leading-none tracking-tighter tabular-nums
                           text-titulo"
              >
                {relogio(restante)}
              </span>
              <span className="text-xs text-ink-400">{status}</span>
            </span>
          </AnelProgresso>

          <ul
            aria-label={`${noCiclo} de ${POMODOROS_DO_CICLO} pomodoros neste ciclo`}
            className="flex items-center gap-2.5"
          >
            {Array.from({ length: POMODOROS_DO_CICLO }, (_, i) => (
              <li
                key={i}
                aria-hidden="true"
                className={`h-2.5 rounded-full transition-all ${
                  i < noCiclo
                    ? "w-5.5 bg-chama-500"
                    : i === noCiclo && rodando && foco
                      ? "w-8.5 bg-(--tom)"
                      : "w-5.5 bg-ink-800"
                }`}
              />
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setEscolhendo(true)}
            aria-haspopup="dialog"
            disabled={rodando}
            className="flex w-full items-center gap-3 rounded-dialogo border border-ink-800/70
                       bg-superficie px-3.5 py-3 text-left shadow-e1 disabled:opacity-70"
          >
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-cartao bg-accent-500/15
                         text-accent-400"
            >
              <IconeCronometro className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold text-titulo">
                {atividade ? atividade.name : "Sem atividade"}
              </span>
              <span className="block truncate text-miudo text-ink-400">
                {atividade
                  ? `${atividade.habito.name} · ${
                      atividade.pointsPerPomodoro
                        ? `${tempos.foco} min valem +${pontosDoFoco(
                            atividade.pointsPerPomodoro,
                            tempos.foco,
                          )}`
                        : "não pontua por pomodoro"
                    }`
                  : "foco livre, sem pontos"}
              </span>
            </span>
            {!rodando && <IconeChevron direcao="direita" className="size-4 text-ink-400" />}
          </button>
        </div>

        {falha && (
          <Aviso tom="erro">
            O pomodoro terminou, mas não deu para gravá-lo.{" "}
            <button type="button" className="underline" onClick={() => enviar(falha)}>
              Tentar de novo
            </button>
          </Aviso>
        )}

        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => trocarModo(estado.modo)}
            aria-label="Recomeçar"
            className="grid size-14 place-items-center rounded-full bg-ink-800 text-ink-200"
          >
            <IconeRecomecar className="size-6" />
          </button>
          <button
            type="button"
            onClick={alternar}
            aria-label={rodando ? "Pausar" : "Iniciar"}
            className="grid size-21 place-items-center rounded-full bg-(--tom) text-white
                       shadow-[0_6px_0_0_color-mix(in_srgb,var(--tom)_70%,black)] transition
                       active:translate-y-0.5"
          >
            {rodando ? <IconePausar className="size-8" /> : <IconeRodar className="size-8" />}
          </button>
          {/* Só a pausa se pula: o foco antes do tempo não vale (RN-36). */}
          <button
            type="button"
            onClick={() => trocarModo("foco")}
            aria-label="Pular a pausa"
            disabled={foco}
            className="grid size-14 place-items-center rounded-full bg-ink-800 text-ink-200
                       disabled:invisible"
          >
            <IconePular className="size-6" />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {anuncio}
        </p>
      </div>

      <Dialogo
        aberto={escolhendo}
        onFechar={fecharEscolha}
        rotulo="Escolher a atividade"
        posicao="folha"
        largura="max-w-lg"
      >
        <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
          <Alca />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-titulo">Focar em</h2>
            <button
              type="button"
              onClick={fecharEscolha}
              aria-label="Fechar"
              className="grid size-11 place-items-center rounded-full text-ink-400 hover:bg-ink-800"
            >
              <IconeFechar className="size-5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {[null, ...atividades].map((a) => {
              const escolhida = (a?.id ?? null) === estado.atividade;
              return (
                <li key={a?.id ?? "livre"}>
                  <button
                    type="button"
                    aria-pressed={escolhida}
                    onClick={() => {
                      setEstado((e) => ({ ...e, atividade: a?.id ?? null }));
                      fecharEscolha();
                    }}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-cartao px-3
                                text-left ${escolhida ? "bg-accent-500/15" : "bg-ink-900"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-titulo">
                        {a ? a.name : "Sem atividade"}
                      </span>
                      <span className="block text-miudo text-ink-400">
                        {a
                          ? a.habito.name +
                            (a.pointsPerPomodoro
                              ? ` · +${a.pointsPerPomodoro} a cada ${MINUTOS_DO_POMODORO} min`
                              : "")
                          : "foco livre, sem pontos"}
                      </span>
                    </span>
                    {escolhida && <IconeCheck className="size-4 text-accent-400" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Dialogo>

      <Dialogo
        aberto={ajustando}
        onFechar={fecharAjuste}
        rotulo="Ajustar tempos"
        posicao="folha"
        largura="max-w-lg"
      >
        <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
          <Alca />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-titulo">Tempos</h2>
            <button
              type="button"
              onClick={fecharAjuste}
              aria-label="Fechar"
              className="grid size-11 place-items-center rounded-full text-ink-400 hover:bg-ink-800"
            >
              <IconeFechar className="size-5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {MODOS_DO_FOCO.map((m) => {
              const { passo, min, max } = AJUSTE[m.key];
              const valor = tempos[m.key];
              return (
                <li
                  key={m.key}
                  className="flex min-h-14 items-center gap-3 rounded-cartao bg-ink-900 pl-3.5 pr-1.5"
                >
                  <span className="min-w-0 flex-1 font-semibold text-titulo">{m.name}</span>
                  <button
                    type="button"
                    onClick={() => ajustar(m.key, -passo)}
                    disabled={valor <= min}
                    aria-label={`Menos ${passo} min de ${m.name.toLowerCase()}`}
                    className="grid size-11 place-items-center rounded-full bg-ink-800 text-xl
                               font-semibold text-ink-200 disabled:opacity-40"
                  >
                    −
                  </button>
                  <output
                    aria-live="polite"
                    className="w-18 whitespace-nowrap text-center text-lg font-bold tabular-nums
                               text-titulo"
                  >
                    {valor} min
                  </output>
                  <button
                    type="button"
                    onClick={() => ajustar(m.key, passo)}
                    disabled={valor >= max}
                    aria-label={`Mais ${passo} min de ${m.name.toLowerCase()}`}
                    className="grid size-11 place-items-center rounded-full bg-ink-800 text-ink-200
                               disabled:opacity-40"
                  >
                    <IconeMais className="size-5" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-miudo text-ink-400">
            Os pontos por pomodoro valem a cada {MINUTOS_DO_POMODORO} min de foco, proporcionais.
            O foco que já começou mantém o tempo dele.
          </p>
          <Botao
            variante="fantasma"
            tamanho="g"
            onClick={() => {
              setTempos(PADRAO);
              setEstado((e) =>
                !e.fim && !e.inicio && e.restante === e.minutos * 60_000
                  ? novo(e.modo, e.atividade, PADRAO[e.modo])
                  : e,
              );
            }}
            className="w-full"
          >
            Voltar ao padrão 25 · 5 · 15
          </Botao>
        </div>
      </Dialogo>

      <Dialogo
        aberto={concluido !== null}
        onFechar={fecharConcluido}
        rotulo="Pomodoro concluído"
        posicao="folha"
        largura="max-w-md"
      >
        {concluido && (
          <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-3 text-center">
            <Alca />
            <span
              aria-hidden="true"
              className="mt-2 grid size-20 place-items-center rounded-[26px] bg-chama-600 text-white
                         shadow-[0_5px_0_0_rgb(0_0_0/0.25)]"
            >
              <IconeCheck className="size-10" />
            </span>
            <h2 className="text-2xl font-extrabold text-titulo">
              Pomodoro {(feitosHoje % POMODOROS_DO_CICLO) || POMODOROS_DO_CICLO} de{" "}
              {POMODOROS_DO_CICLO}
            </h2>
            <p className="text-sm text-ink-400">
              {concluido.entry
                ? `+${concluido.entry.points} em ${atividade?.habito.name ?? "seu hábito"}. `
                : ""}
              Faça a pausa de verdade: levante, beba água, olhe longe.
            </p>
            <p className="flex flex-wrap justify-center gap-2">
              {concluido.entry && (
                <span
                  className="rounded-full bg-ouro-500/14 px-2.5 py-0.5 text-xs font-bold
                             text-ouro-300"
                >
                  +{concluido.entry.points} pts
                </span>
              )}
              <span
                className="rounded-full bg-chama-500/15 px-2.5 py-0.5 text-xs font-semibold
                           text-chama-300"
              >
                {concluido.session.minutes} min focado
              </span>
            </p>
            <Botao variante="primario" tamanho="g" onClick={comecarPausa} className="mt-1 w-full">
              Começar pausa de {tempos[pausaLonga ? "pausaLonga" : "pausa"]} min
            </Botao>
            <Botao variante="fantasma" tamanho="g" onClick={fecharConcluido} className="w-full">
              Agora não
            </Botao>
          </div>
        )}
      </Dialogo>
    </div>
  );
}
