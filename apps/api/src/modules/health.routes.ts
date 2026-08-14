import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Usado pelo healthcheck da Railway. Não toca no banco: precisa ser barato. */
  app.get("/health", async () => ({ status: "ok" }));

  /** Verificação profunda, para quando algo estiver estranho. */
  app.get("/health/db", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "up" };
    } catch {
      return reply.status(503).send({ status: "degraded", database: "down" });
    }
  });
}
