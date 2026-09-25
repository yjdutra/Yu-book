import { useQueryClient } from "@tanstack/react-query";
import { DEFINICOES_DO_ASSISTENTE } from "@yu-book/shared";
import type {
  NomeDoAssistente,
  RoutineRunDetail,
  RoutineRunStep,
  RotinaEvent,
} from "@yu-book/shared";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAiAjustes } from "../../lib/ia";
import { carregarCard } from "../../lib/kanban";
import { renderMarkdown } from "../../lib/markdown";
import {
  acompanharExecucao,
  chaveDaExecucao,
  invalidarDepoisDaExecucao,
  useCancelarExecucao,
  useExecucao,
} from "../../lib/rotinas";
import { emDolares } from "../ajustes/comum";
import { Aviso } from "../base/Aviso";
import { Botao, BotaoIcone } from "../base/Botao";
import { Dialogo } from "../base/Dialogo";
import {
  IconeAlerta,
  IconeBoard,
  IconeCheck,
  IconeChevron,
  IconeFala,
  IconeNotas,
  IconeParar,
  IconeRotina,
} from "../Icones";
import { ehDaWeb } from "../agentes/ferramentas";
import { Fontes } from "../assistente/Fontes";
import type { FonteDoAcervo } from "../assistente/Fontes";
import { ResumoDaPulada, textoDoGatilho } from "./Agenda";
import {
  duracao,
  duracaoEntre,
  GLIFO_MODO,
  NUMERO,
  Pulso,
  quando,
  passoCancelado,
  ROTULO_MODO,
  rotuloDoPasso,
  SeloPasso,
  SeloStatus,
  STATUS_DA_EXECUCAO,
} from "./comum";

/** Quantas vezes reassinar sozinho quando a conexão cai no meio. */
const REASSINATURAS = 5;

/**
 * O nome vem do servidor como texto: o `in` sobre `DEFINICOES_DO_ASSISTENTE`
 * — as duas origens, acervo e web (Etapa G) — é o que autoriza o cast. Sobre
 * só o acervo, `open_page` cairia no nome cru.
 */
function ehDoAssistente(nome: string): nome is NomeDoAssistente {
  return Object.hasOwn(DEFINICOES_DO_ASSISTENTE, nome);
}

function tituloDaFerramenta(nome: string): string {
  return ehDoAssistente(nome) ? DEFINICOES_DO_ASSISTENTE[nome].titulo : nome;
}

/**
 * Assina a execução e mantém o retrato ao vivo.
 *
 * Voltar à tela é assinar de novo: o servidor manda primeiro o **retrato** — o
 * gravado mais o texto parcial do passo em curso — e depois os eventos. A
 * conexão que cai no meio (rede, proxy) é refeita sozinha, algumas vezes,
 * enquanto a execução não terminou; ela segue no servidor de qualquer jeito.
 */
function useExecucaoAoVivo(runId: string) {
  const qc = useQueryClient();
  const [run, setRun] = useState<RoutineRunDetail | null>(null);
  const [parcial, setParcial] = useState<{ position: number; texto: string } | null>(null);
  const [ferramenta, setFerramenta] = useState<{ position: number; nome: string } | null>(null);
  const [erroDaExecucao, setErroDaExecucao] = useState<{ code: string; mensagem: string } | null>(
    null,
  );
  const [erroDeConexao, setErroDeConexao] = useState<ApiError | Error | null>(null);
  const [fala, setFala] = useState("");

  useEffect(() => {
    const controlador = new AbortController();
    let terminou = false;
    let total = 0;
    // O que já foi dito em voz alta: o status de cada passo e se o fim foi
    // anunciado. É o que deixa o `retrato` repetido anunciar só o que mudou.
    const anunciado = new Map<number, string>();
    let fimAnunciado = false;

    /**
     * O `retrato` pode chegar repetido, a cada ~2 s e sem `delta`, quando a
     * execução roda em outra instância da API (janela de deploy): ali ele é o
     * único sinal de avanço. Por isso ele **substitui** o estado — passos,
     * custo, parcial — em vez de somar, e fala só a diferença contra o que já
     * foi anunciado. Retrato igual ao anterior não muda nada na tela: nem o
     * leitor de tela repete, nem o foco sai do bloco escolhido (as chaves da
     * linha do tempo são a posição, estável).
     */
    function aoRetrato(novo: RoutineRunDetail, textoParcial: string | null) {
      total = novo.steps.length;
      terminou = novo.status !== "em_andamento";
      const primeiro = anunciado.size === 0 && !fimAnunciado;
      const falas: string[] = [];
      for (const s of novo.steps) {
        const rotulo = rotuloDoPasso(s);
        if (!primeiro && anunciado.get(s.position) !== rotulo) {
          if (s.status === "rodando") {
            falas.push(`Passo ${s.position + 1} de ${total}, ${s.agentName}, começou.`);
          } else if (s.status !== "pendente") {
            falas.push(`Passo ${s.position + 1} de ${total}, ${s.agentName}: ${rotulo}.`);
          }
        }
        anunciado.set(s.position, rotulo);
      }
      if (terminou && !fimAnunciado) {
        if (!primeiro) {
          falas.push(`Execução ${STATUS_DA_EXECUCAO[novo.status].rotulo}.`);
          invalidarDepoisDaExecucao(qc, novo.routineId);
        }
        fimAnunciado = true;
      }
      if (falas.length > 0) setFala(falas.join(" "));

      setRun((r) => (r && JSON.stringify(r) === JSON.stringify(novo) ? r : novo));
      setErroDeConexao(null);
      const rodando = novo.steps.find((s) => s.status === "rodando");
      setParcial((p) => {
        if (!rodando) return null;
        const texto = textoParcial ?? "";
        return p && p.position === rodando.position && p.texto === texto
          ? p
          : { position: rodando.position, texto };
      });
      // O retrato não sabe de consulta em curso; a de outro passo já acabou.
      setFerramenta((f) => (f && rodando && f.position === rodando.position ? f : null));
    }

    function aoEvento(ev: RotinaEvent) {
      switch (ev.tipo) {
        case "retrato":
          aoRetrato(ev.run, ev.parcial);
          break;
        case "passo-inicio":
          setRun((r) =>
            r
              ? {
                  ...r,
                  steps: r.steps.map((s) =>
                    s.position === ev.position
                      ? {
                          ...s,
                          status: "rodando",
                          agentName: ev.agentName,
                          modelId: ev.modelId,
                          startedAt: new Date().toISOString(),
                        }
                      : s,
                  ),
                }
              : r,
          );
          // Segunda camada contra o buffer do servidor: um `passo-inicio`
          // repetido para o passo em curso não apaga o texto que já chegou.
          setParcial((p) =>
            p && p.position === ev.position ? p : { position: ev.position, texto: "" },
          );
          setFerramenta(null);
          anunciado.set(ev.position, "rodando");
          setFala(`Passo ${ev.position + 1} de ${total}, ${ev.agentName}, começou.`);
          break;
        case "delta":
          setParcial((p) =>
            p && p.position === ev.position
              ? { position: p.position, texto: p.texto + ev.texto }
              : { position: ev.position, texto: ev.texto },
          );
          setFerramenta(null);
          break;
        case "ferramenta":
          // O texto até aqui era o preâmbulo da consulta; a resposta vem depois.
          setParcial({ position: ev.position, texto: "" });
          setFerramenta({ position: ev.position, nome: ev.nome });
          break;
        case "passo-fim":
          setRun((r) =>
            r
              ? {
                  ...r,
                  costMicros: ev.runCostMicros,
                  steps: r.steps.map((s) => (s.position === ev.step.position ? ev.step : s)),
                }
              : r,
          );
          setParcial(null);
          setFerramenta(null);
          anunciado.set(ev.step.position, rotuloDoPasso(ev.step));
          setFala(
            `Passo ${ev.step.position + 1} de ${total}, ${ev.step.agentName}: ` +
              `${rotuloDoPasso(ev.step)}.`,
          );
          break;
        case "fim":
          terminou = true;
          setRun((r) => (r ? { ...r, ...ev.run } : r));
          setParcial(null);
          setFerramenta(null);
          // O retrato — o repetido, ou o primeiro de uma execução já
          // terminada — pode ter visto o fim antes deste evento: não repete.
          if (!fimAnunciado) setFala(`Execução ${STATUS_DA_EXECUCAO[ev.run.status].rotulo}.`);
          fimAnunciado = true;
          invalidarDepoisDaExecucao(qc, ev.run.routineId);
          // Os passos que não rodaram viraram "pulado" no servidor: o retrato
          // final vem da consulta, não de uma dedução aqui.
          void qc
            .fetchQuery({
              queryKey: chaveDaExecucao(runId),
              queryFn: () => api.get<RoutineRunDetail>(`/ai/runs/${runId}`),
              staleTime: 0,
            })
            .then((detalhe) => {
              if (!controlador.signal.aborted) setRun(detalhe);
            })
            .catch(() => undefined);
          break;
        case "erro":
          setErroDaExecucao({ code: ev.code, mensagem: ev.mensagem });
          break;
      }
    }

    void (async () => {
      for (let tentativa = 0; tentativa <= REASSINATURAS; tentativa++) {
        try {
          await acompanharExecucao(runId, aoEvento, controlador.signal);
        } catch (e) {
          if (controlador.signal.aborted) return;
          // Id que não existe (ou de outra conta) não melhora esperando.
          if (e instanceof ApiError && e.status < 500) {
            setErroDeConexao(e);
            return;
          }
          setErroDeConexao(e instanceof Error ? e : new Error(String(e)));
        }
        if (terminou || controlador.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1)));
        if (controlador.signal.aborted) return;
      }
    })();

    return () => controlador.abort();
  }, [runId, qc]);

  return { run, parcial, ferramenta, erroDaExecucao, erroDeConexao, fala };
}

/** Um bloco da linha do tempo: o fluxo de novo, agora como estado. */
function BlocoDoTempo({
  titulo,
  rotulo,
  status,
  selecionado,
  onEscolher,
  nomeAcessivel,
  rodando = false,
  children,
}: {
  titulo: string;
  rotulo: ReactNode;
  status: ReactNode;
  selecionado?: boolean;
  onEscolher?: () => void;
  nomeAcessivel: string;
  rodando?: boolean;
  children?: ReactNode;
}) {
  const classe = `relative flex w-48 shrink-0 flex-col items-start gap-1.5 rounded-cartao border
    bg-superficie px-3 py-2.5 text-left transition duration-[160ms] ease-(--ease-padrao) ${
      selecionado
        ? "border-accent-400 shadow-e2 ring-2 ring-accent-400/60"
        : rodando
          ? "border-accent-500/60 shadow-brilho-ia"
          : "border-ink-800 shadow-e1"
    }`;
  const conteudo = (
    <>
      <span className="rotulo flex items-center gap-1.5">{rotulo}</span>
      <span className="line-clamp-2 text-sm font-medium text-titulo">{titulo}</span>
      {children}
      <span className="mt-auto pt-1">{status}</span>
    </>
  );
  return onEscolher ? (
    <button
      type="button"
      onClick={onEscolher}
      aria-pressed={selecionado}
      aria-label={nomeAcessivel}
      className={`${classe} hover:border-ink-700 hover:shadow-e2`}
    >
      {conteudo}
    </button>
  ) : (
    <div className={classe} aria-label={nomeAcessivel} role="group">
      {conteudo}
    </div>
  );
}

/** O traço entre dois blocos; aceso quando o que vem antes já passou. */
function Traco({ aceso }: { aceso: boolean }) {
  return (
    <svg
      viewBox="0 0 40 12"
      aria-hidden="true"
      className="h-3 w-10 shrink-0 self-center"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
    >
      <line
        x1="2"
        y1="6"
        x2="34"
        y2="6"
        className={aceso ? "stroke-accent-400" : "stroke-ink-700"}
        strokeDasharray={aceso ? undefined : "3 3"}
      />
      <path d="M30 2.5 35.5 6 30 9.5" className={aceso ? "stroke-accent-400" : "stroke-ink-700"} />
    </svg>
  );
}

function Medida({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-miudo text-ink-400">{rotulo}</dt>
      <dd className="truncate text-sm tabular-nums text-ink-200">{valor}</dd>
    </div>
  );
}

function DetalheDoPasso({
  passo,
  total,
  parcial,
  ferramenta,
  agora,
  onAbrirFonte,
}: {
  passo: RoutineRunStep;
  total: number;
  parcial: string | null;
  ferramenta: string | null;
  agora: number;
  onAbrirFonte: (f: FonteDoAcervo) => void;
}) {
  const rodando = passo.status === "rodando";
  const naWeb = ferramenta !== null && ehDoAssistente(ferramenta) && ehDaWeb(ferramenta);
  const texto = rodando ? (parcial ?? "") : passo.text;
  // Sanitizado por DOMPurify em renderMarkdown (INV-09): o texto veio do modelo.
  const html = useMemo(() => (texto ? renderMarkdown(texto) : ""), [texto]);
  const ms = rodando ? duracaoEntre(passo.startedAt, null, agora) : passo.durationMs;

  return (
    <section
      aria-labelledby="passo-em-foco"
      className="relative rounded-cartao border border-ink-800 bg-superficie shadow-e1"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
      />
      <header className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-3">
        <h3 id="passo-em-foco" className="text-sm font-semibold text-titulo">
          Passo {passo.position + 1} de {total} · {passo.agentName}
        </h3>
        <span
          className="inline-flex items-center gap-1 rounded-etiqueta border border-ink-700 px-1.5
                     text-miudo text-ink-400"
        >
          <span aria-hidden="true">{GLIFO_MODO[passo.mode]}</span>
          {ROTULO_MODO[passo.mode].curto}
        </span>
        <SeloPasso passo={passo} />
      </header>

      <dl className="grid grid-cols-4 gap-4 border-b border-ink-800 px-4 py-3">
        <Medida
          rotulo="Modelo"
          valor={
            <span className="font-mono text-xs" title={passo.modelUsed ?? passo.modelId ?? ""}>
              {passo.modelUsed ?? passo.modelId ?? "—"}
            </span>
          }
        />
        <Medida
          rotulo="Tokens (entrada · saída)"
          valor={
            passo.promptTokens || passo.completionTokens
              ? `${NUMERO.format(passo.promptTokens)} · ${NUMERO.format(passo.completionTokens)}`
              : "—"
          }
        />
        <Medida rotulo="Custo" valor={passo.costMicros ? emDolares(passo.costMicros) : "—"} />
        <Medida rotulo="Duração" valor={ms ? duracao(ms) : "—"} />
      </dl>

      <div className="px-4 py-3">
        <p className="rotulo mb-2">{passo.mode === "revisa" ? "Observações" : "Rascunho"}</p>
        {rodando && ferramenta && (
          <p className="mb-2 flex items-center gap-2 text-xs text-accent-400">
            <Pulso />
            {naWeb ? "Na web" : "Consultando o acervo"}: {tituloDaFerramenta(ferramenta)}
          </p>
        )}
        {rodando && !ferramenta && !texto && (
          <p className="flex items-center gap-2 text-xs text-ink-400">
            <Pulso />
            Esperando o modelo começar a escrever…
          </p>
        )}
        {html ? (
          <div
            className="preview max-h-[480px] overflow-y-auto text-sm"
            aria-busy={rodando || undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          !rodando && (
            <p className="text-xs text-ink-400">
              {passo.status === "pendente"
                ? "Ainda não rodou."
                : passo.status === "pulado"
                  ? "Não rodou: a execução parou antes deste passo."
                  : "Sem texto."}
            </p>
          )
        )}
        {rodando && texto && (
          <p className="mt-2 flex items-center gap-2 text-miudo text-ink-400">
            <Pulso />
            escrevendo…
          </p>
        )}
        {/* Etapa G: o que o passo consultou, gravado com ele. A da web é link
            externo; a do acervo abre pela casca, como no chat. */}
        <Fontes fontes={passo.sources} onAbrir={onAbrirFonte} className="mt-3" />
        {passoCancelado(passo) ? (
          <Aviso tom="info" className="mt-3">
            Este passo foi cancelado antes de terminar.
          </Aviso>
        ) : (
          passo.errorCode && (
            <Aviso tom="erro" className="mt-3">
              Este passo falhou ({passo.errorCode}).
            </Aviso>
          )
        )}
      </div>
    </section>
  );
}

/**
 * A execução ao vivo (Etapa E da IA): `/assistente/rotinas/:id/execucoes/:runId`
 * e `/assistente/execucoes/:runId` — a segunda é a do "Ver execução" da marca,
 * que conhece a execução e não a rotina (e a rotina pode já ter sido excluída).
 *
 * A linha do tempo repete o fluxo, agora como estado; embaixo, o passo em foco
 * com o texto chegando. Fechar a tela não para nada: a execução é do servidor.
 *
 * `onAbrirNota` é o `abrirNota` da casca (INV-55): a nota que a execução
 * deixou abre pelo mesmo caminho que as outras, e não por um `navigate` cru.
 */
export function ExecucaoRotina({
  runId,
  onAbrirNota,
}: {
  runId: string;
  onAbrirNota: (id: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const consulta = useExecucao(runId);
  const vivo = useExecucaoAoVivo(runId);
  const cancelar = useCancelarExecucao();
  const run = vivo.run ?? consulta.data ?? null;
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const titulo = useRef<HTMLHeadingElement>(null);
  const emAndamento = run?.status === "em_andamento";
  const fuso = useAiAjustes().data?.timezone ?? null;

  /// A fonte do acervo abre como no chat: a nota pela casca (INV-55), o
  /// quadro pela rota dele. Card não chega aqui — sem o quadro, não tem rota.
  function abrirFonte(fonte: FonteDoAcervo) {
    if (fonte.kind === "note") onAbrirNota(fonte.id);
    else if (fonte.kind === "board") navigate(`/b/${fonte.id}`);
  }

  // O relógio da duração anda só enquanto há o que medir.
  useEffect(() => {
    if (!emAndamento) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [emAndamento]);

  /// Terminar tira o "Cancelar" da tela. Se o foco estava nele — ou no diálogo
  /// que ele abriu —, cairia no `<body>`: vai para o título (RNF-06 da Fase 1).
  useEffect(() => {
    if (emAndamento || !run) return;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) titulo.current?.focus();
    });
  }, [emAndamento, run]);

  const naoAchou =
    (consulta.error instanceof ApiError && consulta.error.code === "NOT_FOUND") ||
    (vivo.erroDeConexao instanceof ApiError && vivo.erroDeConexao.code === "NOT_FOUND");

  if (naoAchou) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tom="erro">Esta execução não existe — ou não é sua.</Aviso>
        <Link to="/assistente/rotinas" className="text-sm text-accent-400 underline">
          Voltar às rotinas
        </Link>
      </div>
    );
  }

  if (!run) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-5">
        <div className="h-12 w-2/3 animate-pulse rounded-cartao bg-superficie" />
        <div className="h-20 animate-pulse rounded-cartao border border-ink-800 bg-superficie" />
        <div
          className="h-[132px] animate-pulse rounded-cartao border border-ink-800 bg-ink-900/40"
        />
        <div
          className="h-[320px] animate-pulse rounded-cartao border border-ink-800 bg-superficie"
        />
      </div>
    );
  }

  const passos = run.steps;
  const total = passos.length;
  const rodando = passos.find((s) => s.status === "rodando");
  const ultimoFeito = [...passos]
    .reverse()
    .find((s) => s.status === "concluido" || s.status === "falhou");
  const foco = passos.find((s) => s.position === escolhido) ?? rodando ?? ultimoFeito ?? passos[0];
  const concluidos = passos.filter((s) => s.status === "concluido").length;
  const msTotal = duracaoEntre(run.startedAt, run.endedAt, agora) ?? 0;
  const fracao = run.runCapMicros > 0 ? Math.min(run.costMicros / run.runCapMicros, 1) : 0;
  const voltar = run.routineId ? `/assistente/rotinas/${run.routineId}` : "/assistente/rotinas";
  const falhaTexto =
    vivo.erroDaExecucao?.mensagem ??
    (run.status === "falhou" || run.status === "interrompida" ? run.errorMessage : null);
  /// A ideia só existe na entrada por coluna: no pedido não há o que "ficar na
  /// entrada", e rodar de novo simplesmente refaz o pedido.
  const porColuna = run.inputKind === "coluna";
  const citado = run.inputTitle ? `«${run.inputTitle}»` : null;
  /// Concluída sem id de saída: o card ou a nota foi excluído depois — os ids
  /// voltam nulos, e a execução continua tendo criado alguma coisa.
  const saidaCriada = run.outputCardId
    ? "Card criado"
    : run.outputNoteId
      ? "Nota criada"
      : run.status === "concluida"
        ? "Saída excluída depois"
        : null;

  async function abrirCard() {
    if (!run?.outputCardId) return;
    setErroAcao(null);
    setAbrindo(true);
    try {
      const card = await carregarCard(qc, run.outputCardId);
      navigate(`/b/${card.boardId}/c/${card.id}`);
    } catch (e) {
      setErroAcao(
        e instanceof ApiError && e.code === "NOT_FOUND"
          ? "O card desta execução não existe mais."
          : "Não foi possível abrir o card.",
      );
    } finally {
      setAbrindo(false);
    }
  }

  async function confirmarCancelamento() {
    setErroAcao(null);
    try {
      await cancelar.mutateAsync(runId);
      setConfirmando(false);
    } catch (e) {
      setConfirmando(false);
      setErroAcao(e instanceof ApiError ? e.message : "Não foi possível cancelar a execução.");
    }
  }

  const cabecalho = (
    <header className="flex items-start gap-3">
      <BotaoIcone
        rotulo={run.routineId ? "Voltar à rotina" : "Voltar às rotinas"}
        icone={<IconeChevron direcao="esquerda" />}
        onClick={() => navigate(voltar)}
      />
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-cartao
                   bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-brilho-ia"
      >
        <IconeRotina className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2
          ref={titulo}
          tabIndex={-1}
          className="truncate text-xl font-semibold tracking-tight text-titulo"
        >
          {run.routineName}
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
          <SeloStatus status={run.status} />
          <span>
            {porColuna ? "Ideia" : "Pedido"}
            {citado && (
              <>
                {" "}
                <span className="text-ink-200">{citado}</span>
              </>
            )}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={run.startedAt}>{quando(run.startedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{textoDoGatilho(run, fuso)}</span>
          {!run.routineId && <span>· a rotina foi excluída</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {emAndamento && (
          <Botao
            variante="perigo"
            tamanho="m"
            icone={<IconeParar className="size-3.5" />}
            carregando={cancelar.isPending}
            onClick={() => setConfirmando(true)}
          >
            Cancelar
          </Botao>
        )}
        {run.outputCardId && (
          <Botao
            variante="ia"
            tamanho="m"
            icone={<IconeBoard className="size-4" />}
            carregando={abrindo}
            onClick={() => void abrirCard()}
          >
            Abrir card
          </Botao>
        )}
        {run.outputNoteId && (
          <Botao
            variante="ia"
            tamanho="m"
            icone={<IconeNotas className="size-4" />}
            onClick={() => run.outputNoteId && onAbrirNota(run.outputNoteId)}
          >
            Abrir nota
          </Botao>
        )}
      </div>
    </header>
  );

  /// A pulada não começou: não tem passo, custo nem saída. A tela é só o
  /// resumo — quando, quantas tentativas, por quê —, sem linha do tempo vazia.
  if (run.status === "pulada") {
    return (
      <div className="flex flex-col gap-5">
        {cabecalho}
        <ResumoDaPulada run={run} fuso={fuso} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {cabecalho}

      {/* A troca de passo e o fim são ditos em voz alta; o texto que chega, não —
          seria um leitor de tela lendo token por token. */}
      <p aria-live="polite" className="sr-only">
        {vivo.fala}
      </p>

      {falhaTexto && (
        <Aviso tom={run.status === "interrompida" ? "alerta" : "erro"}>
          {falhaTexto}
          {run.status !== "concluida" &&
            run.status !== "em_andamento" &&
            (porColuna ? (
              <> A ideia ficou na entrada — o próximo “Rodar agora” a pega de novo.</>
            ) : (
              <> Nada foi criado — o próximo “Rodar agora” refaz o pedido.</>
            ))}
        </Aviso>
      )}
      {run.status === "cancelada" && !falhaTexto && (
        <Aviso tom="info">
          {porColuna
            ? "Execução cancelada. A ideia ficou na entrada, e nada foi criado."
            : "Execução cancelada. Nada foi criado."}
        </Aviso>
      )}
      {vivo.erroDeConexao && emAndamento && (
        <Aviso tom="alerta">
          A conexão com o acompanhamento caiu; tentando de novo. A execução continua no
          servidor.
        </Aviso>
      )}
      {erroAcao && (
        <Aviso tom="erro" onFechar={() => setErroAcao(null)}>
          {erroAcao}
        </Aviso>
      )}

      <dl
        className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)] gap-4 rounded-cartao
                   border border-ink-800 bg-superficie px-4 py-3 shadow-e1"
      >
        <Medida rotulo="Duração" valor={duracao(msTotal)} />
        <Medida rotulo="Passos concluídos" valor={`${concluidos} de ${total}`} />
        <Medida rotulo="Terminou" valor={run.endedAt ? quando(run.endedAt) : "—"} />
        <div className="min-w-0">
          <dt className="flex items-baseline justify-between text-miudo text-ink-400">
            <span>Custo desta execução</span>
            <span className="tabular-nums">teto {emDolares(run.runCapMicros)}</span>
          </dt>
          <dd className="mt-1">
            <div
              role="meter"
              aria-label="Custo contra o teto da execução"
              aria-valuemin={0}
              aria-valuemax={run.runCapMicros}
              aria-valuenow={run.costMicros}
              aria-valuetext={`${emDolares(run.costMicros)} de ${emDolares(run.runCapMicros)}`}
              className="h-1.5 overflow-hidden rounded-full bg-ink-800"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-300
                            ease-(--ease-saida) ${
                  fracao >= 0.9 ? "bg-amber-400" : "bg-linear-to-r from-accent-500 to-ia-500"
                }`}
                style={{ width: `${Math.max(fracao * 100, run.costMicros > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="mt-1 text-sm tabular-nums text-ink-200">
              {emDolares(run.costMicros)}
              <span className="text-miudo text-ink-400">
                {" "}
                · {Math.round(fracao * 100)}% do teto
                {fracao >= 0.9 && " — perto do limite"}
              </span>
            </p>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="linha-do-tempo">
        <h3 id="linha-do-tempo" className="rotulo mb-2">
          Linha do tempo
        </h3>
        <div
          className="overflow-x-auto rounded-cartao border border-ink-800 bg-ink-900/40
                     [background-size:16px_16px]
                     bg-[radial-gradient(var(--color-ink-800)_1px,transparent_1px)]"
        >
          <ol className="flex w-max min-w-full items-stretch px-6 py-6">
            <li className="flex">
              <BlocoDoTempo
                nomeAcessivel={
                  porColuna
                    ? `Entrada: ideia ${citado ?? "sem título"}`
                    : `Pedido${citado ? `: ${citado}` : ""}`
                }
                rotulo={
                  porColuna ? (
                    <>
                      <IconeBoard className="size-3.5 text-accent-400" />
                      Entrada
                    </>
                  ) : (
                    <>
                      <IconeFala className="size-3.5 text-accent-400" />
                      Pedido
                    </>
                  )
                }
                titulo={citado ?? (porColuna ? "Ideia sem título" : "Pedido da rotina")}
                status={
                  <span className="inline-flex items-center gap-1 text-miudo text-ink-400">
                    <IconeCheck className="size-3" />
                    {porColuna ? "ideia escolhida" : "o pedido da rotina"}
                  </span>
                }
              />
            </li>
            {passos.map((s) => {
              const antes =
                s.position === 0 || passos[s.position - 1]?.status === "concluido";
              return (
                <Fragment key={s.position}>
                  <li aria-hidden="true" className="flex">
                    <Traco aceso={antes && s.status !== "pendente" && s.status !== "pulado"} />
                  </li>
                  <li className="flex">
                    <BlocoDoTempo
                      nomeAcessivel={`Passo ${s.position + 1} de ${total}: ${s.agentName}, ${
                        ROTULO_MODO[s.mode].curto
                      }, ${rotuloDoPasso(s)}. Ver o texto`}
                      selecionado={foco?.position === s.position}
                      rodando={s.status === "rodando"}
                      onEscolher={() => setEscolhido(s.position)}
                      rotulo={<>Passo {s.position + 1}</>}
                      titulo={s.agentName}
                      status={<SeloPasso passo={s} />}
                    >
                      <span className="inline-flex items-center gap-1 text-miudo text-ink-400">
                        <span aria-hidden="true">{GLIFO_MODO[s.mode]}</span>
                        {ROTULO_MODO[s.mode].curto}
                        {s.costMicros > 0 && <> · {emDolares(s.costMicros)}</>}
                      </span>
                    </BlocoDoTempo>
                  </li>
                </Fragment>
              );
            })}
            <li aria-hidden="true" className="flex">
              <Traco aceso={run.status === "concluida"} />
            </li>
            <li className="flex">
              <BlocoDoTempo
                nomeAcessivel={
                  saidaCriada
                    ? `Saída: ${saidaCriada.toLowerCase()}`
                    : emAndamento
                      ? "Saída: aguardando os passos"
                      : "Saída: nada criado"
                }
                rotulo={
                  <>
                    <IconeCheck className="size-3.5 text-accent-400" />
                    Saída
                  </>
                }
                titulo={saidaCriada ?? (emAndamento ? "Aguardando" : "Nada criado")}
                status={
                  saidaCriada ? (
                    <SeloStatus status="concluido" tipo="passo" />
                  ) : emAndamento ? (
                    <SeloStatus status="pendente" tipo="passo" />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-miudo text-ink-400">
                      <IconeAlerta className="size-3" />
                      {porColuna ? "a ideia ficou na entrada" : "nada foi criado"}
                    </span>
                  )
                }
              />
            </li>
          </ol>
        </div>
      </section>

      {foco && (
        <DetalheDoPasso
          passo={foco}
          total={total}
          parcial={vivo.parcial?.position === foco.position ? vivo.parcial.texto : null}
          ferramenta={
            vivo.ferramenta?.position === foco.position ? vivo.ferramenta.nome : null
          }
          agora={agora}
          onAbrirFonte={abrirFonte}
        />
      )}

      {confirmando && (
        <Dialogo aberto onFechar={() => setConfirmando(false)} rotulo="Cancelar a execução?">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <IconeAlerta className="size-4 text-amber-300" />
              <h2 className="text-sm font-semibold text-titulo">Cancelar a execução?</h2>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              O passo em curso para e os seguintes não rodam.{" "}
              {porColuna ? "A ideia fica na entrada, nada é criado" : "Nada é criado"} — e o que
              já foi gasto continua contando no dia.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Botao variante="secundario" onClick={() => setConfirmando(false)}>
                Continuar rodando
              </Botao>
              <Botao
                variante="perigo"
                carregando={cancelar.isPending}
                onClick={() => void confirmarCancelamento()}
              >
                Cancelar execução
              </Botao>
            </div>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
