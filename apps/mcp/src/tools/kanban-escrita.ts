import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { diaParaPrazo, FERRAMENTAS_DO_ACERVO, formatarCardDetalhe } from "@yu-book/shared";
import type { CardDetail } from "@yu-book/shared";
import { api } from "../cliente.js";
import { comErroDeEscrita } from "../erros.js";
import { fusoDoUsuario } from "../fuso.js";
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
  const criar = FERRAMENTAS_DO_ACERVO.create_card;
  server.registerTool(
    "create_card",
    {
      title: criar.titulo,
      description: criar.descricao,
      annotations: criar.anotacoes,
      inputSchema: criar.entrada,
    },
    comErroDeEscrita(async ({ columnId, title, descriptionMd, dueDate, priority, tags, noteId }, extra) => {
      const relato = relatar(server, extra, "create_card", 1);
      // Antes do POST, não em paralelo: é o fuso que decide em que instante o
      // dia vira prazo, e mandar o corpo sem ele seria gravar outro dia.
      //
      // `exigir` só quando há prazo para converter. Sem prazo o fuso serve de
      // rótulo na confirmação, e recuar é inofensivo; com prazo ele vira o
      // instante gravado no banco, e recuar em silêncio deixaria uma data
      // errada num lugar que não morre junto com a conversa.
      const fuso = await fusoDoUsuario({ exigir: dueDate !== undefined });

      const card = await api.post<CardDetail>("/cards", {
        columnId,
        title,
        ...(descriptionMd !== undefined && { descriptionMd }),
        // O front grava o prazo às 23:59:59 locais — `apps/web/src/components/
        // PainelCard.tsx`, documentado em `apps/web/src/lib/tempo.ts`. A
        // convenção não tem identificador de PRD; a referência é o arquivo.
        // Gravar meia-noite UTC aqui criaria uma segunda convenção de prazo
        // dentro do mesmo produto.
        ...(dueDate !== undefined && { dueDate: diaParaPrazo(dueDate, fuso) }),
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

      return { content: [{ type: "text", text: `Card criado.\n\n${formatarCardDetalhe(card, fuso)}` }] };
    }),
  );

  const mover = FERRAMENTAS_DO_ACERVO.move_card;
  server.registerTool(
    "move_card",
    {
      title: mover.titulo,
      description: mover.descricao,
      annotations: mover.anotacoes,
      inputSchema: mover.entrada,
    },
    comErroDeEscrita(async ({ cardId, columnId, position }, extra) => {
      const relato = relatar(server, extra, "move_card", 1);

      const [card, fuso] = await Promise.all([
        api.patch<CardDetail>(`/cards/${cardId}/move`, { columnId, position }),
        fusoDoUsuario(),
      ]);

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

      return { content: [{ type: "text", text: `Card movido.\n\n${formatarCardDetalhe(card, fuso)}` }] };
    }),
  );
}
