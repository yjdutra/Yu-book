import type { FastifyReply, FastifyRequest } from "fastify";
import { errors as joseErrors } from "jose";
import { AppError, unauthorized } from "./errors.js";
import { verifyAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo preHandler `authenticate`. Única fonte de identidade. */
    userId: string;
  }
}

/**
 * preHandler das rotas protegidas.
 *
 * O `userId` sai SEMPRE do token — nunca do body, da query ou de um header.
 * Toda query do banco filtra por ele.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw unauthorized("Token de acesso ausente");
  }

  try {
    const claims = await verifyAccessToken(header.slice("Bearer ".length));
    request.userId = claims.sub;
  } catch (error) {
    // O front distingue os dois: expirado dispara o refresh, inválido derruba a sessão.
    throw error instanceof joseErrors.JWTExpired
      ? new AppError(401, "TOKEN_EXPIRED", "Token expirado")
      : unauthorized("Token inválido");
  }
}
