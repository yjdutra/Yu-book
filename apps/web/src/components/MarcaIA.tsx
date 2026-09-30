import type { AiCompletion, AiMark } from "@yu-book/shared";
import { useNavigate } from "react-router-dom";
import { useAcoesChat } from "../lib/sessaoChat";
import { Etiqueta } from "./base/Etiqueta";
import { IconeAssistente, IconeCheck } from "./Icones";

/**
 * A marca de conteúdo gerado por IA (Etapa C da frente de IA).
 *
 * O NO2 do PRD de IA só permite nota escrita por modelo **marcada no dado**; a
 * marca vem do servidor e a tela só a mostra — nada aqui a cria nem a apaga.
 * Duas formas: a compacta, que mora junto de tipo e tags nas listas, e a faixa,
 * que mora sob o cabeçalho de nota e card com o detalhe inteiro.
 *
 * RNF-09 da IA: a marca não depende de cor. Tem a faísca **e** a palavra, e o
 * estado "revisada" é texto, não um tom diferente.
 *
 * "Revisada" quer dizer editada depois de gerada, e não "à mão": o formatar
 * com IA gravado pelo autosave também marca `revisedAt`. O texto não afirma
 * quem editou.
 */

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/**
 * "24 set", ou "24 set 2025" fora do ano corrente. O instante é mostrado no
 * fuso do navegador: é uma data de exibição, não um prazo — o espelhamento de
 * fuso da skill `contrato-compartilhado` §4.5 não se aplica a instante.
 */
function diaCurto(iso: string): string {
  const d = new Date(iso);
  const base = `${d.getDate()} ${MESES[d.getMonth()] ?? ""}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

const VIA: Record<AiMark["via"], string> = {
  chat: "via chat",
  mcp: "via MCP",
  rotina: "via rotina",
};

/** O detalhe por extenso — a dica da forma compacta. */
export function descricaoMarca(marca: AiMark): string {
  const rotina = marca.routineName ? ` · rotina «${marca.routineName}»` : "";
  const agente = marca.agentName ? ` · «${marca.agentName}»` : "";
  const autor = marca.author ? ` — ${marca.author}` : "";
  const revisada = marca.revisedAt ? `; revisada em ${diaCurto(marca.revisedAt)}` : "";
  const quando = diaCurto(marca.generatedAt);
  return `Gerada por IA${rotina}${agente}${autor}, ${VIA[marca.via]}, ${quando}${revisada}`;
}

/**
 * A pílula das listas. `curta` tira o "· revisada" onde não cabe — a face do
 * card no quadro —, e o detalhe continua na dica e no painel.
 */
export function MarcaIA({ marca, curta = false }: { marca: AiMark; curta?: boolean }) {
  const revisada = Boolean(marca.revisedAt);
  const visivel = revisada && !curta ? "IA · revisada" : "IA";
  return (
    <Etiqueta
      tom="ia"
      titulo={descricaoMarca(marca)}
      icone={<IconeAssistente className="size-3" />}
    >
      {/* O "IA" visível lido em voz alta vira sigla solta; o leitor de tela
          ouve a frase. */}
      <span aria-hidden="true">{visivel}</span>
      <span className="sr-only">
        {revisada ? "gerada por IA, editada depois de gerada" : "gerada por IA"}
      </span>
    </Etiqueta>
  );
}

/**
 * A faixa sob o cabeçalho de nota e card. Discreta, sem animação: ela aparece
 * a cada abertura, e o que se repete não pode chamar atenção.
 *
 * "Abrir conversa" só existe quando a conversa ainda existe — apagar a conversa
 * zera o `conversationId`, a marca fica. Abre no painel lateral, e não na rota
 * `/assistente`: a conversa fica ao lado da nota que saiu dela. A rota não tem
 * id de conversa; a sessão é quem escolhe qual se mostra.
 *
 * Etapa E: o que uma rotina criou diz «Rotina» · «Agente» e leva à execução
 * ("Ver execução"). A marca guarda a execução, não a rotina — ela pode ter
 * sido excluída —, e por isso a rota é `/assistente/execucoes/:runId`, que não
 * precisa da rotina.
 */
export function FaixaIA({ marca }: { marca: AiMark }) {
  const { selecionar, abrirPainel } = useAcoesChat();
  const navigate = useNavigate();
  const conversa = marca.conversationId;
  const execucao = marca.runId;
  return (
    <div
      role="note"
      aria-label="Origem do conteúdo"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-controle border
                 border-ia-500/25 bg-linear-to-r from-accent-500/10 to-ia-500/10 px-3 py-1.5
                 text-xs text-ink-400"
    >
      <IconeAssistente className="size-3.5 text-accent-400" />
      <span className="font-medium text-ink-200">Gerada por IA</span>
      {marca.routineName && (
        <>
          <Separador />
          <span className="max-w-[24ch] truncate text-ink-200" title={marca.routineName}>
            <span className="sr-only">rotina </span>«{marca.routineName}»
          </span>
        </>
      )}
      {/* Etapa D: o agente que escreveu, guardado como texto — sobrevive à
          exclusão dele, como a conversa guarda o nome. */}
      {marca.agentName && (
        <>
          <Separador />
          <span className="max-w-[24ch] truncate text-ink-200" title={marca.agentName}>
            «{marca.agentName}»
          </span>
        </>
      )}
      {marca.author && (
        <>
          <Separador />
          <span className="max-w-[24ch] truncate font-mono text-miudo" title={marca.author}>
            {marca.author}
          </span>
        </>
      )}
      <Separador />
      <span>{VIA[marca.via]}</span>
      <Separador />
      <time dateTime={marca.generatedAt}>{diaCurto(marca.generatedAt)}</time>
      {marca.revisedAt && (
        <>
          <Separador />
          <span className="text-ink-200">
            revisada em <time dateTime={marca.revisedAt}>{diaCurto(marca.revisedAt)}</time>
          </span>
        </>
      )}
      {conversa && (
        <button
          type="button"
          onClick={() => {
            selecionar(conversa);
            abrirPainel();
          }}
          className="ml-auto rounded-etiqueta px-1 text-accent-400 underline decoration-accent-400/40
                     underline-offset-2 transition-colors hover:text-titulo
                     hover:decoration-current"
        >
          Abrir conversa
        </button>
      )}
      {execucao && (
        <button
          type="button"
          onClick={() => navigate(`/assistente/execucoes/${execucao}`)}
          className={`${conversa ? "" : "ml-auto "}rounded-etiqueta px-1 text-accent-400 underline
                      decoration-accent-400/40 underline-offset-2 transition-colors
                      hover:text-titulo hover:decoration-current`}
        >
          Ver execução
        </button>
      )}
    </div>
  );
}

/**
 * A conclusão do card no painel (frente de cards, Parte 1). Mora aqui por
 * dividir com a faixa o dia curto e o "via": quando quem concluiu foi um
 * modelo — pelo chat ou por um cliente MCP —, é uma marca da mesma família — mas **não** é a de geração. Esta
 * acompanha o estado e some ao reabrir, por isso é linha solta e não faixa.
 */
export function LinhaConclusao({
  completedAt,
  marca,
}: {
  completedAt: string;
  marca: AiCompletion | null;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-400">
      <IconeCheck className="size-3.5 text-emerald-300" />
      <span className="text-ink-200">
        Concluído em <time dateTime={completedAt}>{diaCurto(completedAt)}</time>
      </span>
      {marca && (
        <>
          <Separador />
          <span className="inline-flex items-center gap-1">
            <IconeAssistente className="size-3 text-accent-400" />
            por IA
          </span>
          {marca.agentName && (
            <>
              <Separador />
              <span className="max-w-[24ch] truncate text-ink-200" title={marca.agentName}>
                «{marca.agentName}»
              </span>
            </>
          )}
          <Separador />
          <span>{VIA[marca.via]}</span>
        </>
      )}
    </p>
  );
}

function Separador() {
  return (
    <span aria-hidden="true" className="text-ink-400/60">
      ·
    </span>
  );
}
