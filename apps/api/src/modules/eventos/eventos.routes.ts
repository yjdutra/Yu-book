import {
  agendaQuerySchema,
  conversionScopeSchema,
  eventInputSchema,
  eventScopeSchema,
  eventToTaskSchema,
  eventUpdateSchema,
} from "@yu-book/shared";
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

  // Numa série, o escopo vem na query: `?scope=esta|seguintes|todas&occurrenceDate=AAAA-MM-DD`.
  app.patch("/events/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const escopo = eventScopeSchema.parse(request.query);
    const input = eventUpdateSchema.parse(request.body);
    return service.atualizarEvento(request.userId, id, input, escopo);
  });

  // O evento vira tarefa. Numa série o alcance é obrigatório: `esta` (com
  // `occurrenceDate`) converte a ocorrência; `todas` faz da série uma tarefa
  // recorrente. O corpo, opcional, passa por cima do que se tira do evento.
  app.post("/events/:id/to-task", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const escopo = conversionScopeSchema.parse(request.query);
    const input = eventToTaskSchema.parse(request.body ?? {});
    const tarefa = await service.converterEventoEmTarefa(request.userId, id, input, escopo);
    return reply.status(201).send(tarefa);
  });

  app.delete("/events/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const escopo = eventScopeSchema.parse(request.query);
    await service.excluirEvento(request.userId, id, escopo);
    return reply.status(204).send();
  });

  // Eventos, tarefas e cards com prazo de um período, numa requisição.
  app.get("/agenda", async (request) => {
    const query = agendaQuerySchema.parse(request.query);
    return service.agendaDoPeriodo(request.userId, query);
  });
}
