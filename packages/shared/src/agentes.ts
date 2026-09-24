import { z } from "zod";
import { FERRAMENTAS_DO_CHAT } from "./ferramentas.js";
import type { NomeDeFerramenta } from "./ferramentas.js";

/**
 * Agentes especialistas — Etapa D da frente de IA (`docs/prd-ia-no-yu-book.md`).
 *
 * Um agente é o chat com **premissas carregadas**: instruções próprias, notas
 * que entram inteiras no contexto, colunas de quadro lidas a cada mensagem,
 * um modelo e uma lista de ferramentas. Três regras que a forma daqui não
 * mostra e o servidor garante:
 *
 * - **As regras do Yu-book vêm antes e não são sobrescritas.** Citar a origem,
 *   não tocar em `[[…]]`, criar só a pedido: as instruções do agente entram
 *   depois delas, como complemento.
 * - **Texto de instrução não concede ferramenta.** Só `tools` concede, e só
 *   dentro de `FERRAMENTAS_DO_CHAT`.
 * - **O agente é fixo por conversa.** A conversa guarda o nome dele, e continua
 *   legível depois de o agente ser excluído.
 */

/**
 * As seis cores. Nomes de tom, não hex: o front mapeia cada uma para um token
 * que existe nos dois temas. Espelha o enum `AiAgentColor` do Prisma —
 * acrescentar valor é migration, e a tela precisa oferecer o novo (INV-54).
 */
export const AGENT_COLORS = ["violeta", "azul", "verde", "ambar", "rosa", "cinza"] as const;
export type AgentColor = (typeof AGENT_COLORS)[number];

export const MAX_NOME_AGENTE = 60;
export const MAX_DESCRICAO_AGENTE = 160;
export const MAX_INSTRUCOES_AGENTE = 20_000;
export const MAX_NOTAS_BASE = 10;
export const MAX_FONTES_VIVAS = 5;
export const MAX_LIMITE_FONTE_VIVA = 50;

/**
 * Quanto de premissa — notas-base mais fontes vivas — cabe no contexto de um
 * agente. O corte é por bloco inteiro e **declarado** (RNF-04): meia nota no
 * contexto é o tipo de entrada que faz o modelo afirmar o contrário do que ela
 * diz. As instruções ficam fora desta conta; têm limite próprio.
 */
export const MAX_PREMISSAS_DO_AGENTE = 40_000;

/// `titulos` é uma linha por card; `faces` é a face inteira, como no quadro.
export const LIVE_SOURCE_DETAILS = ["titulos", "faces"] as const;
export type LiveSourceDetail = (typeof LIVE_SOURCE_DETAILS)[number];

/**
 * Uma fonte viva: uma coluna de quadro, lida **a cada mensagem**, para que o
 * agente saiba o que já foi publicado ou está na fila sem ninguém atualizar
 * uma nota à mão. `tipo` existe para outras fontes entrarem sem migration.
 */
export const liveSourceSchema = z.object({
  tipo: z.literal("coluna"),
  boardId: z.string().uuid(),
  columnId: z.string().uuid(),
  limite: z.number().int().min(1).max(MAX_LIMITE_FONTE_VIVA).default(10),
  detalhe: z.enum(LIVE_SOURCE_DETAILS).default("titulos"),
});

export type LiveSourceInput = z.input<typeof liveSourceSchema>;
export type LiveSource = z.infer<typeof liveSourceSchema>;

const ferramentaDoChatSchema = z
  .string()
  .refine((nome) => (FERRAMENTAS_DO_CHAT as readonly string[]).includes(nome), {
    message: "Ferramenta que o chat não oferece",
  })
  .transform((nome) => nome as NomeDeFerramenta);

const semRepetir = <T>(lista: T[]) => new Set(lista).size === lista.length;

export const agentInputSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao agente").max(MAX_NOME_AGENTE),
  description: z.string().trim().max(MAX_DESCRICAO_AGENTE).default(""),
  color: z.enum(AGENT_COLORS).default("violeta"),
  instructionsMd: z.string().max(MAX_INSTRUCOES_AGENTE).default(""),
  /// `null` = usa o modelo da tarefa `chat`. Precisa estar nos favoritos na
  /// hora do uso, não na hora de salvar: o favorito pode sair depois.
  modelId: z.string().trim().min(1).max(200).nullable().default(null),
  tools: z
    .array(ferramentaDoChatSchema)
    .max(FERRAMENTAS_DO_CHAT.length)
    .refine(semRepetir, "Ferramenta repetida")
    .default([]),
  /// Em ordem: é a ordem em que entram no contexto, e a que o corte respeita.
  baseNoteIds: z
    .array(z.string().uuid())
    .max(MAX_NOTAS_BASE, `No máximo ${MAX_NOTAS_BASE} notas-base`)
    .refine(semRepetir, "Nota-base repetida")
    .default([]),
  liveSources: z
    .array(liveSourceSchema)
    .max(MAX_FONTES_VIVAS, `No máximo ${MAX_FONTES_VIVAS} fontes vivas`)
    .default([]),
});

export const agentUpdateSchema = agentInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nada para atualizar");

/**
 * O corpo de `POST /ai/agents/preview`: o rascunho do editor, que pode estar
 * sem nome enquanto se digita. O resto valida igual — uma nota alheia ou uma
 * ferramenta fora do chat recusam na prévia como recusariam ao salvar. A fonte
 * viva, não: coluna que não resolve vira bloco `indisponivel`, para que o
 * editor reabra um agente cuja coluna foi excluída (RN-15).
 */
export const agentPreviewSchema = agentInputSchema.extend({
  name: z.string().trim().max(MAX_NOME_AGENTE).default(""),
});

export type AgentInput = z.input<typeof agentInputSchema>;
export type AgentPreviewInput = z.input<typeof agentPreviewSchema>;
export type AgentUpdateInput = z.input<typeof agentUpdateSchema>;

/** Uma nota-base como o editor a mostra. */
export interface AgentBaseNote {
  id: string;
  title: string;
  /// Tamanho do corpo, para o editor mostrar o peso de cada nota.
  chars: number;
  /// Na lixeira: continua ligada, mas fica fora do contexto até voltar.
  trashed: boolean;
}

/** A fonte viva com os nomes resolvidos. `null` se o quadro ou a coluna sumiu. */
export interface AgentLiveSource extends LiveSource {
  boardName: string | null;
  columnName: string | null;
}

/** O que a lista e a galeria mostram. */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  color: AgentColor;
  modelId: string | null;
  /// Nome do favorito, quando há modelo próprio e ele ainda é favorito.
  modelName: string | null;
  /// Há modelo próprio e ele saiu dos favoritos: o chat recusa até trocar.
  modelMissing: boolean;
  /// Títulos das notas-base, em ordem. A galeria mostra três e um "+n".
  baseNoteTitles: string[];
  toolCount: number;
  /// Alguma das ferramentas escreve no acervo.
  writes: boolean;
  liveSourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDetail extends AgentSummary {
  instructionsMd: string;
  tools: NomeDeFerramenta[];
  baseNotes: AgentBaseNote[];
  liveSources: AgentLiveSource[];
}

/** Um bloco do contexto montado, como a prévia do editor o lista. */
export interface AgentContextBlock {
  kind: "regras" | "instrucoes" | "nota" | "fonte";
  title: string;
  chars: number;
  /// `cortado`: não coube em `MAX_PREMISSAS_DO_AGENTE`. `lixeira`: nota-base
  /// na lixeira. `indisponivel`: a coluna da fonte viva não existe mais.
  status: "incluido" | "cortado" | "lixeira" | "indisponivel";
}

/**
 * `POST /ai/agents/preview`: o que o agente receberia, sem gravar nada. É a
 * mesma montagem que o chat faz a cada mensagem.
 */
export interface AgentPreview {
  /// A mensagem `system` inteira.
  system: string;
  chars: number;
  /// Aproximação de quatro caracteres por token, a mesma do teto.
  tokens: number;
  /// Notas-base e fontes vivas que entraram, contra `premisesLimit`.
  premisesChars: number;
  premisesLimit: number;
  /// Custo estimado de **um** passo do laço só com este contexto e a saída
  /// máxima. Uma mensagem custa de 1 a `MAX_PASSOS_DO_LACO` passos. `null`
  /// quando não há modelo utilizável — `warnings` diz por quê.
  costPerStepMicros: number | null;
  modelId: string | null;
  modelName: string | null;
  blocks: AgentContextBlock[];
  /// Títulos do que ficou de fora por tamanho.
  cut: string[];
  warnings: string[];
}

/** O agente de uma conversa. `id` nulo: o agente foi excluído depois. */
export interface ConversationAgent {
  id: string | null;
  name: string;
  color: AgentColor;
}

/**
 * Um modelo pronto de agente. Não aponta para nota nenhuma — traz **títulos**
 * sugeridos, e o editor oferece criá-las vazias.
 */
export interface ModeloDeAgente {
  chave: string;
  name: string;
  description: string;
  color: AgentColor;
  instructionsMd: string;
  tools: NomeDeFerramenta[];
  notasSugeridas: string[];
}

export const MODELOS_DE_AGENTE: readonly ModeloDeAgente[] = [
  {
    chave: "linkedin",
    name: "Especialista em LinkedIn",
    description: "Escreve posts para o LinkedIn no seu tom, sem repetir o que já saiu.",
    color: "azul",
    tools: ["search_notes", "get_note", "list_boards", "get_board", "create_card"],
    notasSugeridas: ["Guia de posts do LinkedIn", "Exemplos de posts"],
    instructionsMd: [
      "Você escreve posts para o LinkedIn do usuário.",
      "",
      "## Como trabalhar",
      "",
      "- Siga o **Guia de posts do LinkedIn** das premissas. Onde ele e estas instruções " +
        "divergirem, o guia vence.",
      "- Imite o tom dos **Exemplos de posts**: vocabulário, ritmo e o jeito de abrir e fechar. " +
        "Não copie frases deles.",
      "- **Não repita temas** que já aparecem nas fontes vivas (o que já foi publicado ou está " +
        "na fila). Se o pedido esbarrar num deles, diga qual e proponha outro ângulo.",
      "- Quando precisar de matéria-prima, busque no acervo antes de perguntar.",
      "",
      "## Forma do post",
      "",
      "1. **Gancho** nas duas primeiras linhas: uma afirmação concreta, um número ou uma " +
        "situação. Nada de \"Você já parou para pensar…\".",
      "2. **Corpo** em parágrafos de uma a três linhas, com espaço entre eles. Uma ideia por " +
        "post.",
      "3. **Fechamento** com uma conclusão prática ou uma pergunta que convide resposta.",
      "- Entre 800 e 1.300 caracteres, salvo pedido diferente.",
      "- No máximo três hashtags, no fim. Emoji só se os exemplos usarem.",
      "- Primeira pessoa, tom de conversa entre colegas; sem jargão de coach.",
      "",
      "## Entrega",
      "",
      "- Entregue o post pronto para colar, e abaixo dele uma linha dizendo em que nota ou " +
        "card ele se apoiou.",
      "- Se pedirem duas versões, varie o gancho, não só as palavras.",
      "- Crie um card com o rascunho **só se o usuário pedir**, na coluna que ele indicar.",
    ].join("\n"),
  },
  {
    chave: "marketing",
    name: "Marketing",
    description: "Pensa posicionamento, público e mensagem a partir das suas notas.",
    color: "rosa",
    tools: ["search_notes", "get_note", "list_boards", "get_board", "get_dashboard"],
    notasSugeridas: ["Posicionamento", "Palavras-chave e público"],
    instructionsMd: [
      "Você é o estrategista de marketing do usuário.",
      "",
      "## Base",
      "",
      "- O **Posicionamento** das premissas é a referência: para quem é, que problema resolve, " +
        "o que diferencia. Toda sugestão precisa ser coerente com ele — se não for, diga.",
      "- **Palavras-chave e público** diz com quem se fala e com que termos. Use esses termos; " +
        "não invente persona nova sem avisar.",
      "",
      "## Como responder",
      "",
      "- Comece pela recomendação, depois o porquê. Uma resposta cabe numa tela.",
      "- Seja específico: canal, formato, frase de exemplo. \"Melhorar a presença digital\" não " +
        "é recomendação.",
      "- Separe o que vem das notas do usuário do que é opinião sua, e marque a opinião como tal.",
      "- Quando faltar dado (público, preço, concorrente), diga qual falta e o que você assumiu.",
      "- Sugira títulos, chamadas e palavras-chave em listas curtas, prontas para testar.",
      "- Não prometa resultado nem cite número de mercado que não esteja no acervo.",
    ].join("\n"),
  },
  {
    chave: "revisor",
    name: "Revisor",
    description: "Revisa textos: clareza e correção, sem mudar o que você quis dizer.",
    color: "verde",
    tools: ["search_notes", "get_note"],
    notasSugeridas: ["Guia de estilo"],
    instructionsMd: [
      "Você revisa textos do usuário em português do Brasil.",
      "",
      "## O que revisar",
      "",
      "- **Correção:** ortografia, concordância, regência, pontuação e crase.",
      "- **Clareza:** frase longa demais, ambiguidade, repetição, palavra vaga onde cabe uma " +
        "precisa.",
      "- **Coerência:** afirmação que contradiz outra do mesmo texto, ou uma nota do acervo " +
        "que o texto cite.",
      "",
      "## Regras",
      "",
      "- Siga o **Guia de estilo** das premissas quando ele existir; ele vence o gosto seu.",
      "- **Não invente fatos.** Não acrescente dado, número, nome ou citação que o texto não " +
        "tenha. Se algo parecer errado, aponte e pergunte — não corrija por conta própria.",
      "- Preserve a voz e o registro do autor. Revisar não é reescrever.",
      "- Aponte os problemas **em lista**, um por item: o trecho original, o problema e a " +
        "sugestão.",
      "- Depois da lista, ofereça o texto revisado inteiro, só se o usuário pedir ou se as " +
        "mudanças forem pequenas.",
      "- Se o texto estiver bom, diga isso em uma linha. Não fabrique problema.",
    ].join("\n"),
  },
];
