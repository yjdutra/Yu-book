import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `env.ts` valida na importação e derruba o processo se faltar variável.
// Carregar o .env antes de qualquer import da aplicação é o que permite rodar
// os testes com o mesmo banco de desenvolvimento.
const arquivo = resolve(import.meta.dirname, "../.env");
if (existsSync(arquivo)) process.loadEnvFile(arquivo);

process.env.NODE_ENV ??= "test";
