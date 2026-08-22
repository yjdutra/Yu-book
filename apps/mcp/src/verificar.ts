/**
 * Diagnóstico de ambiente. Não faz parte do servidor MCP — é um utilitário de
 * linha de comando, e por isso pode escrever em stdout à vontade.
 *
 * Existe porque trocar `YUBOOK_API_URL` entre local e produção é a operação
 * mais fácil de errar deste pacote, e o sintoma de errar aparece lá na frente,
 * como texto de erro dentro de uma conversa com o modelo.
 *
 *   pnpm --filter @yu-book/mcp verificar
 */
import type { NoteCounts, SearchResponse } from "@yu-book/shared";
import { api, ErroDaApi } from "./cliente.js";
import { env } from "./env.js";
import { mensagemDeErro } from "./erros.js";

async function principal(): Promise<void> {
  console.log(`Ambiente: ${env.YUBOOK_API_URL}`);
  console.log(`Conta:    ${env.YUBOOK_EMAIL}`);
  console.log("");

  // /health não toca no banco; /health/db toca. Os dois separados dizem se o
  // problema é a API ou o Postgres atrás dela.
  const saude = await fetch(`${env.YUBOOK_API_URL}/health`);
  console.log(`  /health      ${saude.ok ? "ok" : `FALHOU (${saude.status})`}`);

  const banco = await fetch(`${env.YUBOOK_API_URL}/health/db`);
  const corpoBanco = (await banco.json().catch(() => null)) as { database?: string } | null;
  console.log(`  /health/db   ${corpoBanco?.database ?? `FALHOU (${banco.status})`}`);

  // A primeira chamada autenticada é o que exercita o login.
  const contagem = await api.get<NoteCounts>("/notes/counts");
  console.log(`  login        ok`);
  console.log("");
  console.log(`  notas ativas ${contagem.total}`);
  console.log(`  na lixeira   ${contagem.trash}`);
  console.log(`  favoritas    ${contagem.favorites}`);
  const porTipo = Object.entries(contagem.byKind)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(" · ");
  if (porTipo) console.log(`  por tipo     ${porTipo}`);

  // Uma busca real prova que o full-text está montado neste banco — a
  // configuração `pt_unaccent` e o trigger vivem na migration, não no Prisma.
  const busca = await api.get<SearchResponse>("/search", new URLSearchParams({ q: "a", limit: "1" }));
  console.log(`  busca        ${busca.results.length > 0 ? "respondeu" : "respondeu, sem resultado"}`);

  console.log("");
  console.log(contagem.total === 0 ? "Banco vazio — nada para o MCP ler." : "Pronto para uso.");
}

principal().catch((erro) => {
  console.error("");
  console.error(`Falhou: ${mensagemDeErro(erro)}`);
  if (erro instanceof ErroDaApi && erro.status === 429) {
    console.error("O login aceita 10 tentativas a cada 5 minutos por IP. Espere e tente de novo.");
  }
  process.exit(1);
});
