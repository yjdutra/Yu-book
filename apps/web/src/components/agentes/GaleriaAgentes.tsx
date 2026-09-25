import { MODELOS_DE_AGENTE } from "@yu-book/shared";
import type { AgentSummary, ModeloDeAgente } from "@yu-book/shared";
import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAgentes } from "../../lib/agentes";
import { ApiError } from "../../lib/api";
import { Aviso } from "../base/Aviso";
import { Botao } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { Menu } from "../base/Menu";
import type { ItemMenu } from "../base/Menu";
import {
  IconeAgente,
  IconeAlerta,
  IconeAssistente,
  IconeBoard,
  IconeGlobo,
  IconeLapis,
  IconeMais,
  IconeNotas,
  IconeOpcoes,
} from "../Icones";
import { useAcoesDoAgente } from "./acoesDoAgente";
import { AvatarAgente } from "./AvatarAgente";
import { contar, rotuloDoModelo } from "./comum";

/** A altura do cartão e do esqueleto — a mesma, para a chegada não empurrar nada. */
const ALTURA_CARTAO = "min-h-[212px]";

function CartaoAgente({
  agente,
  itens,
  onConversar,
}: {
  agente: AgentSummary;
  itens: ItemMenu[];
  onConversar: () => void;
}) {
  const notas = agente.baseNoteTitles;
  return (
    <article
      aria-labelledby={`agente-${agente.id}`}
      className={`group relative flex flex-col rounded-cartao border border-ink-800 bg-superficie
                  p-4 shadow-e1 transition duration-[160ms] ease-(--ease-padrao)
                  hover:border-ink-700 hover:shadow-e2 ${ALTURA_CARTAO}`}
    >
      <div className="flex items-start gap-3">
        <AvatarAgente nome={agente.name} cor={agente.color} tamanho="g" />
        <div className="min-w-0 flex-1">
          <h3 id={`agente-${agente.id}`} className="truncate text-sm font-semibold text-titulo">
            <Link
              to={`/assistente/agentes/${agente.id}`}
              className="rounded-etiqueta hover:text-accent-400"
              title="Editar o agente"
            >
              {agente.name}
            </Link>
          </h3>
          <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">
            {agente.description || "Sem descrição."}
          </p>
        </div>
        <Menu
          rotulo={`Ações de ${agente.name}`}
          lado="baixo-fim"
          gatilho={(p) => (
            <button
              {...p}
              type="button"
              aria-label={`Ações de ${agente.name}`}
              title="Ações"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-controle
                         text-ink-400 transition hover:bg-ink-800 hover:text-ink-200"
            >
              <IconeOpcoes />
            </button>
          )}
          itens={itens}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {agente.modelMissing ? (
          // RNF-09: o problema tem glifo e texto, não só a cor âmbar.
          <span
            className="inline-flex items-center gap-1 rounded-etiqueta border border-amber-500/40
                       bg-amber-500/10 px-1.5 py-0.5 text-miudo text-amber-300"
          >
            <IconeAlerta className="size-3" />
            modelo fora dos favoritos
          </span>
        ) : (
          <Etiqueta tom={agente.modelId ? "ia" : "neutro"} titulo="Modelo">
            {rotuloDoModelo(agente)}
          </Etiqueta>
        )}
        <Etiqueta tom={agente.writes ? "ia" : "neutro"}>
          {contar(agente.toolCount, "ferramenta", "ferramentas")}
          {agente.writes && (
            <>
              {" · "}
              <IconeLapis className="inline size-3" /> escreve
            </>
          )}
        </Etiqueta>
        {agente.webSearch && (
          // Etapa G: sai do acervo — e cada busca é cobrada. Glifo e palavra.
          <Etiqueta icone={<IconeGlobo className="size-3" />} titulo="Busca na web ligada">
            busca na web
          </Etiqueta>
        )}
        {agente.liveSourceCount > 0 && (
          <Etiqueta icone={<IconeBoard className="size-3" />}>
            {contar(agente.liveSourceCount, "fonte viva", "fontes vivas")}
          </Etiqueta>
        )}
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
        {notas.length === 0 ? (
          <span className="text-miudo text-ink-400/80">Sem notas-base</span>
        ) : (
          <>
            {notas.slice(0, 3).map((t) => (
              <Etiqueta key={t} icone={<IconeNotas className="size-3" />}>
                {t}
              </Etiqueta>
            ))}
            {notas.length > 3 && (
              <Etiqueta titulo={notas.slice(3).join(", ")}>+{notas.length - 3}</Etiqueta>
            )}
          </>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Botao
          variante="ia"
          icone={<IconeAssistente className="size-3.5" />}
          onClick={onConversar}
          aria-label={`Conversar com ${agente.name}`}
        >
          Conversar
        </Botao>
        <Link
          to={`/assistente/agentes/${agente.id}`}
          className="rounded-controle px-2 py-1 text-xs text-ink-400 transition
                     hover:bg-ink-800 hover:text-ink-200"
          aria-label={`Editar ${agente.name}`}
        >
          Editar
        </Link>
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
      <div className="flex items-start gap-3">
        <div className="size-9 animate-pulse rounded-controle bg-ink-800" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/2 animate-pulse rounded-etiqueta bg-ink-800" />
          <div className="h-3 w-5/6 animate-pulse rounded-etiqueta bg-ink-800" />
        </div>
      </div>
      <div className="mt-4 flex gap-1">
        <div className="h-5 w-24 animate-pulse rounded-etiqueta bg-ink-800" />
        <div className="h-5 w-20 animate-pulse rounded-etiqueta bg-ink-800" />
      </div>
      <div className="mt-2 h-5 w-32 animate-pulse rounded-etiqueta bg-ink-800" />
      <div className="mt-8 h-7 w-28 animate-pulse rounded-controle bg-ink-800" />
    </div>
  );
}

/** Um modelo pronto: ponto de partida, não agente — nada é criado até salvar. */
function CartaoModeloPronto({ modelo, destaque }: { modelo: ModeloDeAgente; destaque: boolean }) {
  const navigate = useNavigate();
  return (
    <article
      aria-labelledby={`modelo-${modelo.chave}`}
      className={`relative flex flex-col overflow-hidden rounded-cartao border bg-superficie p-4
                  transition duration-[160ms] ease-(--ease-padrao) hover:shadow-e2 ${
                    destaque ? "border-ink-700 shadow-e1" : "border-dashed border-ink-700"
                  }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
      />
      <div className="flex items-start gap-3">
        <AvatarAgente nome={modelo.name} cor={modelo.color} tamanho="g" />
        <div className="min-w-0 flex-1">
          <h3 id={`modelo-${modelo.chave}`} className="text-sm font-semibold text-titulo">
            {modelo.name}
          </h3>
          <p className="mt-0.5 text-xs text-ink-400">{modelo.description}</p>
        </div>
      </div>
      <p className="mt-3 text-miudo text-ink-400">Premissas sugeridas</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {modelo.notasSugeridas.map((t) => (
          <Etiqueta key={t} icone={<IconeNotas className="size-3" />}>
            {t}
          </Etiqueta>
        ))}
      </div>
      <div className="mt-auto pt-4">
        <Botao
          variante={destaque ? "primario" : "secundario"}
          onClick={() => navigate(`/assistente/agentes/novo?modelo=${modelo.chave}`)}
          aria-label={`Usar o modelo ${modelo.name}`}
        >
          Usar este modelo
        </Botao>
      </div>
    </article>
  );
}

/**
 * A galeria de agentes (Etapa D da IA), em `/assistente/agentes`.
 *
 * Vazia, ela ensina: diz o que é um agente e oferece os três modelos prontos
 * como ponto de partida, em vez de um botão solitário diante de um formulário
 * em branco.
 */
export function GaleriaAgentes() {
  const navigate = useNavigate();
  const { data: agentes, isLoading, error, refetch } = useAgentes();
  const titulo = useRef<HTMLHeadingElement>(null);
  const acoes = useAcoesDoAgente({ vizinho: () => titulo.current });
  const vazia = agentes && agentes.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-cartao
                     bg-linear-to-br from-accent-500 to-ia-500 text-white shadow-brilho-ia"
        >
          <IconeAgente className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            ref={titulo}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight text-titulo"
          >
            Agentes
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-ink-400">
            Um agente é o assistente com premissas carregadas: instruções próprias, notas que
            entram inteiras no contexto e colunas de quadro lidas a cada mensagem. As regras do
            Yu-book continuam valendo por cima das instruções dele.
          </p>
        </div>
        <Botao
          variante="ia"
          tamanho="m"
          icone={<IconeMais />}
          onClick={() => navigate("/assistente/agentes/novo")}
        >
          Novo agente
        </Botao>
      </header>

      {error && (
        <Aviso tom="erro">
          {error instanceof ApiError
            ? error.message
            : "Não foi possível carregar os agentes."}{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-medium underline underline-offset-2"
          >
            Tentar de novo
          </button>
        </Aviso>
      )}
      {acoes.elementos}

      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {[0, 1, 2].map((i) => (
            <EsqueletoCartao key={i} />
          ))}
        </div>
      )}

      {agentes && agentes.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {agentes.map((a) => (
            <li key={a.id} className="flex animate-surgir flex-col [&>article]:flex-1">
              <CartaoAgente
                agente={a}
                itens={acoes.itens(a)}
                onConversar={() => acoes.conversar(a)}
              />
            </li>
          ))}
        </ul>
      )}

      {agentes && (
        <section aria-labelledby="modelos-prontos">
          {vazia ? (
            <div className="mb-4">
              <h3 id="modelos-prontos" className="text-sm font-semibold text-titulo">
                Comece por um modelo pronto
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-ink-400">
                Cada modelo traz instruções escritas, ferramentas escolhidas e os títulos das
                notas que ele espera ler. Nada é criado até você salvar — e as notas sugeridas
                podem nascer vazias, para você preencher depois.
              </p>
            </div>
          ) : (
            <h3 id="modelos-prontos" className="rotulo mb-3">
              Começar de um modelo
            </h3>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {MODELOS_DE_AGENTE.map((m) => (
              <CartaoModeloPronto key={m.chave} modelo={m} destaque={Boolean(vazia)} />
            ))}
          </div>
          {vazia && (
            <p className="mt-4 text-xs text-ink-400">
              Prefere do zero?{" "}
              <Link
                to="/assistente/agentes/novo"
                className="text-accent-400 underline decoration-accent-400/40 underline-offset-2
                           hover:text-titulo"
              >
                Criar um agente em branco
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
