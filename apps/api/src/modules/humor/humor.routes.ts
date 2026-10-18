import { moodInputSchema, moodsQuerySchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./humor.service.js";

/** Humor — frente Ritmo, Ritmo 4 (docs/prd-ritmo.md, §7). */
export async function humorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/moods", async (request) => {
    const periodo = moodsQuerySchema.parse(request.query);
    return service.listarHumor(request.userId, periodo);
  });

  app.get("/moods/insights", async (request) => service.cruzarHumor(request.userId));

  app.put("/moods", async (request) => {
    // `origin` não é campo do humor: vira a marca de quem gravou, e só o MCP o envia.
    const { origin, ...input } = moodInputSchema.parse(request.body);
    return service.gravarHumor(request.userId, input, origin);
  });
}
