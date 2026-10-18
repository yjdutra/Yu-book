import {
  skillInputSchema,
  skillsQuerySchema,
  skillUpdateSchema,
  skillUseInputSchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./skills.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

/** Skills — frente Ritmo, Ritmo 5 (docs/prd-ritmo.md, §8). */
export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/skills", async (request) => {
    const { includeArchived } = skillsQuerySchema.parse(request.query);
    return service.listarSkills(request.userId, includeArchived);
  });

  app.post("/skills", async (request, reply) => {
    const input = skillInputSchema.parse(request.body);
    return reply.status(201).send(await service.criarSkill(request.userId, input));
  });

  app.patch("/skills/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = skillUpdateSchema.parse(request.body);
    return service.atualizarSkill(request.userId, id, input);
  });

  app.delete("/skills/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirSkill(request.userId, id);
    return reply.status(204).send();
  });

  app.post("/skills/:id/uses", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    // `origin` vira a marca de quem usou, e só o MCP o envia.
    const { origin } = skillUseInputSchema.parse(request.body ?? {});
    return reply.status(201).send(await service.usarSkill(request.userId, id, origin));
  });

  app.delete("/skill-uses/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.desfazerUso(request.userId, id);
    return reply.status(204).send();
  });
}
