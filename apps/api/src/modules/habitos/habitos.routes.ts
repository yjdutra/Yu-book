import {
  eventCheckInQuerySchema,
  eventCheckInSchema,
  habitActivityInputSchema,
  habitActivityUpdateSchema,
  habitEntriesQuerySchema,
  habitEntryInputSchema,
  habitInputSchema,
  habitsQuerySchema,
  habitUpdateSchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./habitos.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });

/** Hábitos — frente Ritmo, Ritmo 1 (docs/prd-ritmo.md, §4.5). */
export async function habitosRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota daqui exige token; o userId vem dele e de mais lugar nenhum.
  app.addHook("preHandler", authenticate);

  app.get("/habits", async (request) => {
    const { includeArchived } = habitsQuerySchema.parse(request.query);
    return service.listarHabitos(request.userId, includeArchived);
  });

  // Caminho fixo: o Fastify o casa antes de `/habits/:id`, e "summary" nunca
  // chega ao `uuid()` do parâmetro.
  app.get("/habits/summary", async (request) => service.resumirRitmo(request.userId));

  app.post("/habits", async (request, reply) => {
    const input = habitInputSchema.parse(request.body);
    return reply.status(201).send(await service.criarHabito(request.userId, input));
  });

  app.get("/habits/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return service.buscarHabito(request.userId, id);
  });

  app.patch("/habits/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = habitUpdateSchema.parse(request.body);
    return service.atualizarHabito(request.userId, id, input);
  });

  app.delete("/habits/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirHabito(request.userId, id);
    return reply.status(204).send();
  });

  app.post("/habits/:id/activities", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const input = habitActivityInputSchema.parse(request.body);
    return reply.status(201).send(await service.criarAtividade(request.userId, id, input));
  });

  app.patch("/habit-activities/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = habitActivityUpdateSchema.parse(request.body);
    return service.atualizarAtividade(request.userId, id, input);
  });

  app.delete("/habit-activities/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirAtividade(request.userId, id);
    return reply.status(204).send();
  });

  app.get("/habits/:id/entries", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const periodo = habitEntriesQuerySchema.parse(request.query);
    return service.listarRegistros(request.userId, id, periodo);
  });

  app.post("/habits/:id/entries", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    // `origin` não é campo do registro: vira a marca de quem registrou (RN-12),
    // e só o MCP o envia.
    const { origin, ...input } = habitEntryInputSchema.parse(request.body);
    const registro = await service.registrarAvulso(request.userId, id, input, origin);
    return reply.status(201).send(registro);
  });

  app.delete("/habit-entries/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await service.excluirRegistro(request.userId, id);
    return reply.status(204).send();
  });

  // O check-in mora aqui, e não com os eventos: é escrita de registro de
  // hábito, e o evento só empresta a ocorrência (RF-08).
  app.post("/events/:id/check-in", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const { day, origin } = eventCheckInSchema.parse(request.body);
    return reply.status(201).send(await service.fazerCheckIn(request.userId, id, day, origin));
  });

  app.delete("/events/:id/check-in", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const { day } = eventCheckInQuerySchema.parse(request.query);
    await service.desfazerCheckIn(request.userId, id, day);
    return reply.status(204).send();
  });
}
