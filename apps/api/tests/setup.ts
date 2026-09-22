import { existsSync } from "node:fs";
import { resolve } from "node:path";

// `env.ts` valida na importação e derruba o processo se faltar variável.
// Carregar o .env antes de qualquer import da aplicação é o que permite rodar
// os testes com o mesmo banco de desenvolvimento.
const arquivo = resolve(import.meta.dirname, "../.env");
if (existsSync(arquivo)) process.loadEnvFile(arquivo);

process.env.NODE_ENV ??= "test";

// A suíte nunca pode falar com o OpenRouter de verdade — chamada de modelo custa
// dinheiro. Porta fixa porque `env.ts` congela na importação e o teste não tem
// como sortear uma porta depois; colisão falha alto, que é o comportamento certo.
// `openrouter.service.ts` ainda lança se, apesar disto, o host real aparecer.
process.env.OPENROUTER_BASE_URL ??= "http://127.0.0.1:39333/api/v1";

// Chave de mentira, para a suíte conseguir exercitar o caminho de inferência
// numa máquina sem chave nenhuma. O dublê não a confere: quem mantém a suíte
// longe do provedor de verdade é o destino redirecionado acima mais a guarda
// de `openrouter.service.ts`, que lança ao ver o host real em modo de teste.
// Os testes de "sem chave" usam a costura explícita do service, não o ambiente.
process.env.OPENROUTER_API_KEY ??= "chave-de-teste";
