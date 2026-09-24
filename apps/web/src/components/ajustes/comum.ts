import { microsParaDolares } from "@yu-book/shared";
import type { AiTask } from "@yu-book/shared";

/**
 * As seções de `/ajustes`, na ordem do painel contextual. Moram aqui, e não na
 * página, porque o painel contextual é carregado sempre e a página, sob
 * demanda: importar da página a traria inteira para o bundle inicial.
 */
export const SECOES_DE_AJUSTES = [
  { caminho: "modelos", titulo: "Modelos" },
  { caminho: "provedor", titulo: "Provedor" },
  { caminho: "gasto", titulo: "Gasto" },
] as const;

/**
 * Uma coluna de escolha por tarefa de IA.
 *
 * **Derivado de `AI_TASKS`, e não escrito à mão.** A Etapa B acrescentou a
 * tarefa `chat` ao enum e ao servidor, e esta tela continuou com `formatar`
 * fixo numa constante — resultado: o chat exigia um modelo que não havia por
 * onde escolher, e a mensagem mandava o usuário para uma tela que não tinha o
 * controle. Derivando da lista, a próxima tarefa aparece aqui sozinha — e o
 * `Record` total faz o compilador cobrar o rótulo dela.
 */
export const ROTULO_DA_TAREFA: Record<AiTask, { titulo: string; usa: string }> = {
  formatar: { titulo: "formatar", usa: "o botão de formatar nota" },
  chat: { titulo: "chat", usa: "o painel do assistente (Ctrl+Shift+Y)" },
};

/// Tarefas que só funcionam com modelo capaz de chamar ferramenta. O chat sem
/// isso conversa bem e não consegue consultar o acervo — e falharia no meio,
/// depois de a chamada já ter sido paga.
export const EXIGE_FERRAMENTA: ReadonlySet<AiTask> = new Set<AiTask>(["chat"]);

/** O modelo pode servir a esta tarefa? A recusa é a mesma no arraste e no menu. */
export function podeServir(modelo: { supportsTools: boolean }, tarefa: AiTask): boolean {
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

/** Contexto em milhares, como o provedor costuma anunciar. */
export function contexto(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

/** O provedor do modelo é o prefixo do id — `anthropic/claude-…` é da Anthropic. */
export function provedorDe(id: string): string {
  return id.includes("/") ? (id.split("/")[0] ?? "") : "";
}
