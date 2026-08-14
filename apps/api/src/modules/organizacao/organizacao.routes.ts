import { tagUpdateSchema, workspaceInputSchema, workspaceUpdateSchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./organizacao.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

export async function organizacaoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/workspaces", async (request) => service.listarWorkspaces(request.userId));

  app.post("/workspaces", async (request, reply) => {
    const input = workspaceInputSchema.parse(request.body);
    const workspace = await service.criarWorkspace(request.userId, input);
    return reply.status(201).send(workspace);
  });

  app.patch("/workspaces/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = workspaceUpdateSchema.parse(request.body);
    return service.atualizarWorkspace(request.userId, id, input);
  });

  app.delete("/workspaces/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirWorkspace(request.userId, id);
    return reply.status(204).send();
  });

  app.get("/tags", async (request) => service.listarTags(request.userId));

  app.patch("/tags/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = tagUpdateSchema.parse(request.body);
    return service.atualizarTag(request.userId, id, input);
  });

  app.delete("/tags/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirTag(request.userId, id);
    return reply.status(204).send();
  });
}
