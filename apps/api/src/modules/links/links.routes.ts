import {
  linkFolderInputSchema,
  linkFolderMoveSchema,
  linkFolderUpdateSchema,
  linkInputSchema,
  linkMoveSchema,
  linkUpdateSchema,
  listLinksQuerySchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./links.service.js";
import * as pastas from "./pastas.service.js";

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
    const { position, folderId } = linkMoveSchema.parse(request.body);
    return service.mover(request.userId, id, position, folderId);
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

  app.get("/link-folders", async (request) => pastas.listar(request.userId));

  app.post("/link-folders", async (request, reply) => {
    const { name } = linkFolderInputSchema.parse(request.body);
    return reply.status(201).send(await pastas.criar(request.userId, name));
  });

  app.patch("/link-folders/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { name } = linkFolderUpdateSchema.parse(request.body);
    return pastas.renomear(request.userId, id, name);
  });

  app.patch("/link-folders/:id/move", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const { position } = linkFolderMoveSchema.parse(request.body);
    return pastas.mover(request.userId, id, position);
  });

  app.delete("/link-folders/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await pastas.excluir(request.userId, id);
    return reply.status(204).send();
  });
}
