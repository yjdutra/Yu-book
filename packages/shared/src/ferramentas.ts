import { z } from "zod";
import {
  cardPrioritySchema,
  MAX_CARD_DESCRICAO,
  MAX_CARD_TITULO,
  MAX_TAGS_CARD,
} from "./kanban.js";

/**
 * O vocabulário do acervo: as nove ações que um modelo pode pedir.
 *
 * **Uma definição, dois consumidores.** O servidor MCP publica estas nove em
 * `tools/list`; o chat interno (Etapa B da frente de IA) as oferece ao provedor
 * no campo `tools` da requisição. O metadado — nome, título, descrição e
 * schema — mora aqui; os **handlers ficam separados**, porque o MCP fala HTTP
 * com a API e o chat chama os services direto. Dois catálogos escritos à mão
 * divergiriam em silêncio, e a divergência apareceria como a mesma ação com
 * duas caras conforme a porta de entrada.
 *
 * **A `descricao` é contrato de conversa com o modelo, não documentação.** É o
 * texto que decide se ele chama a tool certa, na hora certa, com os campos
 * certos — cada frase aqui foi paga com comportamento observado. Alterá-la é
 * alterar comportamento, e não é refatoração.
 *
 * Nome de tool é fronteira, como caminho de rota — daí o inglês, igual a
 * `/notes` e `/boards`. O que é interno continua em português.
 */

/**
 * As dicas de comportamento do MCP. Só as quatro de escrita as declaram, que é
 * exatamente o que o servidor publica hoje — acrescentá-las às de leitura
 * mudaria a superfície de `tools/list` sem ninguém ter pedido.
 */
export interface AnotacoesDeFerramenta {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface DefinicaoDeFerramenta {
  titulo: string;
  descricao: string;
  entrada: z.ZodRawShape;
  /**
   * Se a ação muda o acervo.
   *
   * **Esta bandeira governa o chat, e não o servidor MCP.** Lá a superfície
   * continua decidida pelo módulo que registra a tool (`servidor.ts`) mais o
   * `podeEscrever` do transporte — dois eixos com o mesmo nome. Quem trocar
   * isto para `false` numa ação de escrita abre o **chat** para ela e não mexe
   * uma vírgula no `tools/list`, e o teste que deriva o conjunto de escrita do
   * MCP continua verde. O que impede o dano é o outro lado: em
   * `apps/api/src/modules/assistente/ferramentas.service.ts` a ação também
   * precisa de um executor, e o `Record` de lá não compila sem uma decisão
   * explícita para cada nome deste objeto.
   */
  escrita: boolean;
  anotacoes?: AnotacoesDeFerramenta;
}

export const FERRAMENTAS_DO_ACERVO = {
  search_notes: {
    titulo: "Buscar notas e cards",
    descricao:
      "Busca no segundo cérebro do usuário e devolve apenas trechos — nunca o corpo das notas. " +
      "Ignora acento e aplica stemming em português (`programacao` acha `programação`); quando " +
      "não há resultado exato, cai numa busca aproximada por semelhança de título. Aceita " +
      "filtros dentro do próprio texto: `tipo:aula`, `tipo:card`, `tag:jwt` e `#workspace`. " +
      "Use para descobrir o que existe; depois chame `get_note` para ler uma nota inteira.",
    escrita: false,
    entrada: {
      q: z
        .string()
        .min(1)
        .max(200)
        .describe("Termo de busca. Pode conter tipo:aula, tag:jwt ou #workspace."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(8)
        .describe("Quantos resultados no máximo. Mantenha baixo: cada um custa contexto."),
    },
  },

  get_note: {
    titulo: "Ler uma nota inteira",
    descricao:
      "Devolve o conteúdo completo de uma nota, com tags, campos livres, as notas que a " +
      "referenciam e os cards vinculados. É a única tool que devolve corpo inteiro, então " +
      "chame-a para uma nota de cada vez, depois de localizar o id com `search_notes`.",
    escrita: false,
    entrada: {
      id: z.string().uuid().describe("Id da nota, como devolvido por search_notes."),
    },
  },

  list_boards: {
    titulo: "Listar os quadros",
    descricao:
      "Lista os quadros kanban do usuário, com o workspace a que pertencem e quantas colunas e " +
      "cards cada um tem. Use para descobrir o id de um quadro antes de chamar `get_board`.",
    escrita: false,
    entrada: {
      workspaceId: z
        .string()
        .uuid()
        .optional()
        .describe("Restringe a um workspace. Omita para ver todos."),
    },
  },

  get_board: {
    titulo: "Ver um quadro inteiro",
    descricao:
      "Devolve as colunas de um quadro na ordem, com os cards de cada uma — título, prazo, " +
      "prioridade, progresso do checklist, tags e nota vinculada. As tags agrupam cards por " +
      "assunto, num eixo independente da coluna. Cards arquivados não aparecem. " +
      "A descrição do card não vem aqui: o quadro é uma visão de superfície.",
    escrita: false,
    entrada: {
      id: z.string().uuid().describe("Id do quadro, como devolvido por list_boards."),
    },
  },

  get_dashboard: {
    titulo: "O que precisa de atenção agora",
    descricao:
      "Devolve o agregado da tela inicial numa requisição só: prazos vencidos, prazos dos " +
      "próximos 7 dias, notas editadas recentemente e o tamanho da fila de links. É a fonte " +
      "dos prompts de revisão — prefira esta tool a montar o mesmo recorte com várias chamadas.",
    escrita: false,
    entrada: {
      workspaceId: z
        .string()
        .uuid()
        .optional()
        .describe("Restringe prazos e notas a um workspace. A fila de links nunca é filtrada."),
    },
  },

  create_card: {
    titulo: "Criar um card",
    descricao:
      "Cria um card no fim de uma coluna de um quadro kanban. **Chame `get_board` antes**: o " +
      "`columnId` sai de lá, e o quadro é deduzido da coluna — não existe parâmetro de quadro. " +
      "O card **nasce no fim da coluna**; para pô-lo em outra posição, crie e depois chame " +
      "`move_card`. Não cria coluna, quadro nem workspace, e não cria checklist: os três " +
      "precisam existir antes, e checklist se edita no aplicativo.",
    escrita: true,
    anotacoes: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    entrada: {
      columnId: z
        .string()
        .uuid()
        .describe("Id da coluna de destino, como `get_board` mostra sob o nome de cada coluna."),
      title: z
        .string()
        .trim()
        .min(1)
        .max(MAX_CARD_TITULO)
        .describe(`Título do card, até ${MAX_CARD_TITULO} caracteres.`),
      descriptionMd: z
        .string()
        .max(MAX_CARD_DESCRICAO)
        .optional()
        .describe("Descrição em Markdown. Omita para criar sem descrição."),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
          "Dia do prazo, no formato AAAA-MM-DD. O prazo é o fim do dia escolhido: antes disso " +
            "o card não está vencido.",
        ),
      priority: cardPrioritySchema.optional().describe("baixa, media ou alta. Omita para media."),
      tags: z
        .array(z.string())
        .max(MAX_TAGS_CARD)
        .optional()
        // A normalização do servidor (minúsculas, corte em 24, fusão de
        // repetidas) é toda silenciosa: não há nada que o modelo possa fazer
        // diferente sabendo dela, e descrever custa em todo turno.
        .describe(`Até ${MAX_TAGS_CARD} etiquetas livres.`),
      noteId: z
        .string()
        .uuid()
        .optional()
        .describe("Vincula o card a uma nota ativa. O id vem de `search_notes` ou `get_note`."),
    },
  },

  move_card: {
    titulo: "Mover um card de coluna",
    descricao:
      "Move um card para outra coluna **do mesmo quadro**, ou muda a posição dele dentro da " +
      "coluna atual. `position` é a posição em que o card vai ficar, começando em 0 — a " +
      "confirmação devolve a posição final, então dá para conferir. **Número maior que a " +
      "coluna é ajustado para o fim, não é erro**: é a forma legítima de dizer 'no fim'. " +
      "Card não atravessa quadro: coluna de outro quadro é recusada. Card arquivado não se " +
      "move. Chame `get_board` antes para pegar os ids e ver a ordem atual. Esta tool não " +
      "altera título, prazo, tags nem nenhum outro campo.",
    escrita: true,
    anotacoes: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    entrada: {
      cardId: z.string().uuid().describe("Id do card, como aparece em `get_board`."),
      columnId: z
        .string()
        .uuid()
        .describe("Id da coluna de destino, do mesmo quadro. Repita a atual para só reordenar."),
      position: z
        .number()
        .int()
        .min(0)
        .describe("Posição final na coluna de destino, de 0 em diante. Número alto = no fim."),
    },
  },

  trash_note: {
    titulo: "Mandar uma nota para a lixeira",
    descricao:
      "Manda uma nota para a lixeira. Ela some da busca, do catálogo, do autocomplete de " +
      "`[[…]]` e dos backlinks das outras notas. **Um efeito não se desfaz:** os cards que " +
      "apontavam para ela perdem o vínculo, e `restore_note` não o refaz — isso se refaz no " +
      "aplicativo, um card por vez. Os links `[[…]]` de e para a nota também são apagados, " +
      "mas esses **voltam** ao restaurar. Enquanto ela está na lixeira o título fica livre, " +
      "então outra nota pode tomá-lo — e aí a volta falha. **Não apaga em definitivo**: este " +
      "servidor não expõe essa operação.",
    escrita: true,
    anotacoes: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    entrada: {
      noteId: z
        .string()
        .uuid()
        .describe("Id da nota, como devolvido por `search_notes` ou `get_note`."),
    },
  },

  restore_note: {
    titulo: "Tirar uma nota da lixeira",
    descricao:
      "Tira uma nota da lixeira e a devolve ativa: ela volta à busca, ao catálogo e aos " +
      "backlinks, e os `[[…]]` do corpo dela são recalculados. **Não refaz** o vínculo dos " +
      "cards que apontavam para ela — isso se refaz no aplicativo, um card por vez. " +
      "**Pode falhar por título duplicado**: se outra nota ativa tiver ficado com o mesmo " +
      "título enquanto esta estava na lixeira, a API recusa. Restaurar uma nota que já está " +
      "ativa não altera nada. O id vem da confirmação de `trash_note` — a busca não enxerga " +
      "a lixeira.",
    escrita: true,
    anotacoes: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    entrada: {
      noteId: z.string().uuid().describe("Id da nota na lixeira."),
    },
  },
  /// `satisfies`, e não uma anotação de tipo: a anotação apagaria a forma
  /// exata de cada `entrada`, e o `registerTool` do SDK do MCP infere os
  /// argumentos do handler justamente dela — com `ZodRawShape` genérico, todo
  /// handler passaria a receber `any`.
} satisfies Record<string, DefinicaoDeFerramenta>;

export type NomeDeFerramenta = keyof typeof FERRAMENTAS_DO_ACERVO;

/** Os nomes das que **não** mudam o acervo. A Etapa B do chat vive só destas. */
export const FERRAMENTAS_DE_LEITURA = (
  Object.keys(FERRAMENTAS_DO_ACERVO) as NomeDeFerramenta[]
).filter((nome) => !FERRAMENTAS_DO_ACERVO[nome].escrita);
