import { defineConfig } from "vitest/config";

/**
 * Ao contrário do `apps/api`, **nenhum teste daqui toca rede ou banco.** O que
 * se verifica neste pacote é aritmética de prazo e cifra de envelope: dá para
 * provar sem subir nada, e um teste que precisasse de Postgres para conferir
 * uma subtração seria um teste que ninguém roda.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
