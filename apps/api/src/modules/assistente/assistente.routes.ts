import { Readable } from "node:stream";
import {
  aiFavoriteInputSchema,
  aiSettingsPatchSchema,
  aiTaskModelSchema,
  agentInputSchema,
  agentPreviewSchema,
  agentUpdateSchema,
  chatMessageInputSchema,
  conversationInputSchema,
  formatNoteSchema,
  listAiModelsQuerySchema,
  messageToNoteSchema,
  routineInputSchema,
  routineRunsQuerySchema,
  routineRunsSeenSchema,
  routineUpdateSchema,
  TAREFAS_COM_MODELO,
} from "@yu-book/shared";
import type { ChatEvent, RotinaEvent } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import * as agentes from "./agentes.service.js";
import * as service from "./assistente.service.js";
import * as chat from "./chat.service.js";
import * as conversas from "./conversas.service.js";
import * as execucao from "./execucao.service.js";
import * as formatar from "./formatar.service.js";
import * as modelos from "./modelos.service.js";
import * as preferencias from "./preferencias.service.js";
import * as rotinas from "./rotinas.service.js";

/**
 * Caminho em **inglês** com prefixo `/ai`, como todo o resto da fronteira; o
 * diretório, os arquivos e as funções seguem em português. O PRD escreveu
 * `/assistente/saude` no RF-08, mas o RNF-08 do mesmo documento repete a regra
 * do inglês — é lapso de um rascunho, e regra vence exemplo.
 */
const favoritoParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
/// Só as tarefas com modelo próprio: `rotina` usa o do agente, e aceitar
/// `PATCH /ai/tasks/rotina` gravaria uma escolha que nada lê.
const tarefaParamsSchema = z.object({ task: z.enum(TAREFAS_COM_MODELO) });
const notaParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
const conversaParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
const agenteParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
const rotinaParamsSchema = z.object({ id: z.string().uuid("Id inválido") });
const execucaoParamsSchema = z.object({ runId: z.string().uuid("Id inválido") });
/// `:id` é a conversa, como em todas as rotas de `/ai/conversations/…`.
const mensagemParamsSchema = z.object({
  id: z.string().uuid("Id inválido"),
  messageId: z.string().uuid("Id inválido"),
});

/**
 * Um evento no formato `text/event-stream`.
 *
 * Sem `event:` nomeado: o `tipo` já discrimina dentro do JSON, e um segundo
 * lugar dizendo a mesma coisa é um segundo lugar para divergir.
 */
function comoSse(evento: ChatEvent | RotinaEvent): string {
  return `data: ${JSON.stringify(evento)}\n\n`;
}

/**
 * Os cabeçalhos de todo `text/event-stream` daqui — o chat e a execução de
 * rotina (Etapa E). O porquê do `compress: false` que os acompanha está na
 * rota do chat, abaixo.
 */
const CABECALHOS_SSE = {
  "content-type": "text/event-stream; charset=utf-8",
  /// `no-transform` pede a qualquer intermediário que não recomprima.
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  /// O proxy da Railway é nginx: sem isto ele bufferiza a resposta inteira
  /// e o streaming vira uma entrega única, em produção e só em produção.
  "x-accel-buffering": "no",
} as const;

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

  /// Agentes especialistas (Etapa D).
  app.get("/ai/agents", async (request) => agentes.listar(request.userId));

  app.post("/ai/agents", async (request, reply) => {
    const entrada = agentInputSchema.parse(request.body);
    const agente = await agentes.criar(request.userId, entrada);
    return reply.status(201).send(agente);
  });

  /// O rascunho do editor, sem gravar: o que o agente receberia e quanto custa
  /// um passo. Não chama o provedor — é montagem e consulta ao banco.
  app.post("/ai/agents/preview", async (request) => {
    const rascunho = agentPreviewSchema.parse(request.body);
    return agentes.previaDoUsuario(request.userId, rascunho);
  });

  app.get("/ai/agents/:id", async (request) => {
    const { id } = agenteParamsSchema.parse(request.params);
    return agentes.buscarPorId(request.userId, id);
  });

  app.patch("/ai/agents/:id", async (request) => {
    const { id } = agenteParamsSchema.parse(request.params);
    const patch = agentUpdateSchema.parse(request.body);
    return agentes.atualizar(request.userId, id, patch);
  });

  app.delete("/ai/agents/:id", async (request, reply) => {
    const { id } = agenteParamsSchema.parse(request.params);
    await agentes.excluir(request.userId, id);
    return reply.status(204).send();
  });

  app.get("/ai/agents/:id/export", async (request, reply) => {
    const { id } = agenteParamsSchema.parse(request.params);
    const { arquivo, markdown } = await agentes.exportar(request.userId, id);
    return reply
      .header("content-type", "text/markdown; charset=utf-8")
      .header("content-disposition", `attachment; filename="${arquivo}"`)
      .send(markdown);
  });

  app.get("/ai/conversations", async (request) => conversas.listar(request.userId));

  app.post("/ai/conversations", async (request, reply) => {
    const { title, agentId } = conversationInputSchema.parse(request.body);
    const conversa = await conversas.criar(request.userId, title, agentId);
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

  /// Etapa C: a resposta do assistente vira nota marcada. O corpo da nota sai
  /// da mensagem gravada, nunca do cliente.
  app.post("/ai/conversations/:id/messages/:messageId/note", async (request, reply) => {
    const { id, messageId } = mensagemParamsSchema.parse(request.params);
    const entrada = messageToNoteSchema.parse(request.body);
    const nota = await conversas.virarNota(request.userId, id, messageId, entrada);
    return reply.status(201).send(nota);
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
          premissasCortadas: sessao.premissasCortadas,
        });
        for await (const evento of chat.conversar(sessao)) yield comoSse(evento);
      }

      return reply.headers(CABECALHOS_SSE).send(Readable.from(eventos()));
    },
  );

  /// Rotinas (Etapa E). O cadastro é CRUD comum; a execução responde 202 e
  /// segue no servidor, desacoplada da requisição.
  app.get("/ai/routines", async (request) => rotinas.listar(request.userId));

  app.post("/ai/routines", async (request, reply) => {
    const entrada = routineInputSchema.parse(request.body);
    const rotina = await rotinas.criar(request.userId, entrada);
    return reply.status(201).send(rotina);
  });

  app.get("/ai/routines/:id", async (request) => {
    const { id } = rotinaParamsSchema.parse(request.params);
    return rotinas.buscarPorId(request.userId, id);
  });

  app.patch("/ai/routines/:id", async (request) => {
    const { id } = rotinaParamsSchema.parse(request.params);
    const patch = routineUpdateSchema.parse(request.body);
    return rotinas.atualizar(request.userId, id, patch);
  });

  app.delete("/ai/routines/:id", async (request, reply) => {
    const { id } = rotinaParamsSchema.parse(request.params);
    await rotinas.excluir(request.userId, id);
    return reply.status(204).send();
  });

  /// "Rodar agora". 202: a execução começou e segue sem esta requisição. O
  /// limite de taxa é o mesmo das outras rotas que chamam o provedor.
  app.post(
    "/ai/routines/:id/runs",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = rotinaParamsSchema.parse(request.params);
      const iniciada = await execucao.iniciar(request.userId, id, request.log, {
        tipo: "manual",
      });
      return reply.status(202).send(iniciada);
    },
  );

  app.get("/ai/routines/:id/runs", async (request) => {
    const { id } = rotinaParamsSchema.parse(request.params);
    const query = routineRunsQuerySchema.parse(request.query);
    return rotinas.historico(request.userId, id, query);
  });

  app.get("/ai/runs/:runId", async (request) => {
    const { runId } = execucaoParamsSchema.parse(request.params);
    return rotinas.detalheDoRun(request.userId, runId);
  });

  /**
   * A execução ao vivo. Mesmo transporte e mesmos cabeçalhos do chat, com a
   * mesma segunda camada de `compress: false`. O primeiro evento é sempre o
   * retrato; a execução já terminada fecha logo depois dele, com `fim`.
   *
   * Fechar a aba **não** para a execução — é o ponto da etapa. Só tira este
   * assinante: o sinal abaixo acorda a espera e o `finally` do gerador o
   * desinscreve. `reply.raw` e não `request.raw`: o `close` da requisição
   * dispara ao fim do corpo dela, não quando o cliente vai embora.
   */
  app.get("/ai/runs/:runId/events", { compress: false }, async (request, reply) => {
    const { runId } = execucaoParamsSchema.parse(request.params);
    const fechou = new AbortController();
    reply.raw.on("close", () => fechou.abort());
    const fluxo = await execucao.assinar(request.userId, runId, fechou.signal);

    async function* eventos(): AsyncGenerator<string> {
      for await (const evento of fluxo) {
        /// Comentário SSE: mantém a conexão sem virar evento do outro lado.
        yield evento === "ping" ? ": ping\n\n" : comoSse(evento);
      }
    }

    return reply.headers(CABECALHOS_SSE).send(Readable.from(eventos()));
  });

  /// Etapa F: o Início mostrou as execuções novas. Sem corpo, vale agora.
  app.post("/ai/runs/seen", async (request, reply) => {
    const { seenAt } = routineRunsSeenSchema.parse(request.body ?? {});
    await preferencias.marcarExecucoesVistas(request.userId, seenAt ? new Date(seenAt) : null);
    return reply.status(204).send();
  });

  /// Cancelar. Idempotente: execução que já terminou responde igual. O
  /// status final chega pelo SSE, quando o motor terminar de gravar.
  app.post("/ai/runs/:runId/cancel", async (request, reply) => {
    const { runId } = execucaoParamsSchema.parse(request.params);
    await execucao.cancelar(request.userId, runId);
    return reply.status(204).send();
  });
}
