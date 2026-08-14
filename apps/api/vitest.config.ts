import { defineConfig } from "vitest/config";

/**
 * Testes de integração de verdade: sobem o Fastify inteiro e falam com o
 * Postgres do `DATABASE_URL`. Nada de mock de banco — o que precisa ser
 * verificado aqui (renumeração em transação, posse resolvida por join,
 * índice trigram na busca) só existe no banco.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Uma suíte por vez: elas compartilham o mesmo banco.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
