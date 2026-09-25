import { MODELOS_DE_AGENTE, MODELOS_DE_ROTINA, resumoDoPedido } from "@yu-book/shared";
import type {
  ModeloDeRotina,
  RoutineInputRef,
  RoutineOutputRef,
  RoutineSummary,
} from "@yu-book/shared";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useAiAjustes } from "../../lib/ia";
import { useAlternarAgenda, useExcluirRotina, useRotinas } from "../../lib/rotinas";
import { emDolares } from "../ajustes/comum";
import { Aviso } from "../base/Aviso";
import { Botao } from "../base/Botao";
import { Dialogo } from "../base/Dialogo";
import { Menu } from "../base/Menu";
import {
  IconeAlerta,
  IconeLapis,
  IconeLixeira,
  IconeMais,
  IconeOpcoes,
  IconeParar,
  IconeRelogio,
  IconeRodar,
  IconeRotina,
} from "../Icones";
import { SeloAgenda, temAgenda } from "./Agenda";
import { quando, SeloStatus } from "./comum";
import { MiniaturaFluxo } from "./MiniaturaFluxo";
import type { EntradaDaMiniatura, SaidaDaMiniatura } from "./MiniaturaFluxo";
import { AvisoAoRodar, rotaDaExecucao, useRodar } from "./rodar";

/** A altura do cartão e do esqueleto — a mesma, para a chegada não empurrar nada. */
const ALTURA_CARTAO = "min-h-[196px]";

const nomeDaColuna = (c: { columnName: string | null }) => c.columnName ?? "(coluna excluída)";

const entradaDaMiniatura = (e: RoutineInputRef): EntradaDaMiniatura =>
  e.kind === "coluna" ? { kind: "coluna", nome: nomeDaColuna(e) } : e;

/** Id com nome nulo é workspace excluído — a rotina já aparece como inválida. */
const saidaDaMiniatura = (s: RoutineOutputRef): SaidaDaMiniatura =>
  s.kind === "card"
    ? { kind: "card", nome: nomeDaColuna(s) }
    : {
        kind: "nota",
        workspace: s.workspaceId ? (s.workspaceName ?? "(workspace excluído)") : null,
      };

function CartaoRotina({
  rotina,
  rodando,
  outraRodando,
  onRodar,
  onExcluir,
  fuso,
  onAlternarAgenda,
}: {
  rotina: RoutineSummary;
  rodando: boolean;
  outraRodando: boolean;
  onRodar: () => void;
  onExcluir: () => void;
  fuso: string | null;
  onAlternarAgenda: () => void;
}) {
  const navigate = useNavigate();
  const ultima = rotina.lastRun;
  const emAndamento = ultima?.status === "em_andamento";
  /// O motivo fica escrito, e não só na dica: botão desabilitado sem porquê
  /// é um beco.
  const motivo = !rotina.valid
    ? "Precisa de ajustes antes de rodar"
    : outraRodando
      ? "Outra rotina está rodando"
      : null;

  return (
    <article
      aria-labelledby={`rotina-${rotina.id}`}
      className={`group relative flex flex-col rounded-cartao border border-ink-800 bg-superficie
                  p-4 shadow-e1 transition duration-[160ms] ease-(--ease-padrao)
                  hover:border-ink-700 hover:shadow-e2 ${ALTURA_CARTAO}`}
    >
      {emAndamento && (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
        />
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`rotina-${rotina.id}`} className="truncate text-sm font-semibold text-titulo">
            <Link
              to={`/assistente/rotinas/${rotina.id}`}
              className="rounded-etiqueta hover:text-accent-400"
              title="Editar a rotina"
            >
              {rotina.name}
            </Link>
          </h3>
          <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">
            {rotina.description || "Sem descrição."}
          </p>
        </div>
        <Menu
          rotulo={`Ações de ${rotina.name}`}
          lado="baixo-fim"
          gatilho={(p) => (
            <button
              {...p}
              type="button"
              aria-label={`Ações de ${rotina.name}`}
              title="Ações"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-controle
                         text-ink-400 transition hover:bg-ink-800 hover:text-ink-200"
            >
              <IconeOpcoes />
            </button>
          )}
          itens={[
            {
              rotulo: "Editar",
              icone: <IconeLapis className="size-3.5" />,
              aoEscolher: () => navigate(`/assistente/rotinas/${rotina.id}`),
            },
            // Pausar e retomar na hora, sem abrir o editor (Etapa F). Sem dias e
            // horários gravados não há o que pausar: agendar é no editor.
            ...(temAgenda(rotina.schedule)
              ? [
                  {
                    rotulo: rotina.schedule.active ? "Pausar agenda" : "Retomar agenda",
                    icone: rotina.schedule.active ? (
                      <IconeParar className="size-3.5" />
                    ) : (
                      <IconeRelogio className="size-3.5" />
                    ),
                    aoEscolher: onAlternarAgenda,
                  },
                ]
              : []),
            {
              rotulo: "Excluir",
              icone: <IconeLixeira className="size-3.5" />,
              aoEscolher: onExcluir,
              desabilitado: emAndamento,
              motivo: "Espere a execução em andamento terminar",
            },
          ]}
        />
      </div>

      <div className="mt-3">
        <MiniaturaFluxo
          entrada={entradaDaMiniatura(rotina.input)}
          saida={saidaDaMiniatura(rotina.output)}
          passos={rotina.steps.map((p) => ({
            nome: p.agentName,
            cor: p.agentId ? p.agentColor : null,
            mode: p.mode,
          }))}
        />
      </div>

      {temAgenda(rotina.schedule) && (
        <div className="mt-3 flex min-w-0">
          <SeloAgenda rotina={rotina} fuso={fuso} />
        </div>
      )}

      <div
        className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-miudo
                   text-ink-400"
      >
        {ultima ? (
          <>
            <SeloStatus status={ultima.status} />
            <span>
              {quando(ultima.startedAt)}
              {ultima.trigger === "agenda" && " · agendada"}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{emDolares(ultima.costMicros)}</span>
            {ultima.inputTitle && (
              <span className="min-w-0 truncate" title={ultima.inputTitle}>
                · «{ultima.inputTitle}»
              </span>
            )}
          </>
        ) : (
          <span className="text-ink-400/80">Nunca rodou</span>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {emAndamento && ultima ? (
          <Botao
            variante="ia"
            icone={<IconeRotina className="size-3.5" />}
            onClick={() => navigate(rotaDaExecucao(rotina.id, ultima.id))}
            aria-label={`Acompanhar a execução de ${rotina.name}`}
          >
            Acompanhar
          </Botao>
        ) : (
          <Botao
            variante="ia"
            icone={<IconeRodar className="size-3.5" />}
            carregando={rodando}
            disabled={Boolean(motivo)}
            onClick={onRodar}
            aria-label={`Rodar ${rotina.name} agora`}
            aria-describedby={motivo ? `motivo-${rotina.id}` : undefined}
          >
            Rodar agora
          </Botao>
        )}
        <Link
          to={`/assistente/rotinas/${rotina.id}`}
          className="rounded-controle px-2 py-1 text-xs text-ink-400 transition
                     hover:bg-ink-800 hover:text-ink-200"
          aria-label={`Editar ${rotina.name}`}
        >
          Editar
        </Link>
        {motivo && !emAndamento && (
          <span
            id={`motivo-${rotina.id}`}
            className={`flex items-center gap-1 text-miudo ${
              rotina.valid ? "text-ink-400" : "text-amber-300"
            }`}
          >
            {!rotina.valid && <IconeAlerta className="size-3" />}
            {motivo}
          </span>
        )}
      </div>
    </article>
  );
}

function EsqueletoCartao() {
  return (
    <div
      aria-hidden="true"
      className={`rounded-cartao border border-ink-800 bg-superficie p-4 shadow-e1
                  ${ALTURA_CARTAO}`}
    >
      <div className="h-4 w-1/2 animate-pulse rounded-etiqueta bg-ink-800" />
      <div className="mt-2 h-3 w-5/6 animate-pulse rounded-etiqueta bg-ink-800" />
      <div className="mt-4 h-6 w-4/5 animate-pulse rounded-etiqueta bg-ink-800" />
      <div className="mt-3 h-5 w-40 animate-pulse rounded-etiqueta bg-ink-800" />
      <div className="mt-6 h-7 w-28 animate-pulse rounded-controle bg-ink-800" />
    </div>
  );
}

/**
 * Um modelo pronto: ponto de partida, não rotina — nada é criado até salvar.
 * Os agentes aparecem pelo nome do modelo de agente de onde saem; o editor
 * casa cada um com o agente que você já tem.
 */
function CartaoModeloPronto({ m, destaque }: { m: ModeloDeRotina; destaque: boolean }) {
  const navigate = useNavigate();
  return (
    <article
      aria-labelledby={`modelo-rotina-${m.chave}`}
      className={`relative flex flex-col overflow-hidden rounded-cartao border
                  bg-superficie p-4 transition duration-[160ms] ease-(--ease-padrao)
                  hover:shadow-e2 ${
                    destaque ? "border-ink-700 shadow-e1" : "border-dashed border-ink-700"
                  }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
      />
      <h3 id={`modelo-rotina-${m.chave}`} className="text-sm font-semibold text-titulo">
        {m.name}
      </h3>
      <p className="mt-0.5 text-xs text-ink-400">{m.description}</p>
      <div className="mt-3">
        <MiniaturaFluxo
          entrada={
            m.inputKind === "coluna"
              ? { kind: "coluna", nome: m.colunaDeEntrada }
              : { kind: "pedido", resumo: resumoDoPedido(m.inputPrompt) }
          }
          saida={
            m.outputKind === "card"
              ? { kind: "card", nome: m.colunaDeSaida }
              : { kind: "nota", workspace: null }
          }
          passos={m.steps.map((p) => {
            const agente = MODELOS_DE_AGENTE.find((a) => a.chave === p.agente);
            return { nome: agente?.name ?? p.agente, cor: agente?.color ?? "cinza", mode: p.mode };
          })}
        />
      </div>
      <p className="mt-2 text-miudo text-ink-400">
        {m.colunaDeConsumidas
          ? `A ideia usada vai para «${m.colunaDeConsumidas}». `
          : m.inputKind === "pedido"
            ? "Cada execução cumpre o mesmo pedido e deixa uma nota nova. "
            : ""}
        Nada é publicado fora do Yu-book.
      </p>
      <div className="mt-auto pt-4">
        <Botao
          variante={destaque ? "primario" : "secundario"}
          onClick={() => navigate(`/assistente/rotinas/novo?modelo=${m.chave}`)}
          aria-label={`Usar o modelo ${m.name}`}
        >
          Usar este modelo
        </Botao>
      </div>
    </article>
  );
}

/**
 * A galeria de rotinas (Etapa E da IA), em `/assistente/rotinas`.
 *
 * Vazia, ela ensina: diz o que é uma rotina e oferece os modelos prontos —
 * "Post do LinkedIn", por coluna e em card, e "Pedido direto", por pedido e em
 * nota — como ponto de partida. A lista é `MODELOS_DE_ROTINA`: modelo novo em
 * `shared` aparece aqui sozinho.
 */
export function GaleriaRotinas() {
  const navigate = useNavigate();
  const { data: rotinas, isLoading, error, refetch } = useRotinas();
  const excluir = useExcluirRotina();
  const rodar = useRodar();
  const alternarAgenda = useAlternarAgenda();
  const fuso = useAiAjustes().data?.timezone ?? null;
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const titulo = useRef<HTMLHeadingElement>(null);
  const [excluindo, setExcluindo] = useState<RoutineSummary | null>(null);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const vazia = rotinas && rotinas.length === 0;
  const viva = rotinas?.find((r) => r.lastRun?.status === "em_andamento");

  async function confirmarExclusao() {
    if (!excluindo) return;
    setErroExcluir(null);
    try {
      await excluir.mutateAsync(excluindo.id);
      setExcluindo(null);
      // O cartão que tinha o menu sumiu: o foco vai para o título da galeria.
      requestAnimationFrame(() => titulo.current?.focus());
    } catch (e) {
      setErroExcluir(e instanceof ApiError ? e.message : "Não foi possível excluir a rotina.");
    }
  }

  async function alternar(r: RoutineSummary) {
    const active = !r.schedule.active;
    setErroAgenda(null);
    try {
      await alternarAgenda.mutateAsync({ id: r.id, active });
      setAnuncio(active ? `Agenda de «${r.name}» retomada.` : `Agenda de «${r.name}» pausada.`);
    } catch (e) {
      setErroAgenda(
        e instanceof ApiError ? e.message : "Não foi possível mudar a agenda desta rotina.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>
      <header className="flex items-start gap-4">
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
            className="text-xl font-semibold tracking-tight text-titulo"
          >
            Rotinas
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-ink-400">
            Uma rotina encadeia agentes numa sequência fixa: parte da próxima ideia de uma
            coluna ou de um pedido seu, passa por cada agente e grava o resultado como card ou
            como nota. Roda quando você manda, ou sozinha nos dias e horários da agenda — no
            servidor, com a aba fechada. Nada sai do Yu-book.
          </p>
        </div>
        <Botao
          variante="ia"
          tamanho="m"
          icone={<IconeMais />}
          onClick={() => navigate("/assistente/rotinas/novo")}
        >
          Nova rotina
        </Botao>
      </header>

      {error && (
        <Aviso tom="erro">
          {error instanceof ApiError
            ? error.message
            : "Não foi possível carregar as rotinas."}{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-medium underline underline-offset-2"
          >
            Tentar de novo
          </button>
        </Aviso>
      )}
      {rodar.erro && <AvisoAoRodar erro={rodar.erro} onFechar={rodar.limpar} />}
      {erroAgenda && (
        <Aviso tom="erro" onFechar={() => setErroAgenda(null)}>
          {erroAgenda}
        </Aviso>
      )}

      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {[0, 1].map((i) => (
            <EsqueletoCartao key={i} />
          ))}
        </div>
      )}

      {rotinas && rotinas.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {rotinas.map((r) => (
            <li key={r.id} className="flex animate-surgir flex-col [&>article]:flex-1">
              <CartaoRotina
                rotina={r}
                rodando={rodar.rodando === r.id}
                outraRodando={Boolean(viva && viva.id !== r.id)}
                onRodar={() => void rodar.iniciar(r.id)}
                fuso={fuso}
                onAlternarAgenda={() => void alternar(r)}
                onExcluir={() => {
                  setErroExcluir(null);
                  setExcluindo(r);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {rotinas && (
        <section aria-labelledby="modelo-pronto-rotina">
          {vazia ? (
            <div className="mb-4">
              <h3 id="modelo-pronto-rotina" className="text-sm font-semibold text-titulo">
                Comece por um modelo pronto
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-ink-400">
                O modelo traz os passos e as instruções escritas. Você confere as colunas e os
                agentes — os que já existem com o mesmo nome entram sozinhos. Nada é criado até
                salvar.
              </p>
            </div>
          ) : (
            <h3 id="modelo-pronto-rotina" className="rotulo mb-3">
              Começar de um modelo
            </h3>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {MODELOS_DE_ROTINA.map((m) => (
              <CartaoModeloPronto key={m.chave} m={m} destaque={Boolean(vazia)} />
            ))}
          </div>
          {vazia && (
            <p className="mt-4 text-xs text-ink-400">
              Prefere do zero?{" "}
              <Link
                to="/assistente/rotinas/novo"
                className="text-accent-400 underline decoration-accent-400/40 underline-offset-2
                           hover:text-titulo"
              >
                Criar uma rotina em branco
              </Link>
            </p>
          )}
        </section>
      )}

      {excluindo && (
        <Dialogo aberto onFechar={() => setExcluindo(null)} rotulo="Excluir rotina?">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <IconeAlerta className="size-4 text-red-300" />
              <h2 className="text-sm font-semibold text-titulo">Excluir «{excluindo.name}»?</h2>
            </div>
            <p className="mt-2 text-xs text-ink-400">
              Os cards que ela criou ficam, com a marca de IA. O histórico de execuções continua
              contando no gasto do dia.
            </p>
            {erroExcluir && (
              <Aviso tom="erro" className="mt-3">
                {erroExcluir}
              </Aviso>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Botao variante="secundario" onClick={() => setExcluindo(null)}>
                Cancelar
              </Botao>
              <Botao
                variante="perigo"
                carregando={excluir.isPending}
                onClick={() => void confirmarExclusao()}
              >
                Excluir
              </Botao>
            </div>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
