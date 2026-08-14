import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "yu-book";

export interface AccessTokenClaims {
  sub: string;
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: ISSUER });
  if (!payload.sub) throw new Error("Token sem subject");
  return { sub: payload.sub };
}

/**
 * O refresh token é opaco (não é JWT): não carrega claims, só serve para
 * localizar a sessão no banco — e assim pode ser revogado de verdade.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

/** SHA-256 basta aqui: a entrada tem 384 bits de entropia, não é uma senha. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
