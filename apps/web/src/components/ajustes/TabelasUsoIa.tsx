import type {
  AiCostSource,
  AiTask,
  AiUsageByCostSource,
  AiUsageByModel,
  AiUsageByTask,
  AiUsageCall,
  AiUsageError,
} from "@yu-book/shared";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { avisoDeEspera, useAcoesChat } from "../../lib/sessaoChat";
import { Aviso } from "../base/Aviso";
import { Etiqueta } from "../base/Etiqueta";
import { IconeAlerta, IconeCheck } from "../Icones";
import { horaNoFuso } from "../rotinas/comum";
import { diaCurto } from "./BarrasPorDia";
import { duracao, emDolares, ROTULO_DA_TAREFA } from "./comum";

/**
 * As tabelas do AI usage dash (`SecaoUsoIa`). Separadas só pelo tamanho: não
 * têm outro consumidor.
 */

export const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
export const PORCENTAGEM = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

/// `ROTULO_DA_TAREFA` cobre só as tarefas com coluna de modelo; `rotina` não
/// tem (cada passo usa o modelo do agente), mas gasta e aparece aqui. O
/// `Record` total cobra o rótulo de uma tarefa nova.
const ROTULO_DE_TAREFA: Record<AiTask, string> = {
  formatar: ROTULO_DA_TAREFA.formatar.titulo,
  chat: ROTULO_DA_TAREFA.chat.titulo,
  rotina: "rotina",
};

const ORIGEM: Record<AiCostSource, { rotulo: string; frase: string }> = {
  provedor: { rotulo: "provedor", frase: "o provedor informou o custo" },
  estimado: {
    rotulo: "estimado",
    frase: "o provedor mandou só os tokens; a conta usou o preço do catálogo",
  },
  desconhecido: {
    rotulo: "desconhecido",
    frase: "nem custo nem tokens; gravado como zero, fora do teto",
  },
};

const CELULA = "py-1.5 pl-3 text-right tabular-nums text-ink-200";
const LINHA = "border-b border-ink-800 last:border-0";
const CABECA_DE_LINHA = "py-1.5 pr-3 text-left font-normal text-ink-200";

const TEXTO = "py-1.5 pl-3 text-left text-ink-200";

function Tabela({
  legenda,
  colunas,
  textuais = [],
  children,
}: {
  /** Nome da tabela para o leitor de tela; quem vê tem o título do bloco. */
  legenda: string;
  /** A primeira é o cabeçalho de linha, à esquerda; as demais, numéricas, à direita. */
  colunas: string[];
  /** Índices, além da primeira, de colunas de texto — alinhadas à esquerda. */
  textuais?: number[];
  children: ReactNode;
}) {
  return (
    // Rola sozinha se o id do modelo for comprido: o `Bloco` corta o que passa
    // da borda.
    <div className="overflow-x-auto px-4 py-3">
      <table className="w-full text-xs">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr className="border-b border-ink-800">
            {colunas.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`py-1.5 font-medium text-ink-400 ${
                  i === 0 ? "pr-3" : "pl-3"
                } ${i === 0 || textuais.includes(i) ? "text-left" : "text-right"}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TabelaPorModelo({ linhas }: { linhas: AiUsageByModel[] }) {
  return (
    <Tabela
      legenda="Uso por modelo"
      colunas={["Modelo", "Chamadas", "Falhas", "Entrada", "Saída", "Duração média", "Custo"]}
    >
      {linhas.map((m) => (
        <tr key={m.model} className={LINHA}>
          <th scope="row" className={`${CABECA_DE_LINHA} font-mono break-all`}>
            {m.model}
          </th>
          <td className={CELULA}>{INTEIRO.format(m.calls)}</td>
          <td className={CELULA}>{INTEIRO.format(m.failedCalls)}</td>
          <td className={CELULA}>{INTEIRO.format(m.promptTokens)}</td>
          <td className={CELULA}>{INTEIRO.format(m.completionTokens)}</td>
          <td className={CELULA}>{duracao(m.avgDurationMs)}</td>
          <td className={CELULA}>{emDolares(m.costMicros)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

export function TabelaPorTarefa({ linhas }: { linhas: AiUsageByTask[] }) {
  return (
    <Tabela legenda="Uso por tarefa" colunas={["Tarefa", "Chamadas", "Falhas", "Custo"]}>
      {linhas.map((t) => (
        <tr key={t.task} className={LINHA}>
          <th scope="row" className={CABECA_DE_LINHA}>
            {ROTULO_DE_TAREFA[t.task]}
          </th>
          <td className={CELULA}>{INTEIRO.format(t.calls)}</td>
          <td className={CELULA}>{INTEIRO.format(t.failedCalls)}</td>
          <td className={CELULA}>{emDolares(t.costMicros)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

export function TabelaPorOrigem({ linhas }: { linhas: AiUsageByCostSource[] }) {
  return (
    <Tabela legenda="Uso por origem do custo" colunas={["Origem", "Chamadas", "Custo"]}>
      {linhas.map((o) => (
        <tr key={o.source} className={LINHA}>
          <th scope="row" className={CABECA_DE_LINHA}>
            {ORIGEM[o.source].rotulo}
            <span className="block text-miudo text-ink-400">{ORIGEM[o.source].frase}</span>
          </th>
          <td className={`${CELULA} align-top`}>{INTEIRO.format(o.calls)}</td>
          <td className={`${CELULA} align-top`}>{emDolares(o.costMicros)}</td>
        </tr>
      ))}
    </Tabela>
  );
}

/**
 * Até cinco códigos. A diferença para o total de falhas é dita, não escondida:
 * falha gravada sem código não entra na lista do servidor, e as que passam do
 * quinto código também não.
 */
export function TabelaDeErros({ erros, falhas }: { erros: AiUsageError[]; falhas: number }) {
  const listadas = erros.reduce((soma, e) => soma + e.calls, 0);
  const outras = falhas - listadas;
  return (
    <>
      {erros.length > 0 && (
        <Tabela legenda="Erros mais comuns" colunas={["Código", "Chamadas"]}>
          {erros.map((e) => (
            <tr key={e.code} className={LINHA}>
              <th scope="row" className={`${CABECA_DE_LINHA} font-mono`}>
                {e.code}
              </th>
              <td className={CELULA}>{INTEIRO.format(e.calls)}</td>
            </tr>
          ))}
        </Tabela>
      )}
      {outras > 0 && (
        <p className={`px-4 text-xs text-ink-400 ${erros.length > 0 ? "pb-3" : "py-3"}`}>
          {outras === 1 ? "Outra falha" : `Outras ${INTEIRO.format(outras)} falhas`}: sem código
          gravado ou fora dos cinco códigos mais frequentes.
        </p>
      )}
    </>
  );
}

export function UltimasChamadas({ chamadas, fuso }: { chamadas: AiUsageCall[]; fuso: string }) {
  const { selecionar, abrirPainel, temFluxo } = useAcoesChat();
  /** Pediu-se uma conversa enquanto outra resposta chegava. */
  const [esperando, setEsperando] = useState(false);

  /**
   * Abre a conversa no painel, como "Abrir conversa" da `FaixaIA`. Com uma
   * resposta chegando, **não troca a conversa**: ela sumiria da tela e o laço
   * seguiria pago sem ninguém vendo (INV-56). Mostra a resposta em curso e diz
   * por que não trocou — o desvio de `agentes/acoesDoAgente.tsx`. Aqui é
   * sempre `/ajustes`, nunca a tela do chat: o painel existe, e abri-lo basta.
   */
  const abrirConversa = (id: string) => {
    if (temFluxo()) {
      setEsperando(true);
      abrirPainel();
      return;
    }
    setEsperando(false);
    selecionar(id);
    abrirPainel();
  };

  return (
    <>
      {/* Entra na tela já preenchido: sem `urgente`, o `status` passaria calado. */}
      {esperando && (
        <div className="px-4 pt-3">
          <Aviso tom="alerta" urgente onFechar={() => setEsperando(false)}>
            {avisoDeEspera(null)}
          </Aviso>
        </div>
      )}
      <Tabela
        legenda="Últimas chamadas ao provedor"
        colunas={[
          "Quando",
          "Tarefa",
          "Modelo",
          "Tokens",
          "Custo",
          "Duração",
          "Status",
          "Origem",
        ]}
        textuais={[1, 2, 6, 7]}
      >
        {chamadas.map((c) => (
          <Chamada key={c.id} chamada={c} fuso={fuso} onConversa={abrirConversa} />
        ))}
      </Tabela>
      <p className="px-4 pb-3 text-miudo text-ink-400">
        As {INTEIRO.format(chamadas.length)} mais recentes do período, até 50. Tokens são entrada
        → saída.
      </p>
    </>
  );
}

function Chamada({
  chamada: c,
  fuso,
  onConversa,
}: {
  chamada: AiUsageCall;
  fuso: string;
  onConversa: (id: string) => void;
}) {
  return (
    <tr className={LINHA}>
      {/* O dia é o gravado (`localDay`, INV-50), o mesmo que o teto contou e o
          que cai dentro de `from`–`to`. A hora sai de `createdAt` no fuso de
          `/ajustes` de hoje, nunca no do navegador. Depois de uma troca de
          fuso, o dia de `createdAt` recalculado no fuso novo pode divergir do
          gravado perto da meia-noite — por isso o dia não é recalculado. */}
      <th scope="row" className={`${CABECA_DE_LINHA} whitespace-nowrap tabular-nums`}>
        <time dateTime={c.createdAt}>
          {diaCurto(c.localDay)} {horaNoFuso(c.createdAt, fuso)}
        </time>
      </th>
      <td className={TEXTO}>{ROTULO_DE_TAREFA[c.task]}</td>
      <td className={`${TEXTO} font-mono break-all`}>{c.model}</td>
      <td className={`${CELULA} whitespace-nowrap`}>
        {INTEIRO.format(c.promptTokens)}
        <span aria-hidden="true"> → </span>
        <span className="sr-only"> de entrada, </span>
        {INTEIRO.format(c.completionTokens)}
        <span className="sr-only"> de saída</span>
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>
        <span className="inline-flex items-center gap-1.5">
          {emDolares(c.costMicros)}
          {c.costSource !== "provedor" && (
            <Etiqueta titulo={ORIGEM[c.costSource].frase}>{ORIGEM[c.costSource].rotulo}</Etiqueta>
          )}
        </span>
      </td>
      <td className={`${CELULA} whitespace-nowrap`}>{duracao(c.durationMs)}</td>
      <td className={`${TEXTO} whitespace-nowrap`}>
        <Status chamada={c} />
      </td>
      <td className={`${TEXTO} whitespace-nowrap`}>
        <Origem chamada={c} onConversa={onConversa} />
      </td>
    </tr>
  );
}

/** Texto sempre — "ok" ou o código —, com o glifo ao lado; nunca só cor (RNF-09). */
function Status({ chamada: c }: { chamada: AiUsageCall }) {
  if (c.ok) {
    return (
      <span className="inline-flex items-center gap-1">
        <IconeCheck className="size-3 text-ink-400" />
        ok
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-300">
      <IconeAlerta className="size-3" />
      <span className="font-mono">{c.errorCode ?? "falhou"}</span>
    </span>
  );
}

const LINK_DE_ORIGEM = `rounded-etiqueta px-0.5 text-accent-400 underline decoration-accent-400/40
                        underline-offset-2 transition-colors hover:text-titulo
                        hover:decoration-current`;

/**
 * O que a chamada serviu. Nota e execução têm rota; a conversa, não — a tela
 * do chat não tem id de conversa. Ela abre como em "Abrir conversa" da
 * `FaixaIA`: a sessão escolhe a conversa e o painel lateral a mostra, ao lado
 * desta tela. O id só chega aqui se o vínculo existe: apagar nota, conversa ou
 * execução zera a coluna (`SetNull`), e o registro de gasto fica.
 */
function Origem({
  chamada: c,
  onConversa,
}: {
  chamada: AiUsageCall;
  onConversa: (id: string) => void;
}) {
  const conversa = c.conversationId;
  const partes: ReactNode[] = [];
  if (c.noteId) {
    partes.push(
      <Link key="nota" to={`/n/${c.noteId}`} className={LINK_DE_ORIGEM}>
        nota
      </Link>,
    );
  }
  if (conversa) {
    partes.push(
      <button
        key="conversa"
        type="button"
        onClick={() => onConversa(conversa)}
        className={LINK_DE_ORIGEM}
      >
        conversa
      </button>,
    );
  }
  if (c.runId) {
    partes.push(
      <Link key="execucao" to={`/assistente/execucoes/${c.runId}`} className={LINK_DE_ORIGEM}>
        execução
      </Link>,
    );
  }
  if (partes.length === 0) {
    return (
      <>
        <span aria-hidden="true" className="text-ink-400">
          —
        </span>
        <span className="sr-only">sem vínculo</span>
      </>
    );
  }
  return <span className="inline-flex items-center gap-1">{partes}</span>;
}
