import { hash, verify } from "@node-rs/argon2";
import type { LoginInput, PublicUser, RegisterInput } from "@yu-book/shared";
import { prisma } from "../../db.js";
import { AppError, invalidCredentials, unauthorized } from "../../lib/errors.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../../lib/tokens.js";
import { env } from "../../env.js";

/** Parâmetros OWASP para argon2id. */
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Quanto tempo um refresh token recém-consumido pode reaparecer sem que isso
 * seja tratado como vazamento. Ver o comentário em `refresh()`.
 */
const GRACA_DE_REUSO_MS = 30_000;

export interface Session {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

function toPublicUser(user: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(
  user: { id: string; email: string; name: string; createdAt: Date },
  userAgent?: string,
): Promise<Session> {
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: userAgent?.slice(0, 255),
    },
  });

  return {
    user: toPublicUser(user),
    accessToken: await signAccessToken(user.id),
    refreshToken,
  };
}

export async function register(input: RegisterInput, userAgent?: string): Promise<Session> {
  if (!env.ALLOW_SIGNUP) {
    throw new AppError(403, "SIGNUP_DISABLED", "Cadastro fechado");
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, "EMAIL_TAKEN", "Já existe uma conta com esse email");
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hash(input.password, ARGON_OPTIONS),
    },
  });

  return issueSession(user, userAgent);
}

export async function login(input: LoginInput, userAgent?: string): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Sem atalho no caminho "usuário não existe": verificar um hash descartável
  // mantém o tempo de resposta parecido e não entrega quais emails existem.
  if (!user) {
    await hash("senha-inexistente-para-igualar-o-tempo", ARGON_OPTIONS);
    throw invalidCredentials();
  }

  const ok = await verify(user.passwordHash, input.password);
  if (!ok) throw invalidCredentials();

  return issueSession(user, userAgent);
}

/**
 * Rotação: o token apresentado é revogado e um novo é emitido no mesmo instante.
 * Um refresh token nunca serve duas vezes.
 */
export async function refresh(presentedToken: string, userAgent?: string): Promise<Session> {
  const tokenHash = hashRefreshToken(presentedToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) throw unauthorized("Sessão inválida");

  if (stored.revokedAt) {
    // Janela de graça antes de concluir que o token vazou.
    //
    // O motivo é o servidor MCP, que não é navegador. Ele **não** retenta por
    // conta própria — quem retenta é o cliente MCP do outro lado, contra o
    // `/token` dele. A rotação da API é atômica e o cookie novo só existe na
    // resposta: se ela se perder no caminho, ou o processo reiniciar entre o
    // commit e a entrega, o cliente ainda tem o cookie anterior e o reapresenta
    // de boa-fé. Sem esta janela, isso derruba **todas** as sessões do usuário
    // — inclusive a do navegador dele, que não fez nada.
    //
    // O QUE ESTA JANELA CUSTA, declarado: ela cega exatamente a corrida que a
    // rotação existe para pegar. Se alguém roubar um refresh e usá-lo primeiro,
    // a apresentação do legítimo chega segundos depois — e agora vira 401 mudo
    // em vez de revogar a cadeia roubada. O legítimo é obrigado a autorizar de
    // novo (o usuário percebe), mas o ladrão sobrevive à janela.
    //
    // A troca foi decidida com esse número na mão: 30 s de cegueira contra não
    // deslogar o operador de todo lugar por uma resposta perdida. Reuso fora da
    // janela continua caindo no ramo de baixo.
    if (Date.now() - stored.revokedAt.getTime() < GRACA_DE_REUSO_MS) {
      throw unauthorized("Sessão expirada");
    }

    // Token revogado há tempo reaparecendo = ele vazou e está sendo reusado.
    // Derruba todas as sessões: quem for legítimo faz login de novo.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Sessão revogada");
  }

  if (stored.expiresAt < new Date()) throw unauthorized("Sessão expirada");

  // updateMany com o filtro `revokedAt: null` é o que garante atomicidade:
  // em dois refreshes simultâneos, só um consome o token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw unauthorized("Sessão expirada");

  return issueSession(stored.user, userAgent);
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized("Usuário não encontrado");
  return toPublicUser(user);
}

/** Higiene: remove sessões expiradas/revogadas antigas. Chamado no boot. */
export async function pruneRefreshTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { count } = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
  });
  return count;
}
