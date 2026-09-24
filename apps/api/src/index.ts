import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import {
  encerrarExecucoes,
  reconciliarExecucoes,
  vigiarExecucoes,
} from "./modules/assistente/execucao.service.js";
import { pruneRefreshTokens } from "./modules/auth/auth.service.js";

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    const pruned = await pruneRefreshTokens();
    if (pruned > 0) app.log.info({ pruned }, "sessões antigas removidas");
  } catch (error) {
    app.log.warn({ err: error }, "não foi possível limpar sessões antigas");
  }

  /// Etapa E: execução de rotina em andamento que ninguém pulsa mais morreu
  /// com um processo. Só a de pulso vencido — no deploy a instância antiga
  /// ainda roda as dela enquanto esta sobe. A varredura repete isto a cada
  /// minuto, porque quem morre pode ser a outra instância, depois deste boot.
  try {
    const interrompidas = await reconciliarExecucoes();
    if (interrompidas > 0) app.log.info({ interrompidas }, "execuções de rotina interrompidas");
  } catch (error) {
    app.log.warn({ err: error }, "não foi possível reconciliar as execuções de rotina");
  }
  const pararVarredura = vigiarExecucoes(app.log);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "encerrando");
    pararVarredura();
    /// Antes de `app.close()`: abortar as execuções de rotina e esperar cada
    /// uma gravar `interrompida`, com o banco ainda conectado. O que não
    /// gravar a tempo para de pulsar, e a varredura da instância nova o fecha.
    const abortadas = await encerrarExecucoes().catch(() => 0);
    if (abortadas > 0) app.log.info({ abortadas }, "execuções de rotina interrompidas");
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
