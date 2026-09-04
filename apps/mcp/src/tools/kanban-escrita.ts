import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  cardPrioritySchema,
  MAX_CARD_DESCRICAO,
  MAX_CARD_TITULO,
  MAX_TAGS_CARD,
} from "@yu-book/shared";
import type { CardDetail } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErroDeEscrita } from "../erros.js";
import { diaParaPrazo, formatarCardDetalhe } from "../formato.js";
import { relatar } from "../notificacoes.js";

/**
 * As tools que **mudam** o quadro. Vivem separadas de `tools/kanban.ts` de
 * propósito: leitura e escrita têm risco diferente e revisão diferente, e assim
 * a etapa de escrita não toca uma linha das tools que já funcionam.
 *
 * Granularidade **estreita**, por decisão: uma tool faz uma coisa, com o menor
 * schema que resolve o caso. O schema de uma tool não é assinatura de função —
 * é contrato de conversa com o modelo, e cada campo a mais é uma liberdade a
 * mais para ele inventar combinação inválida.
 *
 * `position` na criação e `checklist` ficam **fora** do schema, e não por
 * esquecimento: a API ignora posição na criação (o card nasce no fim), e o
 * checklist exige que o modelo invente identificador estável por item — o campo
 * com mais chance de erro e menos valor numa criação.
 */
export function registrarEscritaDeKanban(server: McpServer): void {
  server.registerTool(
    "create_card",
    {
      title: "Criar um card",
      description:
        "Cria um card no fim de uma coluna de um quadro kanban. **Chame `get_board` antes**: o " +
        "`columnId` sai de lá, e o quadro é deduzido da coluna — não existe parâmetro de quadro. " +
        "O card **nasce no fim da coluna**; para pô-lo em outra posição, crie e depois chame " +
        "`move_card`. Não cria coluna, quadro nem workspace, e não cria checklist: os três " +
        "precisam existir antes, e checklist se edita no aplicativo.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: {
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
    comErroDeEscrita(async ({ columnId, title, descriptionMd, dueDate, priority, tags, noteId }, extra) => {
      const relato = relatar(server, extra, "create_card", 1);

      const card = await api.post<CardDetail>("/cards", {
        columnId,
        title,
        ...(descriptionMd !== undefined && { descriptionMd }),
        // O front grava o prazo às 23:59:59 locais — `apps/web/src/components/
        // PainelCard.tsx`, documentado em `apps/web/src/lib/tempo.ts`. A
        // convenção não tem identificador de PRD; a referência é o arquivo.
        // Gravar meia-noite UTC aqui criaria uma segunda convenção de prazo
        // dentro do mesmo produto.
        ...(dueDate !== undefined && { dueDate: diaParaPrazo(dueDate) }),
        ...(priority !== undefined && { priority }),
        ...(tags !== undefined && { tags }),
        ...(noteId !== undefined && { noteId }),
      });

      await relato.passo("card criado");
      await relato.registrar("info", {
        acao: "card criado",
        cardId: card.id,
        columnId: card.columnId,
        title: card.title,
      });

      return { content: [{ type: "text", text: `Card criado.\n\n${formatarCardDetalhe(card)}` }] };
    }),
  );

  server.registerTool(
    "move_card",
    {
      title: "Mover um card de coluna",
      description:
        "Move um card para outra coluna **do mesmo quadro**, ou muda a posição dele dentro da " +
        "coluna atual. `position` é a posição em que o card vai ficar, começando em 0 — a " +
        "confirmação devolve a posição final, então dá para conferir. **Número maior que a " +
        "coluna é ajustado para o fim, não é erro**: é a forma legítima de dizer 'no fim'. " +
        "Card não atravessa quadro: coluna de outro quadro é recusada. Card arquivado não se " +
        "move. Chame `get_board` antes para pegar os ids e ver a ordem atual. Esta tool não " +
        "altera título, prazo, tags nem nenhum outro campo.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
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
    comErroDeEscrita(async ({ cardId, columnId, position }, extra) => {
      const relato = relatar(server, extra, "move_card", 1);

      const card = await api.patch<CardDetail>(`/cards/${cardId}/move`, { columnId, position });

      await relato.passo("card movido");
      await relato.registrar("info", {
        acao: "card movido",
        cardId: card.id,
        para: card.columnName,
        // A posição relatada é a do servidor depois do ajuste, não a pedida —
        // é o que prova ao modelo onde o card foi parar quando o número saiu
        // do intervalo.
        position: card.position,
      });

      return { content: [{ type: "text", text: `Card movido.\n\n${formatarCardDetalhe(card)}` }] };
    }),
  );
}
