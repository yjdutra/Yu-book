import multipart from "@fastify/multipart";
import { MAX_BYTES_ARQUIVO } from "@yu-book/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../lib/authenticate.js";
import { AppError } from "../../lib/errors.js";
import * as service from "./arquivos.service.js";

const cardParamsSchema = z.object({ id: z.string().uuid() });
const arquivoParamsSchema = z.object({ id: z.string().uuid(), fileId: z.string().uuid() });

const grande = () =>
  new AppError(413, "ARQUIVO_GRANDE", `O arquivo passa de ${MAX_BYTES_ARQUIVO / 1024 / 1024} MB`);

/**
 * Anexos de card (frente de cards, Parte 2).
 *
 * O multipart é registrado **só aqui**: o plugin fica encapsulado nesta
 * instância, e o resto da API continua aceitando só JSON com o teto padrão de
 * 1 MiB. Um arquivo por requisição e nenhum campo além dele — o nome vem do
 * próprio arquivo.
 */
export async function arquivosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  await app.register(multipart, {
    limits: { fileSize: MAX_BYTES_ARQUIVO, files: 1, fields: 0, parts: 1 },
  });

  app.get("/cards/:id/files", async (request) => {
    const { id } = cardParamsSchema.parse(request.params);
    return service.listar(request.userId, id);
  });

  app.post(
    "/cards/:id/files",
    // Cada subida atravessa a rede até o bucket e pode ter 25 MB.
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = cardParamsSchema.parse(request.params);
      // Antes de ler o corpo: card alheio ou cheio responde sem custar 25 MB.
      await service.conferirEnvio(request.userId, id);
      const parte = await request.file();
      if (!parte) throw new AppError(422, "VALIDATION_ERROR", "Envie um arquivo");

      let bytes: Buffer;
      try {
        bytes = await parte.toBuffer();
      } catch (erro) {
        // O limite do plugin sai como erro próprio dele; aqui vira o nosso,
        // para a tela decidir pelo código e não pela frase.
        if ((erro as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw grande();
        throw erro;
      }

      const arquivo = await service.enviar(request.userId, id, {
        nome: parte.filename,
        bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      });
      return reply.status(201).send(arquivo);
    },
  );

  app.delete("/cards/:id/files/:fileId", async (request, reply) => {
    const { id, fileId } = arquivoParamsSchema.parse(request.params);
    await service.excluir(request.userId, id, fileId);
    return reply.status(204).send();
  });
}
