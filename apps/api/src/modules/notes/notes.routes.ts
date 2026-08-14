import {
  createNoteSchema,
  listNotesQuerySchema,
  searchQuerySchema,
  updateNoteSchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as notes from "./notes.service.js";
import * as search from "./search.service.js";

const paramsSchema = z.object({ id: z.string().uuid("Id inválido") });
const escopoSchema = z.object({ workspaceId: z.string().uuid().optional() });

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  // Toda rota daqui exige token; o userId vem dele e de mais lugar nenhum.
  app.addHook("preHandler", authenticate);

  app.get("/notes", async (request) => {
    const query = listNotesQuerySchema.parse(request.query);
    return notes.listar(request.userId, query);
  });

  app.get("/notes/counts", async (request) => {
    const { workspaceId } = escopoSchema.parse(request.query);
    return notes.contar(request.userId, workspaceId);
  });

  app.get("/notes/titles", async (request) => notes.titulos(request.userId));

  app.get("/search", async (request) => {
    const { q, limit, workspaceId } = searchQuerySchema.parse(request.query);
    return search.buscar(request.userId, q, limit, workspaceId);
  });

  app.post("/notes", async (request, reply) => {
    const input = createNoteSchema.parse(request.body);
    const nota = await notes.criar(request.userId, input);
    return reply.status(201).send(nota);
  });

  app.get("/notes/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return notes.buscarPorId(request.userId, id);
  });

  app.patch("/notes/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const input = updateNoteSchema.parse(request.body);
    return notes.atualizar(request.userId, id, input);
  });

  app.delete("/notes/:id", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await notes.excluir(request.userId, id);
    return reply.status(204).send();
  });

  app.post("/notes/:id/restore", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return notes.restaurar(request.userId, id);
  });

  app.delete("/notes/:id/permanent", async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    await notes.excluirDefinitivo(request.userId, id);
    return reply.status(204).send();
  });
}
