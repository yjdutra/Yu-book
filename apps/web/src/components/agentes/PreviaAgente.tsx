import { MAX_PASSOS_DO_LACO } from "@yu-book/shared";
import type { AgentContextBlock, AgentPreview } from "@yu-book/shared";
import { ApiError } from "../../lib/api";
import { emDolares } from "../ajustes/comum";
import { Aviso } from "../base/Aviso";
import { IconeBoard, IconeCheck, IconeInfo, IconeNotas } from "../Icones";

const NUMERO = new Intl.NumberFormat("pt-BR");

/** O papel de cada bloco, por extenso — o ícone acompanha, não substitui. */
const TIPO: Record<AgentContextBlock["kind"], string> = {
  regras: "regras do Yu-book",
  instrucoes: "instruções",
  nota: "nota-base",
  fonte: "fonte viva",
};

/**
 * O estado de cada bloco em palavra e glifo (RNF-09): "cortado" é o que não
 * coube e ficou de fora — dito, não omitido (RNF-04).
 */
const ESTADO: Record<
  AgentContextBlock["status"],
  { texto: string; classe: string; glifo: string }
> = {
  incluido: { texto: "entra", classe: "text-emerald-300", glifo: "✓" },
  cortado: { texto: "cortado — não coube", classe: "text-amber-300", glifo: "✂" },
  lixeira: { texto: "na lixeira — fica fora", classe: "text-amber-300", glifo: "⌫" },
  indisponivel: { texto: "coluna não existe mais", classe: "text-red-300", glifo: "!" },
};

function IconeDoBloco({ kind }: { kind: AgentContextBlock["kind"] }) {
  if (kind === "nota") return <IconeNotas className="size-3.5" />;
  if (kind === "fonte") return <IconeBoard className="size-3.5" />;
  if (kind === "regras") return <IconeCheck className="size-3.5" />;
  return <IconeInfo className="size-3.5" />;
}

/** O esqueleto tem a forma da prévia pronta: nada salta quando ela chega. */
function EsqueletoPrevia() {
  return (
    <div aria-hidden="true" className="space-y-3 p-4">
      <div className="h-2 animate-pulse rounded-full bg-ink-800" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-controle bg-ink-800" />
        ))}
      </div>
      <div className="h-14 animate-pulse rounded-controle bg-ink-800" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-6 animate-pulse rounded-etiqueta bg-ink-800" />
      ))}
    </div>
  );
}

function Numero({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="rounded-controle border border-ink-800 bg-ink-900/60 px-2.5 py-2" title={dica}>
      <p className="text-miudo text-ink-400">{rotulo}</p>
      <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-ink-200">{valor}</p>
    </div>
  );
}

/**
 * "O que o agente recebe" (Etapa D da IA): a mesma montagem que o chat faz a
 * cada mensagem, feita sobre o rascunho, antes de salvar. É o preço e o
 * conteúdo à vista — quem escolhe dez notas-base vê o que isso custa por
 * mensagem, e vê o que não coube.
 */
export function PreviaAgente({
  previa,
  carregando,
  atualizando,
  erro,
}: {
  previa: AgentPreview | undefined;
  carregando: boolean;
  atualizando: boolean;
  erro: unknown;
}) {
  const uso = previa ? Math.min(previa.premisesChars / Math.max(previa.premisesLimit, 1), 1) : 0;
  const custo = previa?.costPerStepMicros ?? null;

  return (
    <section
      aria-labelledby="previa-titulo"
      className="relative overflow-hidden rounded-cartao border border-ink-800 bg-superficie
                 shadow-e1"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-accent-500 to-ia-500"
      />
      <header className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <h3 id="previa-titulo" className="rotulo">
          O que o agente recebe
        </h3>
        {/* Lido quando muda, sem roubar a vez: a prévia se refaz a cada pausa. */}
        <span aria-live="polite" className="ml-auto text-miudo text-ink-400">
          {atualizando ? "atualizando…" : ""}
        </span>
      </header>

      {erro ? (
        <div className="p-4">
          <Aviso tom="erro">
            {erro instanceof ApiError ? erro.message : "Não foi possível montar a prévia."}
          </Aviso>
        </div>
      ) : carregando && !previa ? (
        <EsqueletoPrevia />
      ) : previa ? (
        <div
          className={`space-y-4 p-4 transition-opacity duration-[160ms] ${
            atualizando ? "opacity-70" : ""
          }`}
        >
          <div>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink-400">Premissas</span>
              <span className="tabular-nums text-ink-200">
                {NUMERO.format(previa.premisesChars)}
                <span className="text-ink-400"> de {NUMERO.format(previa.premisesLimit)}</span>
              </span>
            </div>
            {/* O texto acima é o dado; a barra só o desenha (RNF-09). */}
            <div
              aria-hidden="true"
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-[240ms]
                            ease-(--ease-saida) ${
                  previa.cut.length > 0
                    ? "bg-amber-500"
                    : "bg-linear-to-r from-accent-500 to-ia-500"
                }`}
                style={{ width: `${uso * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Numero rotulo="Caracteres" valor={NUMERO.format(previa.chars)} />
            <Numero
              rotulo="Tokens"
              valor={`~${NUMERO.format(previa.tokens)}`}
              dica="Aproximação de quatro caracteres por token, a mesma do teto de gasto"
            />
          </div>

          <div className="rounded-controle border border-ia-500/25 bg-linear-to-r from-accent-500/5
                          to-ia-500/5 px-3 py-2.5">
            <p className="text-miudo text-ink-400">Custo estimado por mensagem</p>
            {custo === null ? (
              <p className="mt-0.5 text-sm text-ink-200">sem modelo utilizável</p>
            ) : (
              <p className="mt-0.5 text-sm font-medium tabular-nums text-titulo">
                {emDolares(custo)} a {emDolares(custo * MAX_PASSOS_DO_LACO)}
              </p>
            )}
            <p className="mt-1 text-miudo text-ink-400">
              {previa.modelName ?? previa.modelId ?? "modelo do chat"} · de 1 a{" "}
              {MAX_PASSOS_DO_LACO} passos por mensagem, cada um com este contexto e a resposta
              máxima.
            </p>
          </div>

          {previa.warnings.map((w) => (
            <Aviso key={w} tom="alerta">
              {w}
            </Aviso>
          ))}

          <div>
            <p className="rotulo mb-1.5">Na ordem em que entram</p>
            <ol className="space-y-1">
              {previa.blocks.map((b, i) => {
                const estado = ESTADO[b.status];
                return (
                  <li
                    key={`${b.kind}-${b.title}-${i}`}
                    className={`flex items-center gap-2 rounded-etiqueta px-1.5 py-1 text-xs ${
                      b.status === "incluido" ? "" : "bg-ink-900/60"
                    }`}
                  >
                    <span className="text-ink-400">
                      <IconeDoBloco kind={b.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate ${
                          b.status === "incluido" ? "text-ink-200" : "text-ink-400 line-through"
                        }`}
                        title={b.title}
                      >
                        {b.title}
                      </span>
                      <span className="block text-miudo text-ink-400">
                        {TIPO[b.kind]} · {NUMERO.format(b.chars)} car.
                      </span>
                    </span>
                    <span className={`shrink-0 text-miudo ${estado.classe}`}>
                      <span aria-hidden="true">{estado.glifo} </span>
                      {estado.texto}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {previa.cut.length > 0 && (
            <Aviso tom="alerta">
              Não coube em {NUMERO.format(previa.premisesLimit)} caracteres e fica de fora:{" "}
              {previa.cut.join(", ")}. O corte é por bloco inteiro, na ordem da lista: o que não
              cabe fica de fora, e os seguintes ainda podem entrar. Encurte uma nota ou suba a
              que importa mais.
            </Aviso>
          )}

          <details className="group rounded-controle border border-ink-800">
            <summary
              className="cursor-pointer select-none rounded-controle px-3 py-2 text-xs text-ink-400
                         transition-colors hover:text-ink-200"
            >
              Ver texto completo
            </summary>
            <pre
              className="max-h-96 overflow-auto border-t border-ink-800 px-3 py-2 font-mono
                         text-miudo leading-relaxed whitespace-pre-wrap text-ink-200"
            >
              {previa.system}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
