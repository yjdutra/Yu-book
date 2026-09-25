import type { OpenRouterKeyInfo, OpenRouterLimitReset } from "@yu-book/shared";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  CHAVE_OPENROUTER,
  useAiAjustes,
  useOpenRouterChave,
  useOpenRouterConta,
  useOpenRouterMetricas,
} from "../../lib/ia";
import { Aviso } from "../base/Aviso";
import { Bloco, Esqueleto, Vazio } from "../base/Bloco";
import { Botao } from "../base/Botao";
import { Etiqueta } from "../base/Etiqueta";
import { IconeRecarregar } from "../Icones";
import { horaNoFuso } from "../rotinas/comum";
import { emDolares } from "./comum";
import { ContaOpenRouter, MetricasOpenRouter, mensagemDeErro } from "./ContaOpenRouter";
import { Indicador } from "./Indicador";

/**
 * Dashboard OpenRouter: o que **o provedor** diz sobre a chave e a conta. Só
 * consulta — nada é gravado, e nenhuma destas leituras passa pelo teto diário,
 * porque nenhuma é cobrada.
 *
 * Três consultas, cada bloco carregando e falhando sozinho. A chave de
 * inferência basta para os três primeiros; os de conta, histórico e métricas
 * dependem da management key, que é opcional — e que nunca sai do servidor: a
 * tela só sabe se ela existe.
 */
export function SecaoOpenRouter() {
  const chave = useOpenRouterChave();
  // O sinal vem pronto na resposta da chave: sem a management key, as duas
  // consultas nem saem. Com `/key` fora do ar o sinal não chega por ali — e aí
  // as duas saem assim mesmo, porque a resposta da conta traz o mesmo sinal. Sem
  // isso, a chave comum recusada apagaria saldo e histórico que não dependem dela.
  const consultarGestao = chave.data?.managementConfigured === true || chave.isError;
  const conta = useOpenRouterConta(consultarGestao);
  const metricas = useOpenRouterMetricas(consultarGestao);
  const comGestao = chave.data
    ? chave.data.managementConfigured
    : chave.isError && conta.data?.managementConfigured !== false;

  return (
    <>
      <BlocosDaChave consulta={chave} />
      {(chave.data || chave.isError) &&
        (comGestao ? (
          <>
            <ContaOpenRouter conta={conta} />
            <MetricasOpenRouter metricas={metricas} />
          </>
        ) : (
          <AvisoSemGestao />
        ))}
    </>
  );
}

function BlocosDaChave({ consulta }: { consulta: ReturnType<typeof useOpenRouterChave> }) {
  const qc = useQueryClient();
  const atualizando = useIsFetching({ queryKey: CHAVE_OPENROUTER }) > 0;
  // A hora é a do relógio de `/ajustes`, não a do navegador, como no resto da
  // área de IA. Fuso ainda não carregado mostra "…".
  const fuso = useAiAjustes().data?.timezone ?? null;

  const acao = (
    <span className="flex items-center gap-2">
      {consulta.data && (
        <span aria-live="polite" className="text-miudo tabular-nums text-ink-400">
          consultado às {fuso ? horaNoFuso(consulta.data.checkedAt, fuso) : "…"}
        </span>
      )}
      <Botao
        variante="fantasma"
        icone={<IconeRecarregar className="size-3.5" />}
        carregando={atualizando}
        onClick={() => void qc.invalidateQueries({ queryKey: CHAVE_OPENROUTER })}
        title="Consulta o provedor de novo, para todos os blocos da seção"
      >
        Atualizar
      </Botao>
    </span>
  );

  if (consulta.isPending) {
    return (
      <>
        <Bloco titulo="Gasto da chave" acao={acao}>
          <Esqueleto linhas={2} alturaLinha={24} />
        </Bloco>
        <div className="grid grid-cols-2 gap-6">
          <Bloco titulo="Teto da chave">
            <Esqueleto linhas={2} />
          </Bloco>
          <Bloco titulo="Modelos gratuitos">
            <Esqueleto linhas={2} />
          </Bloco>
        </div>
      </>
    );
  }

  if (consulta.isError) {
    return (
      <Bloco titulo="Gasto da chave" acao={acao}>
        <div className="px-4 py-3">
          <Aviso tom="erro">{mensagemDeErro(consulta.error)}</Aviso>
        </div>
      </Bloco>
    );
  }

  const info = consulta.data.key;
  if (!consulta.data.configured || !info) {
    // O aviso completo de "sem chave" (RNF-03) está no cabeçalho, em toda seção.
    return (
      <Bloco titulo="Gasto da chave" acao={acao}>
        <Vazio texto="Sem chave de inferência no servidor — não há chave para consultar." />
      </Bloco>
    );
  }

  return (
    <>
      <Bloco titulo="Gasto da chave" acao={acao}>
        <GastoDaChave info={info} />
      </Bloco>
      <div className="grid grid-cols-2 gap-6">
        <Bloco titulo="Teto da chave">
          <TetoDaChave info={info} fuso={fuso} />
        </Bloco>
        <Bloco titulo="Modelos gratuitos">
          <ModelosGratuitos info={info} />
        </Bloco>
      </div>
    </>
  );
}

function GastoDaChave({ info }: { info: OpenRouterKeyInfo }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <dl className="grid grid-cols-4 gap-4">
        <Indicador rotulo="Hoje" valor={emDolares(info.usageDailyMicros)} />
        <Indicador rotulo="Semana" valor={emDolares(info.usageWeeklyMicros)} />
        <Indicador rotulo="Mês" valor={emDolares(info.usageMonthlyMicros)} />
        <Indicador rotulo="Total" valor={emDolares(info.usageMicros)} />
      </dl>
      {/* Dito por extenso porque o "Gasto de hoje" do cabeçalho conta no fuso
          do usuário, e os dois números podem discordar perto da meia-noite. */}
      <p className="text-miudo text-ink-400">
        Contado pelo provedor, com dia, semana e mês em UTC — não no seu fuso, como o gasto de
        hoje do cabeçalho.
        {info.label && <> Chave: {info.label}.</>}
      </p>
      {info.byokUsageMicros > 0 && (
        <p className="text-xs text-ink-400">
          Com chave própria de provedor (BYOK):{" "}
          <span className="tabular-nums text-ink-200">{emDolares(info.byokUsageMicros)}</span> no
          total,{" "}
          <span className="tabular-nums text-ink-200">
            {emDolares(info.byokUsageMonthlyMicros)}
          </span>{" "}
          no mês.
        </p>
      )}
    </div>
  );
}

const RENOVACAO: Record<OpenRouterLimitReset, string> = {
  daily: "Renova a cada dia.",
  weekly: "Renova a cada semana.",
  monthly: "Renova a cada mês.",
};

function TetoDaChave({ info, fuso }: { info: OpenRouterKeyInfo; fuso: string | null }) {
  const expira = info.expiresAt && (
    <p className="text-xs text-ink-400">
      Expira em{" "}
      <span className="tabular-nums text-ink-200">
        {fuso ? dataHoraNoFuso(info.expiresAt, fuso) : "…"}
      </span>
      .
    </p>
  );

  if (info.limitMicros === null) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-sm text-ink-200">Sem teto na chave.</p>
        <p className="text-xs text-ink-400">
          O único freio de gasto é o teto diário do Yu-book, em Gasto.
        </p>
        {expira}
      </div>
    );
  }

  const restante = info.limitRemainingMicros;
  const fracao =
    restante !== null && info.limitMicros > 0
      ? Math.min(Math.max(restante / info.limitMicros, 0), 1)
      : 0;

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {/* O texto é o dado; a barra só o desenha (RNF-09) — o mesmo desenho do
          gasto de hoje no cabeçalho. */}
      <p className="text-sm tabular-nums text-ink-200">
        {restante !== null ? emDolares(restante) : "?"}
        <span className="text-ink-400"> restantes de {emDolares(info.limitMicros)}</span>
      </p>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-linear-to-r from-accent-500 to-ia-500"
          style={{ width: `${fracao * 100}%` }}
        />
      </div>
      <p className="text-xs text-ink-400">
        {info.limitReset ? RENOVACAO[info.limitReset] : "Não renova sozinho."}
        {info.byokUsageMicros > 0 &&
          (info.includeByokInLimit
            ? " O gasto com chave própria (BYOK) conta no teto."
            : " O gasto com chave própria (BYOK) não conta no teto.")}
      </p>
      {expira}
    </div>
  );
}

function ModelosGratuitos({ info }: { info: OpenRouterKeyInfo }) {
  const cota = info.freeModelRequests;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {cota ? (
        <>
          <p className="text-sm text-ink-200">
            <span className="tabular-nums">{cota.used}</span> de{" "}
            <span className="tabular-nums">{cota.limit}</span> requisições hoje (UTC)
          </p>
          <p className="text-xs text-ink-400">
            Restam <span className="tabular-nums">{cota.remaining}</span> até o dia virar em UTC.
          </p>
        </>
      ) : (
        <p className="text-xs text-ink-400">
          O provedor não informou a cota de modelos gratuitos.
        </p>
      )}
      {info.isFreeTier && (
        <span>
          <Etiqueta titulo="O provedor classifica esta conta como free tier">free tier</Etiqueta>
        </span>
      )}
      {/* A cota não diz se o Yu-book alcança esses modelos: com o treino
          desligado em Provedor, os endpoints gratuitos ficam de fora. */}
    </div>
  );
}

function AvisoSemGestao() {
  return (
    <Aviso tom="info">
      <p>
        Saldo da conta, histórico dos últimos 30 dias e métricas precisam de uma{" "}
        <strong>management key</strong> do OpenRouter.
      </p>
      <p className="mt-1">
        Crie uma em{" "}
        <a
          href="https://openrouter.ai/settings/management-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          openrouter.ai/settings/management-keys
          <span className="sr-only">, abre em outra aba</span>
        </a>{" "}
        e defina <code>OPENROUTER_MANAGEMENT_KEY</code> no ambiente da API. Ela fica só no
        servidor e nunca chega ao navegador — a API a usa apenas para ler.
      </p>
    </Aviso>
  );
}

/** "25 de set. de 2026, 14:30" no fuso de `/ajustes`, com ano: a expiração pode estar longe. */
function dataHoraNoFuso(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: fuso,
  }).format(new Date(iso));
}
