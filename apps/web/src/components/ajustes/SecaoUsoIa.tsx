import { PERIODOS_DE_USO } from "@yu-book/shared";
import type { AiUsageReport, PeriodoDeUso } from "@yu-book/shared";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useUsoIa } from "../../lib/ia";
import { Aviso } from "../base/Aviso";
import { Bloco, Esqueleto, Vazio } from "../base/Bloco";
import { nomeDoFuso } from "../rotinas/comum";
import { BarrasPorDia, diaCurto } from "./BarrasPorDia";
import { duracao, emDolares } from "./comum";
import { Indicador } from "./Indicador";
import {
  INTEIRO,
  PORCENTAGEM,
  TabelaPorModelo,
  TabelaPorOrigem,
  TabelaPorTarefa,
  TabelaDeErros,
  UltimasChamadas,
} from "./TabelasUsoIa";

/**
 * AI usage dash: o que **o próprio Yu-book** gravou em `ai_usage`, uma linha
 * por chamada ao provedor, inclusive as que falharam. É a outra metade do
 * Dashboard OpenRouter — lá, o que o provedor diz; aqui, o que o servidor
 * registrou, com tarefa, vínculo e origem do custo. Os dois não precisam bater
 * dia a dia: aqui o dia é o do fuso do usuário, lá é UTC.
 *
 * Só lê o banco. `PERIODOS_DE_USO` vem de `shared` como valor, e este import
 * não custa nada ao bundle inicial — mas não porque a seção é `lazy()`: o
 * módulo `ia.ts` de `shared` já entra inteiro na primeira pintura pelo
 * `microsParaDolares` que `ajustes/comum.ts` importa como valor, e
 * `comum.ts` é lido pelo painel contextual (`SECOES_DE_AJUSTES`). Dívida
 * anterior a esta seção; quem a pagar confere este import também.
 */
export function SecaoUsoIa() {
  const [periodo, definirPeriodo] = usePeriodoDaUrl();
  const uso = useUsoIa(periodo);
  // Trocando de período, `keepPreviousData` mantém o anterior à vista: o
  // seletor já marca o novo, e o texto diz que os números ainda são do outro.
  const trocando = uso.isPlaceholderData;

  const acao = (
    <span className="flex items-center gap-3">
      <span aria-live="polite" className="text-miudo text-ink-400">
        {trocando ? `carregando ${periodo} dias…` : ""}
      </span>
      <SeletorPeriodo periodo={periodo} onPeriodo={definirPeriodo} />
    </span>
  );

  // Um só `Bloco` "Resumo", o mesmo elemento em todos os estados: só o que vai
  // dentro dele e os blocos abaixo mudam. Uma árvore por estado remontava o
  // seletor ao chegar a resposta, e o botão de período focado sumia com o foco
  // junto, para o `<body>` (RNF-06 da Fase 1).
  const relatorio = uso.data;
  let resumo: ReactNode;
  let resto: ReactNode = null;
  if (uso.isPending) {
    resumo = <Esqueleto linhas={2} alturaLinha={40} />;
    resto = (
      <Bloco titulo="Gasto por dia">
        <Esqueleto linhas={1} alturaLinha={140} />
      </Bloco>
    );
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
    resumo = <Vazio texto={`Nenhuma chamada de IA nos últimos ${relatorio.days} dias.`} />;
  } else {
    resumo = <Resumo relatorio={relatorio} />;
    resto = <Detalhes relatorio={relatorio} />;
  }

  return (
    <div
      aria-busy={trocando}
      className={`flex flex-col gap-6 transition-opacity ${trocando ? "opacity-60" : ""}`}
    >
      <Bloco titulo="Resumo" acao={acao}>
        {resumo}
      </Bloco>
      {resto}
    </div>
  );
}

/** Tudo o que vem abaixo do resumo quando o período tem chamada. */
function Detalhes({ relatorio }: { relatorio: AiUsageReport }) {
  return (
    <>
      <Honestidade relatorio={relatorio} />

      <Bloco titulo="Gasto por dia">
        <div className="px-4 py-3">
          <BarrasPorDia
            rotulo="Custo por dia"
            dias={relatorio.daily.map((d) => ({ dia: d.localDay, valor: d.costMicros }))}
            formatar={emDolares}
          />
        </div>
      </Bloco>

      <Bloco titulo="Por modelo">
        <TabelaPorModelo linhas={relatorio.byModel} />
      </Bloco>

      <div className="grid grid-cols-2 gap-6">
        <Bloco titulo="Por tarefa">
          <TabelaPorTarefa linhas={relatorio.byTask} />
        </Bloco>
        <Bloco titulo="Por origem do custo">
          <TabelaPorOrigem linhas={relatorio.byCostSource} />
        </Bloco>
      </div>

      {relatorio.totals.failedCalls > 0 && (
        <Bloco titulo="Erros mais comuns">
          <TabelaDeErros erros={relatorio.errors} falhas={relatorio.totals.failedCalls} />
        </Bloco>
      )}

      <Bloco titulo="Últimas chamadas">
        <UltimasChamadas chamadas={relatorio.recent} fuso={relatorio.timezone} />
      </Bloco>
    </>
  );
}

const PADRAO: PeriodoDeUso = 30;

/**
 * O período mora na URL (`?dias=30`): sobrevive ao recarregar, vira link, e o
 * Voltar desfaz a troca. Valor que a lista não tem cai no padrão, em vez de
 * pedir ao servidor um período que ele recusaria com 422.
 */
function usePeriodoDaUrl() {
  const [params, setParams] = useSearchParams();
  const texto = params.get("dias");
  const periodo = PERIODOS_DE_USO.find((p) => String(p) === texto) ?? PADRAO;
  const definir = (p: PeriodoDeUso) =>
    setParams((atual) => {
      const nova = new URLSearchParams(atual);
      nova.set("dias", String(p));
      return nova;
    });
  return [periodo, definir] as const;
}

/**
 * Controle segmentado, no padrão de `SeletorModo` (`ModoNota.tsx`): o ativo se
 * ergue como cartão, então a escolha tem forma além da cor (RNF-09), e
 * `aria-pressed` diz o mesmo ao leitor de tela.
 */
function SeletorPeriodo({
  periodo,
  onPeriodo,
}: {
  periodo: PeriodoDeUso;
  onPeriodo: (p: PeriodoDeUso) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="flex items-center gap-0.5 rounded-controle bg-ink-900 p-0.5"
    >
      {PERIODOS_DE_USO.map((p) => {
        const ativo = p === periodo;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodo(p)}
            aria-pressed={ativo}
            className={`rounded-[8px] px-2 py-0.5 text-xs tabular-nums transition-colors
                        duration-[120ms] ${
                          ativo
                            ? "bg-superficie text-titulo shadow-e1"
                            : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                        }`}
          >
            {p} dias
          </button>
        );
      })}
    </div>
  );
}

const VARIACAO = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/**
 * A variação contra o período anterior, com o sinal escrito ("+12%"), e não
 * uma seta colorida: subir o gasto não é, por si, bom nem ruim.
 */
function variacao(atual: number, anterior: number, dias: number): string {
  if (anterior === 0) return `sem gasto nos ${dias} dias anteriores`;
  return `${VARIACAO.format((atual - anterior) / anterior)} contra os ${dias} dias anteriores`;
}

function Resumo({ relatorio }: { relatorio: AiUsageReport }) {
  const { totals, days } = relatorio;
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <dl className="grid grid-cols-3 gap-4">
        <Indicador
          rotulo="Gasto"
          valor={emDolares(totals.costMicros)}
          detalhe={variacao(totals.costMicros, relatorio.previousCostMicros, days)}
        />
        <Indicador rotulo="Chamadas" valor={INTEIRO.format(totals.calls)} />
        <Indicador
          rotulo="Falhas"
          valor={INTEIRO.format(totals.failedCalls)}
          detalhe={`${PORCENTAGEM.format(totals.failedCalls / totals.calls)} das chamadas`}
        />
        <Indicador rotulo="Tokens de entrada" valor={INTEIRO.format(totals.promptTokens)} />
        <Indicador rotulo="Tokens de saída" valor={INTEIRO.format(totals.completionTokens)} />
        <Indicador
          rotulo="Duração média"
          valor={
            totals.avgDurationMs === null ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">sem medição</span>
              </>
            ) : (
              duracao(totals.avgDurationMs)
            )
          }
        />
      </dl>
      <p className="text-miudo text-ink-400">
        De <span className="tabular-nums">{diaCurto(relatorio.from)}</span> a{" "}
        <span className="tabular-nums">{diaCurto(relatorio.to)}</span>, com hoje, em dias no seu
        fuso ({nomeDoFuso(relatorio.timezone)}), registrados pelo Yu-book — não pelo provedor,
        como no Dashboard OpenRouter.
      </p>
    </div>
  );
}

/**
 * Teto e soma que mentem calados, não: a mesma regra do cabeçalho de ajustes.
 * Parte estimada e chamada sem custo ficam ditas junto do número.
 */
function Honestidade({ relatorio }: { relatorio: AiUsageReport }) {
  const { estimatedMicros, callsWithoutCost, costMicros } = relatorio.totals;
  if (estimatedMicros <= 0 && callsWithoutCost <= 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {estimatedMicros > 0 && costMicros > 0 && (
        <Aviso tom="alerta">
          {PORCENTAGEM.format(estimatedMicros / costMicros)} do gasto do período (
          {emDolares(estimatedMicros)}) é estimativa: o provedor não informou o custo dessas
          chamadas, e a conta usou os tokens e o preço do catálogo.
        </Aviso>
      )}
      {callsWithoutCost > 0 && (
        <Aviso tom="alerta">
          {callsWithoutCost === 1
            ? "1 chamada ficou sem custo conhecido"
            : `${INTEIRO.format(callsWithoutCost)} chamadas ficaram sem custo conhecido`}
          : o provedor não informou custo nem tokens, e o registro é zero. O gasto real do
          período está acima da soma — e essas chamadas não contaram no teto diário.
        </Aviso>
      )}
    </div>
  );
}
