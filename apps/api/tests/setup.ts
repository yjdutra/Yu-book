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

// A management key do painel do OpenRouter, fixada **com sobrescrita**, e não
// com `??=` como a de cima, por dois motivos:
// - se um dia a chave real for para o `.env` de desenvolvimento, ela iria no
//   header para o dublê e mudaria o que as rotas respondem ("sem management
//   key" passaria a ser "com") — a suíte dependeria da máquina;
// - com um valor fixo e não vazio no ambiente, o teste de "sem chave" pela
//   injeção `{ chaveDeGestao: undefined }` fica com dente: se a checagem de
//   `in` virar valor padrão de parâmetro, a chamada cai de volta aqui, abre
//   conexão, e o teste cai. Com o ambiente vazio, ele passaria testando outra
//   coisa (ver `convencoes-yu-book`, §3).
// Nenhuma outra suíte lê esta variável.
process.env.OPENROUTER_MANAGEMENT_KEY = "gestao-de-teste";

// Frente de cards, Parte 2: o bucket dos anexos aponta para o dublê de
// `tests/armazem.ts`, pelo mesmo motivo da porta fixa acima. `lib/armazem.ts`
// ainda lança, em modo de teste, se o host não for 127.0.0.1 — se o `.env` de
// desenvolvimento um dia ganhar um bucket de verdade, o `??=` o preserva e a
// guarda derruba a suíte em vez de gravar nele. O caminho (`S3_PATH_STYLE`)
// porque subdomínio de 127.0.0.1 não resolve.
process.env.S3_ENDPOINT ??= "http://127.0.0.1:39334";
process.env.S3_BUCKET ??= "yubook-teste";
process.env.S3_ACCESS_KEY_ID ??= "chave-de-teste";
process.env.S3_SECRET_ACCESS_KEY ??= "segredo-de-teste";
process.env.S3_PATH_STYLE ??= "true";
