import { Readable } from "node:stream";
import {
  AI_TASKS,
  aiFavoriteInputSchema,
  aiSettingsPatchSchema,
  aiTaskModelSchema,
  chatMessageInputSchema,
  conversationInputSchema,
  formatNoteSchema,
  listAiModelsQuerySchema,
} from "@yu-book/shared";
import type { ChatEvent } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as service from "./assistente.service.js";
import * as chat from "./chat.service.js";
import * as conversas from "./conversas.service.js";
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
const conversaParamsSchema = z.object({ id: z.string().uuid("Id inválido") });

/**
 * Um evento no formato `text/event-stream`.
 *
 * Sem `event:` nomeado: o `tipo` já discrimina dentro do JSON, e um segundo
 * lugar dizendo a mesma coisa é um segundo lugar para divergir.
 */
function comoSse(evento: ChatEvent): string {
  return `data: ${JSON.stringify(evento)}\n\n`;
}

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

  app.get("/ai/conversations", async (request) => conversas.listar(request.userId));

  app.post("/ai/conversations", async (request, reply) => {
    const { title } = conversationInputSchema.parse(request.body);
    const conversa = await conversas.criar(request.userId, title);
    return reply.status(201).send(conversa);
  });

  app.get("/ai/conversations/:id", async (request) => {
    const { id } = conversaParamsSchema.parse(request.params);
    return conversas.buscarPorId(request.userId, id);
  });

  app.patch("/ai/conversations/:id", async (request) => {
    const { id } = conversaParamsSchema.parse(request.params);
    const { title } = conversationInputSchema.parse(request.body);
    return conversas.renomear(request.userId, id, title);
  });

  /// RF-24: apagar a conversa não toca em nota nem em card.
  app.delete("/ai/conversations/:id", async (request, reply) => {
    const { id } = conversaParamsSchema.parse(request.params);
    await conversas.excluir(request.userId, id);
    return reply.status(204).send();
  });

  /**
   * A mensagem, com a resposta em `text/event-stream` (RF-22).
   *
   * **`compress: false` é segunda camada, não a primeira — e foi medido.** O
   * `@fastify/compress` está com `global: true`, mas a regex de tipos
   * compressíveis dele já exclui SSE de propósito
   * (`/^text\/(?!event-stream)|…/`, `@fastify/compress@9.2.0`): sem esta linha
   * a resposta sai **sem** `content-encoding` e o fluxo chega fatiado do mesmo
   * jeito, conferido nos dois estados. A linha fica porque a exclusão é do
   * *padrão* do plugin: um `customTypes` no registro global a substitui inteira,
   * e aí o streaming pararia de fluir sem nenhum teste ficar vermelho. É o
   * mesmo raciocínio das duas travas de escrita do servidor MCP.
   *
   * Note que a opção é `compress` **no topo** das opções da rota, e não
   * `config: { compress: false }` — o plugin lê `routeOptions.compress` no
   * `onRoute`, e sob `config` ela seria ignorada em silêncio.
   *
   * Enviado como stream pelo `reply.send`, e **não** por `reply.hijack()`:
   * hijack pula os hooks de `onSend`, e é neles que o `@fastify/cors` põe os
   * cabeçalhos de CORS — o front em outra origem deixaria de conseguir ler a
   * resposta.
   *
   * O limite de taxa é o mesmo da formatação, e pelo mesmo motivo: o global de
   * 300/min por IP não protege contra dez pedidos de um minuto cada.
   */
  app.post(
    "/ai/conversations/:id/messages",
    {
      compress: false,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = conversaParamsSchema.parse(request.params);
      const entrada = chatMessageInputSchema.parse(request.body);

      /// Tudo o que pode ser recusado **antes** do primeiro byte é recusado
      /// aqui, com status HTTP e código estável, como em qualquer rota. Depois
      /// que o fluxo abre não há mais status — o erro vira evento.
      const sessao = await chat.preparar(request.userId, id, entrada);

      async function* eventos(): AsyncGenerator<string> {
        /// A mensagem do usuário volta primeiro: a tela troca o rascunho local
        /// pelo persistido, e o aviso de anexo cortado sai junto (RNF-04).
        yield comoSse({
          tipo: "inicio",
          mensagem: sessao.mensagemDoUsuario,
          cortados: sessao.cortados,
        });
        for await (const evento of chat.conversar(sessao)) yield comoSse(evento);
      }

      return reply
        .header("content-type", "text/event-stream; charset=utf-8")
        /// `no-transform` pede a qualquer intermediário que não recomprima.
        .header("cache-control", "no-cache, no-transform")
        .header("connection", "keep-alive")
        /// O proxy da Railway é nginx: sem isto ele bufferiza a resposta inteira
        /// e o streaming vira uma entrega única, em produção e só em produção.
        .header("x-accel-buffering", "no")
        .send(Readable.from(eventos()));
    },
  );
}
