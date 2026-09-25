import type {
  OpenRouterAccount,
  OpenRouterMetric,
  OpenRouterMetricFormat,
  OpenRouterModelActivity,
  OpenRouterProviderActivity,
} from "@yu-book/shared";
import type { ReactNode } from "react";
import { ApiError } from "../../lib/api";
import type { useOpenRouterConta, useOpenRouterMetricas } from "../../lib/ia";
import { Aviso } from "../base/Aviso";
import { Bloco, Esqueleto, Vazio } from "../base/Bloco";
import { BarrasPorDia, diaCurto } from "./BarrasPorDia";
import { emDolares } from "./comum";
import { Indicador } from "./Indicador";

/**
 * Os blocos que dependem da management key: saldo da conta, os últimos 30
 * dias e as métricas. Só são montados quando a resposta da chave diz que ela
 * existe. As consultas vêm de `SecaoOpenRouter`, que as declara com `enabled`
 * preso a esse mesmo sinal: sem a chave, nem saem.
 */

const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const PORCENTAGEM = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function mensagemDeErro(erro: unknown): string {
  return erro instanceof ApiError ? erro.message : "Não foi possível consultar o provedor.";
}

export function ContaOpenRouter({ conta }: { conta: ReturnType<typeof useOpenRouterConta> }) {
  if (conta.isPending) {
    return (
      <>
        <Bloco titulo="Conta no provedor">
          <Esqueleto linhas={2} alturaLinha={24} />
        </Bloco>
        <Bloco titulo="Últimos 30 dias">
          <Esqueleto linhas={5} alturaLinha={28} />
        </Bloco>
      </>
    );
  }

  // Um erro só para os dois blocos: vêm da mesma consulta.
  if (conta.isError) {
    return (
      <Aviso tom="erro">
        Conta e últimos 30 dias: {mensagemDeErro(conta.error)}
      </Aviso>
    );
  }

  const { credits, activity } = conta.data;
  return (
    <>
      <Bloco titulo="Conta no provedor">
        {credits ? (
          <dl className="grid grid-cols-3 gap-4 px-4 py-3">
            <Indicador rotulo="Saldo" valor={emDolares(credits.balanceMicros)} />
            <Indicador rotulo="Comprado" valor={emDolares(credits.purchasedMicros)} />
            <Indicador rotulo="Usado" valor={emDolares(credits.usedMicros)} />
          </dl>
        ) : (
          <Vazio texto="O provedor não informou os créditos da conta." />
        )}
      </Bloco>

      <Bloco titulo="Últimos 30 dias">
        {activity ? (
          <UltimosDias atividade={activity} />
        ) : (
          <Vazio texto="O provedor não informou a atividade da conta." />
        )}
      </Bloco>
    </>
  );
}

function UltimosDias({
  atividade,
}: {
  atividade: NonNullable<OpenRouterAccount["activity"]>;
}) {
  const semGasto = atividade.daily.every((d) => d.costMicros === 0);
  return (
    <div className="flex flex-col gap-5 px-4 py-3">
      <p className="text-xs text-ink-400">
        De <span className="tabular-nums">{diaCurto(atividade.from)}</span> a{" "}
        <span className="tabular-nums">{diaCurto(atividade.to)}</span>, em dias UTC. O dia de
        hoje entra amanhã: o provedor só fecha dia completo.
      </p>

      {semGasto ? (
        <p className="text-sm text-ink-400">Nenhum gasto no período.</p>
      ) : (
        <BarrasPorDia
          rotulo="Custo por dia"
          dias={atividade.daily.map((d) => ({ dia: d.date, valor: d.costMicros }))}
          formatar={emDolares}
        />
      )}

      <TabelaPorModelo linhas={atividade.byModel} />
      <TabelaPorProvedor linhas={atividade.byProvider} />
    </div>
  );
}

const CELULA = "py-1.5 pl-3 text-right tabular-nums text-ink-200";

function Tabela({
  titulo,
  colunas,
  vazia,
  children,
}: {
  titulo: string;
  /** A primeira é o cabeçalho de linha; as demais são numéricas, alinhadas à direita. */
  colunas: string[];
  vazia: boolean;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h4 className="rotulo mb-1.5">{titulo}</h4>
      {vazia ? (
        <p className="text-xs text-ink-400">Nenhum uso no período.</p>
      ) : (
        // Rola sozinha se o id do modelo for comprido: o `Bloco` corta o que
        // passa da borda.
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ink-800">
                {colunas.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={`py-1.5 font-medium text-ink-400 ${
                      i === 0 ? "pr-3 text-left" : "pl-3 text-right"
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TabelaPorModelo({ linhas }: { linhas: OpenRouterModelActivity[] }) {
  return (
    <Tabela
      titulo="Por modelo"
      colunas={["Modelo", "Requisições", "Entrada", "Saída", "Raciocínio", "Custo"]}
      vazia={linhas.length === 0}
    >
      {linhas.map((m) => (
        <tr key={m.model} className="border-b border-ink-800 last:border-0">
          <th
            scope="row"
            className="py-1.5 pr-3 text-left font-mono font-normal break-all text-ink-200"
          >
            {m.model}
          </th>
          <td className={CELULA}>{INTEIRO.format(m.requests)}</td>
          <td className={CELULA}>{INTEIRO.format(m.promptTokens)}</td>
          <td className={CELULA}>{INTEIRO.format(m.completionTokens)}</td>
          <td className={CELULA}>{INTEIRO.format(m.reasoningTokens)}</td>
          <td className={CELULA}>{emDolares(m.costMicros)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

function TabelaPorProvedor({ linhas }: { linhas: OpenRouterProviderActivity[] }) {
  return (
    <Tabela
      titulo="Por provedor"
      colunas={["Provedor", "Requisições", "Custo"]}
      vazia={linhas.length === 0}
    >
      {linhas.map((p) => (
        <tr key={p.provider} className="border-b border-ink-800 last:border-0">
          <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-200">
            {p.provider}
          </th>
          <td className={CELULA}>{INTEIRO.format(p.requests)}</td>
          <td className={CELULA}>{emDolares(p.costMicros)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

/**
 * Rótulo em português de cada métrica que o servidor pede. É texto de tela,
 * por isso mora aqui e não em `shared`: o servidor devolve só o `name`.
 * Métrica que não estiver aqui aparece pelo nome cru, em vez de sumir.
 */
const ROTULO_DA_METRICA: Record<string, string> = {
  request_count: "Requisições",
  total_usage: "Gasto total",
  tokens_total: "Tokens",
  cache_hit_rate: "Acerto de cache",
  avg_latency: "Latência média",
  usage_web: "Gasto com busca na web",
  usage_cache: "Gasto com cache",
};

const FORMATO: Record<OpenRouterMetricFormat, (valor: number) => string> = {
  number: (v) => INTEIRO.format(v),
  // Já em µUSD: o servidor converte, como todo dinheiro do módulo.
  currency: emDolares,
  // O provedor manda fração (0,25 = 25%), e o formato de porcentagem do
  // `Intl` já multiplica por 100.
  percent: (v) => PORCENTAGEM.format(v),
  // UNIDADE NÃO CONFIRMADA. A documentação do provedor não diz em que unidade
  // vem a latência; supomos milissegundos. Conferir com a management key real
  // e trocar aqui se vier em segundos.
  latency: (v) => (v >= 1000 ? `${DECIMAL.format(v / 1000)} s` : `${INTEIRO.format(v)} ms`),
  // UNIDADE NÃO CONFIRMADA, e nenhuma métrica pedida hoje tem este formato:
  // vai o número sem unidade, em vez de uma unidade inventada.
  throughput: (v) => DECIMAL.format(v),
};

function ValorDaMetrica({ metrica }: { metrica: OpenRouterMetric }) {
  if (metrica.value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">sem valor</span>
      </>
    );
  }
  return <>{FORMATO[metrica.format](metrica.value)}</>;
}

export function MetricasOpenRouter({
  metricas,
}: {
  metricas: ReturnType<typeof useOpenRouterMetricas>;
}) {
  return (
    <Bloco titulo="Métricas, 30 dias até agora">
      {metricas.isPending && <Esqueleto linhas={2} alturaLinha={24} />}
      {metricas.isError && (
        <div className="px-4 py-3">
          <Aviso tom="erro">{mensagemDeErro(metricas.error)}</Aviso>
        </div>
      )}
      {metricas.data &&
        (metricas.data.items.length === 0 ? (
          <Vazio texto="O provedor não anunciou nenhuma das métricas que o Yu-book pede." />
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3">
            <dl className="grid grid-cols-4 gap-4">
              {metricas.data.items.map((m) => (
                <Indicador
                  key={m.name}
                  rotulo={
                    ROTULO_DA_METRICA[m.name] ?? (
                      <span className="font-mono normal-case">{m.name}</span>
                    )
                  }
                  valor={<ValorDaMetrica metrica={m} />}
                />
              ))}
            </dl>
            <p className="text-miudo text-ink-400">
              Contadas pelo provedor, dos últimos 30 dias até agora — inclui hoje, ao contrário
              dos últimos 30 dias acima.
            </p>
          </div>
        ))}
    </Bloco>
  );
}
