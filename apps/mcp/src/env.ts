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
  /**
   * Destrava a escrita contra uma API que não seja local. Opcional de
   * propósito: o padrão é o seguro, e sair dele custa uma decisão escrita.
   */
  YUBOOK_ESCRITA_REMOTA: z.string().optional(),
});

/** Hosts em que escrever não custa nada se o modelo entender errado. */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function ehLocal(url: string): boolean {
  try {
    return HOSTS_LOCAIS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const resultado = envSchema.safeParse(process.env);

if (!resultado.success) {
  // stderr, nunca stdout: em stdio o stdout é o canal do protocolo.
  console.error("Ambiente inválido para o servidor MCP do Yu-book:");
  for (const issue of resultado.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const YUBOOK_API_URL = resultado.data.YUBOOK_API_URL.replace(/\/+$/, "");

export const env = {
  ...resultado.data,
  // Barra final atrapalha a concatenação de caminho.
  YUBOOK_API_URL,
  /**
   * Enquanto o servidor só lia, apontar para produção era inofensivo. Com tools
   * de escrita, um pedido mal interpretado cria dado de verdade no segundo
   * cérebro, e não existe desfazer deste lado. Por isso a escrita nasce
   * desligada fora de um host local: quem quiser escrever remoto declara.
   */
  escritaLiberada: ehLocal(YUBOOK_API_URL) || resultado.data.YUBOOK_ESCRITA_REMOTA === "1",
  apiEhLocal: ehLocal(YUBOOK_API_URL),
};
