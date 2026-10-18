import { focusSessionInputSchema, focusSessionsQuerySchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./foco.service.js";

/** Foco — frente Ritmo, Ritmo 6 (docs/prd-ritmo.md, §9). */
export async function focoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/focus-sessions", async (request) => {
    const periodo = focusSessionsQuerySchema.parse(request.query);
    return service.listarSessoes(request.userId, periodo);
  });

  app.post("/focus-sessions", async (request, reply) => {
    const input = focusSessionInputSchema.parse(request.body);
    const { criada, ...resultado } = await service.gravarSessao(request.userId, input);
    // Repetir o `clientId` devolve a que ficou, com 200 (RF-56).
    return reply.status(criada ? 201 : 200).send(resultado);
  });
}
