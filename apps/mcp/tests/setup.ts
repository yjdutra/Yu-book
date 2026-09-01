/**
 * O ambiente mínimo, plantado **antes** de qualquer import da aplicação.
 *
 * `src/env.ts` valida na importação e chama `process.exit(1)` se não gostar —
 * o que, dentro do Vitest, mata o worker com uma saída que não parece falha de
 * teste. E o transporte `http` **proíbe** `YUBOOK_EMAIL`/`YUBOOK_PASSWORD`: se
 * o `.env` do operador vazar para o processo de teste, a suíte morre sem dizer
 * por quê. Apagar os dois aqui é o que torna o resultado independente da
 * máquina de quem roda.
 */
delete process.env["YUBOOK_EMAIL"];
delete process.env["YUBOOK_PASSWORD"];

process.env["MCP_TRANSPORTE"] = "http";
process.env["MCP_URL_PUBLICA"] = "https://mcp.teste.invalid";
process.env["MCP_SEGREDO"] = "segredo-de-teste-com-mais-de-32-caracteres";
process.env["YUBOOK_API_URL"] = "http://localhost:3334";

// As três que `env.ts` passa por `z.coerce.number()`. Não são usadas por teste
// nenhum, e estão aqui porque `PORT=` vazio no ambiente de quem roda viraria
// `0`, e `0` derruba o boot com "Number must be greater than 0" — a suíte
// inteira falhando por uma variável que nada aqui lê.
process.env["PORT"] = "3335";
process.env["MCP_SESSAO_TTL_MS"] = String(30 * 60 * 1000);
process.env["MCP_SESSOES_MAX"] = "100";
