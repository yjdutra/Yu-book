/**
 * Tipos de nota. Uma única entidade `Note` cobre todos os contextos —
 * adicionar um tipo novo é adicionar um valor aqui, não uma tabela.
 */
export const NOTE_KINDS = ["aula", "projeto", "trilha", "trabalho", "livre"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const COMPANY_STATUSES = ["interesse", "aplicado", "entrevista", "descartada"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const CARD_PRIORITIES = ["baixa", "media", "alta"] as const;
export type CardPriority = (typeof CARD_PRIORITIES)[number];

/**
 * As duas listas da gaveta. `favorito` dura; `depois` existe para ser
 * consumido e apagado — mesma estrutura, intenções opostas.
 */
export const LINK_KINDS = ["favorito", "depois"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * Tarefas de IA que gastam — é o que `ai_usage.task` registra. Espelha o enum
 * `AiTask` do Prisma. `chat` já entrou na Etapa A porque acrescentar valor a
 * enum do Postgres é migration à parte; `rotina` entrou na Etapa E.
 *
 * **Não é a lista de colunas do quadro de modelos.** Essa é
 * `TAREFAS_COM_MODELO`, logo abaixo.
 */
export const AI_TASKS = ["formatar", "chat", "rotina"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * As tarefas que têm modelo padrão escolhido em `/ajustes` — as colunas do
 * quadro de modelos e os valores aceitos por `PATCH /ai/tasks/:task`.
 *
 * `rotina` fica de fora de propósito: cada passo de uma rotina usa o modelo do
 * agente, ou o da tarefa `chat` quando o agente não tem um próprio. Uma coluna
 * "rotina" no quadro seria um controle que não controla nada. Tarefa nova que
 * **tenha** modelo próprio entra nas duas listas, e a tela precisa percorrê-la
 * (INV-54).
 */
export const TAREFAS_COM_MODELO = ["formatar", "chat"] as const satisfies readonly AiTask[];
export type TarefaComModelo = (typeof TAREFAS_COM_MODELO)[number];

/**
 * Quem falou numa mensagem do chat. Espelha o enum `AiMessageRole` do Prisma.
 *
 * `tool` é o resultado que o Yu-book devolveu ao modelo no meio do laço. Fica
 * gravado porque o histórico é o que volta ao provedor na mensagem seguinte:
 * sem ele, o modelo veria a própria decisão de chamar a ferramenta sem nunca
 * ver a resposta.
 */
export const AI_MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

/**
 * De onde veio o custo registrado de uma chamada. Espelha `AiCostSource`.
 *
 * `estimado` é calculado pelo preço do catálogo quando o provedor não informa;
 * `desconhecido` é quando não veio nem custo nem token — grava zero, e por isso
 * precisa ser **contado e mostrado**: chamada de custo zero não move o teto
 * diário, e um provedor que parasse de informar tornaria o teto decorativo.
 */
export const AI_COST_SOURCES = ["provedor", "estimado", "desconhecido"] as const;
export type AiCostSource = (typeof AI_COST_SOURCES)[number];

/**
 * Por qual superfície um conteúdo gerado por IA entrou no acervo. Espelha o
 * enum `AiVia` do Prisma (Etapa C da frente de IA). `rotina` entrou na Etapa E;
 * agente não é via — é quem escreveu, e vai em `AiMark.agentName`.
 */
export const AI_VIAS = ["chat", "mcp", "rotina"] as const;
export type AiVia = (typeof AI_VIAS)[number];
