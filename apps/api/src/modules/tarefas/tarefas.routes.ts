import {
  taskCompleteSchema,
  taskInputSchema,
  tasksQuerySchema,
  taskUpdateSchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./tarefas.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

/** Tarefas — frente de agenda, Fase 1. */
export async function tarefasRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota daqui exige token; o userId vem dele e de mais lugar nenhum.
  app.addHook("preHandler", authenticate);

  app.get("/tasks", async (request) => {
    const query = tasksQuerySchema.parse(request.query);
    return service.listarTarefas(request.userId, query);
  });

  app.post("/tasks", async (request, reply) => {
    // `origin` não é campo da tarefa: vira a marca de IA, e só o MCP o envia.
    const { origin, ...input } = taskInputSchema.parse(request.body);
    const tarefa = await service.criarTarefa(request.userId, input, origin);
    return reply.status(201).send(tarefa);
  });

  app.get("/tasks/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.buscarTarefa(request.userId, id);
  });

  app.patch("/tasks/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = taskUpdateSchema.parse(request.body);
    return service.atualizarTarefa(request.userId, id, input);
  });

  app.patch("/tasks/:id/complete", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    // Como no `PATCH /cards/:id/complete`: o único PATCH da tarefa que aceita
    // `origin`, que vira a marca de quem concluiu (INV-63).
    const { completed, origin } = taskCompleteSchema.parse(request.body);
    return service.concluirTarefa(request.userId, id, completed, origin);
  });

  app.delete("/tasks/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirTarefa(request.userId, id);
    return reply.status(204).send();
  });
}
