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

  /// Opcional. Sem ela, links do YouTube ainda ganham título e miniatura
  /// (via oEmbed, que não pede chave) — só a duração fica de fora.
  YOUTUBE_API_KEY: z.string().optional(),

  /// Opcional. Sem ela a API sobe normal e só as funções de IA ficam
  /// indisponíveis, com o motivo na tela (RF-05, RNF-03, CA-02).
  OPENROUTER_API_KEY: z.string().optional(),
  /// O host do provedor. Existe como variável por um motivo só: é o que deixa a
  /// suíte apontar para um dublê local em vez de gastar dinheiro de verdade.
  /// Em produção ninguém define — o padrão é o endereço real.
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  /// Atribuição no painel do OpenRouter (header `HTTP-Referer`). Sem ela a
  /// chamada funciona igual.
  OPENROUTER_APP_URL: z.string().url().optional(),
  /// Opcional. A *management key* do OpenRouter, que alimenta o saldo, o
  /// histórico de 30 dias e as métricas de `/ajustes/openrouter`. Ela **não faz
  /// inferência**, e no provedor **cria e apaga chaves** — por isso a API a usa
  /// só em leitura, em caminhos fixos: `GET /credits`, `GET /activity`,
  /// `GET /analytics/meta` e `POST /analytics/query` (consulta, não escrita).
  /// Nunca `/keys`, nada que mude estado, e ela nunca aparece numa resposta
  /// (`openrouter-painel.service.ts`). Sem ela, a tela mostra só a chave comum.
  OPENROUTER_MANAGEMENT_KEY: z.string().optional(),

  /// Frente de cards, Parte 2: o bucket dos anexos (Railway Storage Bucket, ou
  /// qualquer S3). Opcionais, como a chave de IA: sem as quatro primeiras a API
  /// sobe normal e só os anexos ficam indisponíveis, com o motivo na tela. Na
  /// Railway, cada uma recebe por referência a variável que o bucket injeta
  /// (`ENDPOINT`, `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`).
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_REGION: z.string().default("auto"),
  /// O bucket da Railway fala só o estilo virtual-hosted (bucket no subdomínio).
  /// O caminho existe para o dublê da suíte, em `127.0.0.1`, onde subdomínio
  /// não resolve.
  S3_PATH_STYLE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),

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
