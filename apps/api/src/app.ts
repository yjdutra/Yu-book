import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { ApiErrorBody } from "@yu-book/shared";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { env } from "./env.js";
import { AppError } from "./lib/errors.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { healthRoutes } from "./modules/health.routes.js";
import { kanbanRoutes } from "./modules/kanban/kanban.routes.js";
import { linksRoutes } from "./modules/links/links.routes.js";
import { notesRoutes } from "./modules/notes/notes.routes.js";
import { organizacaoRoutes } from "./modules/organizacao/organizacao.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProd
      ? { level: "info" }
      : { level: "debug", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } } },
    trustProxy: true, // a Railway fica na frente do processo
  });

  await app.register(helmet);

  // JSON comprime muito bem — o corpo de uma nota e um board cheio são texto.
  // Abaixo de 1 KB o ganho não paga o CPU, então fica de fora.
  await app.register(compress, { global: true, threshold: 1024, encodings: ["gzip", "deflate"] });

  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true, // o cookie de refresh depende disso
    allowedHeaders: ["Content-Type", "Authorization", "X-Yu-Book-Client"],
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos",
          issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      };
      return reply.status(422).send(body);
    }

    if (error instanceof AppError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
      return reply.status(error.statusCode).send(body);
    }

    if (error.statusCode === 429) {
      const body: ApiErrorBody = {
        error: { code: "RATE_LIMITED", message: "Muitas tentativas. Tente de novo em instantes." },
      };
      return reply.status(429).send(body);
    }

    // 4xx levantado pelo próprio Fastify (JSON malformado, corpo vazio com
    // Content-Type json, media type não suportado). É erro do cliente: marcar
    // como INTERNAL_ERROR enganaria o front, que decide o que fazer pelo `code`.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      const body: ApiErrorBody = {
        error: { code: "VALIDATION_ERROR", message: error.message },
      };
      return reply.status(error.statusCode).send(body);
    }

    // Erro não previsto: log completo no servidor, mensagem genérica para fora.
    request.log.error({ err: error }, "erro não tratado");
    const body: ApiErrorBody = {
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiErrorBody = { error: { code: "NOT_FOUND", message: "Rota não encontrada" } };
    return reply.status(404).send(body);
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(notesRoutes);
  await app.register(organizacaoRoutes);
  await app.register(kanbanRoutes);
  await app.register(linksRoutes);
  await app.register(dashboardRoutes);

  return app;
}
