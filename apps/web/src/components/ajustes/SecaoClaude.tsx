import { dolaresParaMicros, microsParaDolares } from "@yu-book/shared";
import type { ClaudeUsageReport } from "@yu-book/shared";
import type { ReactNode } from "react";
import { ApiError } from "@yu-book/cliente/api";
import { useAtualizarAjustes, useUsoClaude } from "../../lib/ia";
import { Aviso } from "@yu-book/cliente/base/Aviso";
import { Bloco, Esqueleto, Vazio } from "@yu-book/cliente/base/Bloco";
import { BarrasPorDia, diaCurto } from "@yu-book/cliente/graficos/BarrasPorDia";
import { Indicador } from "@yu-book/cliente/graficos/Indicador";
import { nomeDoFuso } from "../rotinas/comum";
import { emDolares } from "./comum";
import { SeletorPeriodo, usePeriodoDaUrl, variacao } from "./SecaoUsoIa";
import {
  INTEIRO,
  PORCENTAGEM,
  TabelaClaudePorModelo,
  TabelaClaudePorTarefa,
} from "./TabelasUsoIa";

/**
 * Custo do Claude (docs/plano-provedor-anthropic.md, F4): o que o Yu-book
 * gastou na API da Anthropic, onde caem os créditos mensais do plano. Lê o
 * mesmo registro do AI usage dash, só da Anthropic, com o que só ela informa —
 * os tokens de cache — e o mês civil, que é a janela dos créditos.
 *
 * **É estimativa, e a tela diz.** A Anthropic devolve tokens, não dólares; o
 * custo sai da tabela de preços de `packages/shared`. A fonte oficial é o
 * Console — a Admin API, que daria o número dela aqui, não existe para conta
 * individual. Também não há leitura de saldo de créditos: o crédito do mês é
 * informado à mão, nesta tela, só para comparar.
 */
export function SecaoClaude({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const [periodo, definirPeriodo] = usePeriodoDaUrl();
  const uso = useUsoClaude(periodo);
  const trocando = uso.isPlaceholderData;
  const relatorio = uso.data;

  const acao = (
    <span className="flex items-center gap-3">
      <span aria-live="polite" className="text-miudo text-ink-400">
        {trocando ? `carregando ${periodo} dias…` : ""}
      </span>
      <SeletorPeriodo periodo={periodo} onPeriodo={definirPeriodo} />
    </span>
  );

  // O mesmo `Bloco` "Resumo" em todos os estados, como no AI usage dash: uma
  // árvore por estado remontaria o seletor e o foco iria para o `<body>`.
  let resumo: ReactNode;
  let resto: ReactNode = null;
  if (uso.isPending) {
    resumo = <Esqueleto linhas={2} alturaLinha={40} />;
  } else if (uso.isError || !relatorio) {
    resumo = (
      <div className="px-4 py-3">
        <Aviso tom="erro">
          {uso.error instanceof ApiError
            ? uso.error.message
            : "Não foi possível ler o registro de uso."}
        </Aviso>
      </div>
    );
  } else if (relatorio.totals.calls === 0) {
    resumo = (
      <Vazio texto={`Nenhuma chamada à Anthropic nos últimos ${relatorio.days} dias.`} />
    );
  } else {
    resumo = <Resumo relatorio={relatorio} />;
    resto = <Detalhes relatorio={relatorio} />;
  }

  return (
    <div
      aria-busy={trocando}
      className={`flex flex-col gap-6 transition-opacity ${trocando ? "opacity-60" : ""}`}
    >
      {relatorio && !relatorio.configured && (
        <Aviso tom="alerta">
          Sem <code>ANTHROPIC_API_KEY</code> no servidor: os modelos da Anthropic não respondem.
          Crie a chave em platform.claude.com, na organização onde caem os créditos do plano.
        </Aviso>
      )}
      {relatorio && relatorio.creditErrors > 0 && (
        <Aviso tom="erro">
          {relatorio.creditErrors === 1
            ? "1 chamada foi recusada"
            : `${INTEIRO.format(relatorio.creditErrors)} chamadas foram recusadas`}{" "}
          no período por crédito acabado ou limite de uso da Anthropic — as duas recusas chegam
          com o mesmo código. Confira o saldo em platform.claude.com, ou troque o modelo das
          tarefas em Modelos.
        </Aviso>
      )}

      <CreditosDoMes relatorio={relatorio} onErro={onErro} />

      <Bloco titulo="Resumo" acao={acao}>
        {resumo}
      </Bloco>
      {resto}
    </div>
  );
}

/**
 * O gasto do mês contra os créditos informados. O texto é o dado; a barra só
 * o desenha (RNF-09). Passar dos créditos não bloqueia nada — quem bloqueia é
 * a Anthropic, com a recusa que o aviso de cima conta.
 */
function CreditosDoMes({
  relatorio,
  onErro,
}: {
  relatorio: ClaudeUsageReport | undefined;
  onErro: (mensagem: string | null) => void;
}) {
  const atualizar = useAtualizarAjustes();
  const credito = relatorio?.monthlyCreditMicros ?? null;
  const gasto = relatorio?.month.costMicros ?? 0;
  const fracao = credito && credito > 0 ? Math.min(gasto / credito, 1) : 0;

  async function salvar(valor: string) {
    const texto = valor.trim();
    const dolares = Number(texto.replace(",", "."));
    if (texto && (!Number.isFinite(dolares) || dolares < 0)) return;
    const micros = texto ? dolaresParaMicros(dolares) : null;
    if (micros === credito) return;
    onErro(null);
    try {
      await atualizar.mutateAsync({ anthropicMonthlyCreditMicros: micros });
    } catch (e) {
      onErro(e instanceof ApiError ? e.message : "Não foi possível salvar os créditos.");
    }
  }

  return (
    <Bloco titulo="Créditos do mês">
      <div className="flex items-start gap-6 px-4 py-3">
        <div className="min-w-0 flex-1">
          {relatorio ? (
            <>
              <p className="text-sm tabular-nums text-ink-200">
                {emDolares(gasto)}
                {credito !== null && (
                  <span className="text-ink-400"> de {emDolares(credito)} em créditos</span>
                )}
              </p>
              {credito !== null && (
                <div
                  aria-hidden="true"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800"
                >
                  <div
                    className="h-full rounded-full bg-linear-to-r from-accent-500 to-ia-500"
                    style={{ width: `${fracao * 100}%` }}
                  />
                </div>
              )}
              <p className="mt-2 text-miudo text-ink-400">
                Desde <span className="tabular-nums">{diaCurto(relatorio.month.from)}</span>,{" "}
                {INTEIRO.format(relatorio.month.calls)}{" "}
                {relatorio.month.calls === 1 ? "chamada" : "chamadas"}
                {credito !== null && credito > gasto && (
                  <> · restam cerca de {emDolares(credito - gasto)}</>
                )}
                {credito !== null && gasto >= credito && <> · os créditos do mês acabaram</>}
              </p>
            </>
          ) : (
            <Esqueleto linhas={1} alturaLinha={40} />
          )}
        </div>

        <label className="flex shrink-0 flex-col gap-1 text-xs">
          <span className="text-ink-400">Créditos por mês, em dólares</span>
          <input
            // A chave remonta o campo quando o valor salvo chega: `defaultValue`
            // só vale na primeira pintura, como no teto de `SecaoGasto`.
            key={credito ?? "vazio"}
            type="number"
            min="0"
            step="1"
            placeholder="não informado"
            defaultValue={credito === null ? "" : microsParaDolares(credito).toFixed(2)}
            onBlur={(e) => void salvar(e.target.value)}
            aria-label="Créditos mensais da API da Anthropic, em dólares"
            className="w-36 rounded-controle border border-ink-700 bg-superficie px-2 py-1
                       text-ink-200 outline-none focus:border-accent-400"
          />
          <span className="text-miudo text-ink-400">
            {atualizar.isPending ? "salvando…" : "O valor do seu plano. Vazio apaga."}
          </span>
        </label>
      </div>
    </Bloco>
  );
}

function Resumo({ relatorio }: { relatorio: ClaudeUsageReport }) {
  const { totals, days } = relatorio;
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <dl className="grid grid-cols-3 gap-4">
        <Indicador
          rotulo="Gasto"
          valor={emDolares(totals.costMicros)}
          detalhe={variacao(totals.costMicros, relatorio.previousCostMicros, days)}
        />
        <Indicador
          rotulo="Hoje"
          valor={emDolares(relatorio.today.costMicros)}
          detalhe={`${INTEIRO.format(relatorio.today.calls)} chamadas`}
        />
        <Indicador
          rotulo="Chamadas"
          valor={INTEIRO.format(totals.calls)}
          detalhe={
            totals.failedCalls > 0
              ? `${INTEIRO.format(totals.failedCalls)} com falha`
              : "nenhuma falha"
          }
        />
        <Indicador
          rotulo="Economia do cache"
          valor={emDolares(totals.cacheSavingsMicros)}
          detalhe="contra pagar o prompt inteiro como entrada"
        />
        <Indicador
          rotulo="Prompt servido pelo cache"
          valor={
            totals.cacheHitRate === null ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">sem prompt no período</span>
              </>
            ) : (
              PORCENTAGEM.format(totals.cacheHitRate)
            )
          }
        />
        <Indicador
          rotulo="Tokens de saída"
          valor={INTEIRO.format(totals.outputTokens)}
          detalhe="o pensamento do modelo conta aqui"
        />
      </dl>
      <p className="text-miudo text-ink-400">
        De <span className="tabular-nums">{diaCurto(relatorio.from)}</span> a{" "}
        <span className="tabular-nums">{diaCurto(relatorio.to)}</span>, em dias no seu fuso (
        {nomeDoFuso(relatorio.timezone)}). Estimado pelo Yu-book com a tabela de preços da
        Anthropic — o valor oficial está em platform.claude.com, na página Cost.
      </p>
    </div>
  );
}

function Detalhes({ relatorio }: { relatorio: ClaudeUsageReport }) {
  return (
    <>
      {relatorio.refusals > 0 && (
        <Aviso tom="alerta">
          {relatorio.refusals === 1
            ? "1 resposta foi recusada"
            : `${INTEIRO.format(relatorio.refusals)} respostas foram recusadas`}{" "}
          pelo próprio modelo no período. A recusa é cobrada, e está na soma.
        </Aviso>
      )}

      <Bloco titulo="Gasto por dia">
        <div className="px-4 py-3">
          <BarrasPorDia
            rotulo="Custo do Claude por dia"
            dias={relatorio.daily.map((d) => ({ dia: d.localDay, valor: d.costMicros }))}
            formatar={emDolares}
          />
        </div>
      </Bloco>

      <Bloco titulo="Por modelo">
        <TabelaClaudePorModelo linhas={relatorio.byModel} />
      </Bloco>

      <Bloco titulo="Por tarefa">
        <TabelaClaudePorTarefa linhas={relatorio.byTask} />
      </Bloco>
    </>
  );
}
