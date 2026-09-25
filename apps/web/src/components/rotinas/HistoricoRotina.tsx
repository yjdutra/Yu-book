import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useAiAjustes } from "../../lib/ia";
import { useHistorico } from "../../lib/rotinas";
import { emDolares } from "../ajustes/comum";
import { Aviso } from "../base/Aviso";
import { Botao } from "../base/Botao";
import { textoDoGatilho } from "./Agenda";
import { duracao, duracaoEntre, quando, SeloStatus } from "./comum";
import { rotaDaExecucao } from "./rodar";

/** A altura de uma linha e do esqueleto dela — a mesma, para a chegada não empurrar. */
const ALTURA_LINHA = "h-14";

/**
 * As execuções de uma rotina, da mais nova para a mais velha, dez por vez.
 * Cada linha leva à linha do tempo daquela execução — inclusive a que está
 * rodando agora.
 *
 * Etapa F: a segunda linha diz quem disparou ("manual", "agendada · ter 08:00")
 * e, na pulada, o motivo e as tentativas — a pulada não tem ideia nem pedido
 * para citar, e o que importa nela é por que não começou.
 */
export function HistoricoRotina({ routineId }: { routineId: string }) {
  const historico = useHistorico(routineId);
  const itens = historico.data?.pages.flatMap((p) => p.items) ?? [];
  const fuso = useAiAjustes().data?.timezone ?? null;

  return (
    <section aria-labelledby="historico-rotina" className="flex flex-col gap-3">
      <h3 id="historico-rotina" className="rotulo">
        Execuções
      </h3>

      {historico.error && (
        <Aviso tom="erro">
          {historico.error instanceof ApiError
            ? historico.error.message
            : "Não foi possível carregar as execuções."}{" "}
          <button
            type="button"
            onClick={() => void historico.refetch()}
            className="font-medium underline underline-offset-2"
          >
            Tentar de novo
          </button>
        </Aviso>
      )}

      {historico.isLoading && (
        <div aria-hidden="true" className="grid gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`${ALTURA_LINHA} animate-pulse rounded-controle border border-ink-800
                          bg-superficie`}
            />
          ))}
        </div>
      )}

      {historico.data && itens.length === 0 && (
        <p
          className="rounded-cartao border border-dashed border-ink-700 px-4 py-6 text-center
                     text-xs text-ink-400"
        >
          Nenhuma execução ainda. “Rodar agora” pega a próxima ideia da entrada, ou cumpre o
          pedido, e mostra cada passo acontecendo.
        </p>
      )}

      {itens.length > 0 && (
        <ol className="grid gap-1">
          {itens.map((r) => {
            const ms = duracaoEntre(r.startedAt, r.endedAt);
            return (
              <li key={r.id}>
                <Link
                  to={rotaDaExecucao(r.routineId, r.id)}
                  className={`grid ${ALTURA_LINHA} grid-cols-[7.5rem_minmax(0,1fr)_6rem_5.5rem_7rem]
                              items-center gap-3 rounded-controle border border-ink-800
                              bg-superficie px-3 text-xs text-ink-400 shadow-e1 transition
                              hover:border-ink-700 hover:text-ink-200`}
                >
                  <SeloStatus status={r.status} />
                  <span className="flex min-w-0 flex-col">
                    {r.status === "pulada" ? (
                      <span
                        className="truncate text-sm text-ink-200"
                        title={r.errorMessage ?? undefined}
                      >
                        <span className="text-ink-400">Não começou: </span>
                        {r.errorMessage ?? "recusada no início"}
                      </span>
                    ) : (
                      <span
                        className="truncate text-sm text-ink-200"
                        title={r.inputTitle ?? undefined}
                      >
                        {r.inputKind === "pedido" && (
                          <span className="text-ink-400">Pedido </span>
                        )}
                        {r.inputTitle ? (
                          `«${r.inputTitle}»`
                        ) : (
                          <span className="text-ink-400">sem título</span>
                        )}
                      </span>
                    )}
                    <span className="truncate text-miudo text-ink-400">
                      {textoDoGatilho(r, fuso)}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {r.status === "pulada" ? "—" : ms === null ? "—" : duracao(ms)}
                    {!r.endedAt && <span className="sr-only"> até agora</span>}
                  </span>
                  <span className="text-right tabular-nums">{emDolares(r.costMicros)}</span>
                  <time dateTime={r.startedAt} className="text-right">
                    {quando(r.startedAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {historico.hasNextPage && (
        <Botao
          variante="fantasma"
          className="self-start"
          carregando={historico.isFetchingNextPage}
          onClick={() => void historico.fetchNextPage()}
        >
          Carregar mais
        </Botao>
      )}
    </section>
  );
}
