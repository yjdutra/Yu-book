import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa de no mínimo 32 caracteres"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /// Lista separada por vírgula. Em produção precisa ser explícita — sem `*`.
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  COOKIE_DOMAIN: z.string().optional(),
  /// `none` é obrigatório quando API e front estão em domínios diferentes
  /// (o padrão na Railway). Exige Secure, e o header anti-CSRF cobre o resto.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).optional(),

  /// Feche depois de criar sua conta. Signup aberto na internet = lixo no banco.
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`Configuração inválida:\n${issues.join("\n")}`);
  process.exit(1);
}

const raw = parsed.data;
const isProd = raw.NODE_ENV === "production";

export const env = {
  ...raw,
  isProd,
  /// Em dev o signup fica aberto para você criar a conta sem cerimônia.
  ALLOW_SIGNUP: process.env.ALLOW_SIGNUP === undefined ? !isProd : raw.ALLOW_SIGNUP,
  COOKIE_SAMESITE: raw.COOKIE_SAMESITE ?? (isProd ? ("none" as const) : ("lax" as const)),
  corsOrigins: raw.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

export type Env = typeof env;
