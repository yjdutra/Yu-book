import { agendaQuerySchema, eventInputSchema, eventUpdateSchema } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./eventos.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

/** Eventos e o agregado da agenda — frente de agenda, Fase 1. */
export async function eventosRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota daqui exige token; o userId vem dele e de mais lugar nenhum.
  app.addHook("preHandler", authenticate);

  app.get("/events", async (request) => {
    const query = agendaQuerySchema.parse(request.query);
    return service.listarEventos(request.userId, query);
  });

  app.post("/events", async (request, reply) => {
    // `origin` não é campo do evento: vira a marca de IA, e só o MCP o envia.
    const { origin, ...input } = eventInputSchema.parse(request.body);
    const evento = await service.criarEvento(request.userId, input, origin);
    return reply.status(201).send(evento);
  });

  app.get("/events/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.buscarEvento(request.userId, id);
  });

  app.patch("/events/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = eventUpdateSchema.parse(request.body);
    return service.atualizarEvento(request.userId, id, input);
  });

  app.delete("/events/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirEvento(request.userId, id);
    return reply.status(204).send();
  });

  // Eventos, tarefas e cards com prazo de um período, numa requisição.
  app.get("/agenda", async (request) => {
    const query = agendaQuerySchema.parse(request.query);
    return service.agendaDoPeriodo(request.userId, query);
  });
}
