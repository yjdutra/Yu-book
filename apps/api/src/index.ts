import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { pruneRefreshTokens } from "./modules/auth/auth.service.js";

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    const pruned = await pruneRefreshTokens();
    if (pruned > 0) app.log.info({ pruned }, "sessões antigas removidas");
  } catch (error) {
    app.log.warn({ err: error }, "não foi possível limpar sessões antigas");
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "encerrando");
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error) => {
  console.error("falha ao subir a API", error);
  process.exit(1);
});
