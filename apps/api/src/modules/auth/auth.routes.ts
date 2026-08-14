import type { AuthResponse } from "@yu-book/shared";
import { loginSchema, registerSchema } from "@yu-book/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { env } from "../../env.js";
import { authenticate } from "../../lib/authenticate.js";
import { unauthorized } from "../../lib/errors.js";
import * as service from "./auth.service.js";
import type { Session } from "./auth.service.js";

const REFRESH_COOKIE = "yb_refresh";

/**
 * O cookie só é enviado para /auth — nenhuma outra rota precisa dele, e
 * limitar o Path reduz a superfície.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: "/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  } as const;
}

function sendSession(reply: FastifyReply, session: Session, status = 200): FastifyReply {
  const body: AuthResponse = {
    user: session.user,
    accessToken: session.accessToken,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };

  return reply.setCookie(REFRESH_COOKIE, session.refreshToken, cookieOptions()).status(status).send(body);
}

/**
 * Com SameSite=none (API e front em domínios diferentes na Railway) o cookie
 * viaja em requisições cross-site. Exigir um header customizado força preflight
 * CORS — que a nossa allowlist bloqueia. É a defesa contra CSRF aqui.
 */
function requireClientHeader(header: string | undefined): void {
  if (header !== "web") throw unauthorized("Origem não reconhecida");
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const session = await service.register(input, request.headers["user-agent"]);
    return sendSession(reply, session, 201);
  });

  app.post(
    "/auth/login",
    {
      config: {
        // Login é a única rota que vale a pena limitar de perto.
        rateLimit: { max: 10, timeWindow: "5 minutes" },
      },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const session = await service.login(input, request.headers["user-agent"]);
      return sendSession(reply, session);
    },
  );

  app.post("/auth/refresh", async (request, reply) => {
    requireClientHeader(request.headers["x-yu-book-client"] as string | undefined);

    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized("Sessão ausente");

    const session = await service.refresh(token, request.headers["user-agent"]);
    return sendSession(reply, session);
  });

  app.post("/auth/logout", async (request, reply) => {
    requireClientHeader(request.headers["x-yu-book-client"] as string | undefined);

    await service.logout(request.cookies[REFRESH_COOKIE]);
    return reply.clearCookie(REFRESH_COOKIE, cookieOptions()).status(204).send();
  });

  app.get("/me", { preHandler: [authenticate] }, async (request) => {
    return service.me(request.userId);
  });
}
