import {
  AI_TASKS,
  aiFavoriteInputSchema,
  aiSettingsPatchSchema,
  aiTaskModelSchema,
  formatNoteSchema,
  listAiModelsQuerySchema,
} from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./assistente.service.js";
import * as formatar from "./formatar.service.js";
import * as modelos from "./modelos.service.js";
import * as preferencias from "./preferencias.service.js";

/**
 * Caminho em **inglês** com prefixo `/ai`, como todo o resto da fronteira; o
 * diretório, os arquivos e as funções seguem em português. O PRD escreveu
 * `/assistente/saude` no RF-08, mas o RNF-08 do mesmo documento repete a regra
 * do inglês — é lapso de um rascunho, e regra vence exemplo.
 */
const favoritoParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
const tarefaParamsSchema = z.object({ task: z.enum(AI_TASKS) });
const notaParamsSchema = z.object({ id: z.string().uuid("Id inválido") });

export async function assistenteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/ai/health", async () => service.saude());

  app.get("/ai/models", async (request) => {
    const query = listAiModelsQuerySchema.parse(request.query);
    return modelos.listarModelos(query);
  });

  /// A tela de ajustes inteira numa requisição: os três blocos aparecem juntos,
  /// mesmo raciocínio da gaveta de links.
  app.get("/ai/settings", async (request) => preferencias.montarSettings(request.userId));

  app.patch("/ai/settings", async (request) => {
    const patch = aiSettingsPatchSchema.parse(request.body);
    return preferencias.atualizarPreferencia(request.userId, patch);
  });

  /// O id do modelo vem no corpo, não no caminho: o slug do provedor tem barra
  /// (`anthropic/claude-x`) e estouraria o roteamento.
  app.post("/ai/favorites", async (request, reply) => {
    const { modelId } = aiFavoriteInputSchema.parse(request.body);
    const { favorito, criado } = await preferencias.favoritar(request.userId, modelId);
    return reply.status(criado ? 201 : 200).send(favorito);
  });

  app.delete("/ai/favorites/:id", async (request, reply) => {
    const { id } = favoritoParamsSchema.parse(request.params);
    await preferencias.desfavoritar(request.userId, id);
    return reply.status(204).send();
  });

  app.patch("/ai/tasks/:task", async (request) => {
    const { task } = tarefaParamsSchema.parse(request.params);
    const { modelId } = aiTaskModelSchema.parse(request.body);
    return preferencias.definirModeloDaTarefa(request.userId, task, modelId);
  });

  /// Limite próprio: o global é de 300/min por IP e não protege contra dez
  /// chamadas de vinte segundos. É cinto; o suspensório é o teto diário.
  app.post(
    "/ai/notes/:id/format",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const { id } = notaParamsSchema.parse(request.params);
      const { contentMd } = formatNoteSchema.parse(request.body);
      return formatar.formatarNota(request.userId, id, contentMd);
    },
  );
}
