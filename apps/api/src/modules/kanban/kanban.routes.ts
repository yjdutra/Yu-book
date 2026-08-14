import {
  boardInputSchema,
  boardUpdateSchema,
  cardInputSchema,
  cardMoveSchema,
  cardUpdateSchema,
  columnDeleteQuerySchema,
  columnInputSchema,
  columnMoveSchema,
  columnUpdateSchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./kanban.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });
const boardsQuerySchema = z.object({ workspaceId: z.string().uuid().optional() });

export async function kanbanRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota daqui exige token; o userId vem dele e de mais lugar nenhum.
  app.addHook("preHandler", authenticate);

  app.get("/boards", async (request) => {
    const { workspaceId } = boardsQuerySchema.parse(request.query);
    return service.listarBoards(request.userId, workspaceId);
  });

  app.post("/boards", async (request, reply) => {
    const input = boardInputSchema.parse(request.body);
    const board = await service.criarBoard(request.userId, input);
    return reply.status(201).send(board);
  });

  app.get("/boards/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.buscarBoard(request.userId, id);
  });

  app.patch("/boards/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = boardUpdateSchema.parse(request.body);
    return service.atualizarBoard(request.userId, id, input);
  });

  app.delete("/boards/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirBoard(request.userId, id);
    return reply.status(204).send();
  });

  app.get("/boards/:id/archived", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.listarArquivados(request.userId, id);
  });

  app.post("/columns", async (request, reply) => {
    const input = columnInputSchema.parse(request.body);
    const board = await service.criarColuna(request.userId, input);
    return reply.status(201).send(board);
  });

  app.patch("/columns/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = columnUpdateSchema.parse(request.body);
    return service.atualizarColuna(request.userId, id, input);
  });

  app.patch("/columns/:id/move", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { position } = columnMoveSchema.parse(request.body);
    return service.moverColuna(request.userId, id, position);
  });

  // Devolve o board inteiro: a exclusão remexe posições de coluna e de card,
  // e o front precisa do estado final, não de um 204 e um refetch.
  app.delete("/columns/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const opcoes = columnDeleteQuerySchema.parse(request.query);
    return service.excluirColuna(request.userId, id, {
      moveCardsTo: opcoes.moveCardsTo,
      deleteCards: opcoes.deleteCards === "true",
    });
  });

  app.post("/cards", async (request, reply) => {
    const input = cardInputSchema.parse(request.body);
    const card = await service.criarCard(request.userId, input);
    return reply.status(201).send(card);
  });

  app.get("/cards/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.buscarCard(request.userId, id);
  });

  app.patch("/cards/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = cardUpdateSchema.parse(request.body);
    return service.atualizarCard(request.userId, id, input);
  });

  app.patch("/cards/:id/move", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = cardMoveSchema.parse(request.body);
    return service.moverCard(request.userId, id, input);
  });

  app.delete("/cards/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirCard(request.userId, id);
    return reply.status(204).send();
  });
}
