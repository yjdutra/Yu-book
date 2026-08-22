import { z } from "zod";

/**
 * Mesmo padrão de `apps/api/src/env.ts`: valida no import e derruba o processo
 * se faltar variável. Falhar no boot é melhor que falhar na primeira chamada de
 * tool, quando o erro chega ao modelo como texto e ele tenta contornar.
 */
const envSchema = z.object({
  YUBOOK_API_URL: z.string().url().default("http://localhost:3333"),
  YUBOOK_EMAIL: z.string().email("YUBOOK_EMAIL inválido"),
  YUBOOK_PASSWORD: z.string().min(1, "YUBOOK_PASSWORD não pode ser vazio"),
});

const resultado = envSchema.safeParse(process.env);

if (!resultado.success) {
  // stderr, nunca stdout: em stdio o stdout é o canal do protocolo.
  console.error("Ambiente inválido para o servidor MCP do Yu-book:");
  for (const issue of resultado.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...resultado.data,
  // Barra final atrapalha a concatenação de caminho.
  YUBOOK_API_URL: resultado.data.YUBOOK_API_URL.replace(/\/+$/, ""),
};
