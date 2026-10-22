import { microsParaDolares } from "@yu-book/shared";
import type { AiProvider, TarefaComModelo } from "@yu-book/shared";

/**
 * As seções de `/ajustes`, na ordem do painel contextual. Moram aqui, e não na
 * página, porque o painel contextual é carregado sempre e a página, sob
 * demanda: importar da página a traria inteira para o bundle inicial.
 */
export const SECOES_DE_AJUSTES = [
  { caminho: "modelos", titulo: "Modelos" },
  { caminho: "provedor", titulo: "Provedor" },
  { caminho: "gasto", titulo: "Gasto" },
  { caminho: "claude", titulo: "Custo do Claude" },
  { caminho: "openrouter", titulo: "Dashboard OpenRouter" },
  { caminho: "uso", titulo: "AI usage dash" },
] as const;

/**
 * Uma coluna de escolha por tarefa de IA.
 *
 * **Derivado de `TAREFAS_COM_MODELO`, e não escrito à mão.** A Etapa B
 * acrescentou a tarefa `chat` ao enum e ao servidor, e esta tela continuou com `formatar`
 * fixo numa constante — resultado: o chat exigia um modelo que não havia por
 * onde escolher, e a mensagem mandava o usuário para uma tela que não tinha o
 * controle. Derivando da lista, a próxima tarefa aparece aqui sozinha — e o
 * `Record` total faz o compilador cobrar o rótulo dela.
 */
export const ROTULO_DA_TAREFA: Record<TarefaComModelo, { titulo: string; usa: string }> = {
  formatar: { titulo: "formatar", usa: "o botão de formatar nota" },
  chat: { titulo: "chat", usa: "o painel do assistente (Ctrl+Shift+Y)" },
};
// `rotina` não tem coluna (Etapa E): cada passo usa o modelo do agente, ou o
// do chat. A lista é `TAREFAS_COM_MODELO`, não `AI_TASKS` — ver `enums.ts`.

/// Tarefas que só funcionam com modelo capaz de chamar ferramenta. O chat sem
/// isso conversa bem e não consegue consultar o acervo — e falharia no meio,
/// depois de a chamada já ter sido paga.
export const EXIGE_FERRAMENTA: ReadonlySet<TarefaComModelo> = new Set<TarefaComModelo>([
  "chat",
]);

/** O modelo pode servir a esta tarefa? A recusa é a mesma no arraste e no menu. */
export function podeServir(
  modelo: { supportsTools: boolean },
  tarefa: TarefaComModelo,
): boolean {
  return !EXIGE_FERRAMENTA.has(tarefa) || modelo.supportsTools;
}

export const MOTIVO_SEM_FERRAMENTA = "Este modelo não chama ferramentas";

const DINHEIRO = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function emDolares(micros: number): string {
  return DINHEIRO.format(microsParaDolares(micros));
}

const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * Duração de uma resposta: "850 ms", "3 s", "12,4 s". A mesma escala para a
 * latência do provedor e para a duração que o Yu-book grava em `ai_usage`.
 */
export function duracao(ms: number): string {
  return ms >= 1000 ? `${DECIMAL.format(ms / 1000)} s` : `${INTEIRO.format(ms)} ms`;
}

/** Contexto em milhares, como o provedor costuma anunciar. */
export function contexto(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

/**
 * A linha de origem do modelo no cartão. **O provedor segue o modelo**
 * (docs/plano-provedor-anthropic.md): quem atende é o campo `provider`, não o
 * prefixo do id. No OpenRouter o prefixo continua dizendo de quem é o modelo
 * (`anthropic/claude-…` é um Claude servido pelo OpenRouter, cobrado lá).
 */
export function provedorDe(modelo: { id: string; provider?: AiProvider }): string {
  if (modelo.provider === "anthropic") return "Anthropic · créditos do Claude";
  const dono = modelo.id.includes("/") ? (modelo.id.split("/")[0] ?? "") : "";
  return dono ? `via OpenRouter · ${dono}` : "via OpenRouter";
}
