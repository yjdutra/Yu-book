import { linkInputSchema, linkMoveSchema, linkUpdateSchema, listLinksQuerySchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./links.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

export async function linksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/links", async (request) => {
    const { kind } = listLinksQuerySchema.parse(request.query);
    return service.listar(request.userId, kind);
  });

  app.post("/links", async (request, reply) => {
    const input = linkInputSchema.parse(request.body);
    const link = await service.criar(request.userId, input);
    return reply.status(201).send(link);
  });

  app.patch("/links/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = linkUpdateSchema.parse(request.body);
    return service.atualizar(request.userId, id, input);
  });

  app.patch("/links/:id/move", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { position } = linkMoveSchema.parse(request.body);
    return service.mover(request.userId, id, position);
  });

  app.post("/links/:id/title", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.rebuscarTitulo(request.userId, id);
  });

  app.delete("/links/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluir(request.userId, id);
    return reply.status(204).send();
  });
}
