import { placeDetailQuerySchema, placeMapQuerySchema, placeSearchQuerySchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./lugares.service.js";

const paramsSchema = z.object({ placeId: z.string().trim().min(1).max(300) });

/** Lugares do Google para o local do evento — a API é a única que fala com ele. */
export async function lugaresRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/places/autocomplete", async (request) => {
    const { q, session } = placeSearchQuerySchema.parse(request.query);
    return service.sugerir(q, session);
  });

  // Antes de `/places/:placeId`, que senão o engoliria.
  app.get("/places/map", async (request, reply) => {
    const { lat, lng, tema } = placeMapQuerySchema.parse(request.query);
    const { bytes, tipo } = await service.mapa(lat, lng, tema);
    // O mesmo ponto é a mesma imagem: o aparelho guarda por um dia.
    return reply.type(tipo).header("cache-control", "private, max-age=86400").send(bytes);
  });

  app.get("/places/:placeId", async (request) => {
    const { placeId } = paramsSchema.parse(request.params);
    const { session } = placeDetailQuerySchema.parse(request.query);
    return service.detalhar(placeId, session);
  });
}
