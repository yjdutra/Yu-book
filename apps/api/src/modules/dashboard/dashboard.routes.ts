import { dashboardQuerySchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./dashboard.service.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/dashboard", async (request) => {
    const { workspaceId } = dashboardQuerySchema.parse(request.query);
    return service.montar(request.userId, workspaceId);
  });
}
