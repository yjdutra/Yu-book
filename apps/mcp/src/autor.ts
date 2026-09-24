import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_AUTOR_IA } from "@yu-book/shared";
import type { OrigemMcp } from "@yu-book/shared";
import { registroDeClientes } from "./auth/provedor.js";
import { env } from "./env.js";
import type { Extra } from "./notificacoes.js";

/** O rótulo quando nenhuma das fontes disse nada. */
const AUTOR_PADRAO = "cliente MCP";

/**
 * QUEM ESCREVEU, para a marca de conteúdo gerado (Etapa C da frente de IA).
 *
 * É **rótulo, não identidade**: os dois nomes abaixo são declarados pelo próprio
 * cliente, e nenhum deles autoriza nada. Quem autoriza é a trava de escrita; a
 * conta que grava é a do token. O que se escolhe aqui é só qual declaração é a
 * mais honesta de mostrar ao lado de "gerada por IA".
 *
 *   http   o `client_name` do cadastro OAuth — é o nome que o usuário **leu na
 *          tela de consentimento** antes de liberar a escrita (`auth/rotas.ts`).
 *          Sai do `client_id` do token, que é o envelope cifrado do cadastro:
 *          por requisição, sem estado novo.
 *   stdio  o `clientInfo` do `initialize`. Há uma instância de `McpServer` por
 *          conexão (e, sob HTTP, por sessão), então ele é do cliente certo.
 *
 * Sob HTTP o `clientInfo` fica de recuo — cliente registrado sem `client_name`.
 * O que não se faz: ler nome do ambiente. Seria o mesmo autor para todo mundo.
 */
export async function autorDoCliente(server: McpServer, extra: Extra): Promise<string> {
  let nome: string | undefined;

  const clientId = extra.authInfo?.clientId;
  if (env.ehHttp && clientId) {
    const cadastro = await registroDeClientes.getClient(clientId);
    nome = cadastro?.client_name;
  }

  if (!nome?.trim()) {
    const info = server.server.getClientVersion();
    // `title` é o nome de exibição do protocolo mais novo; `name` é o técnico.
    nome = info?.title ?? info?.name;
  }

  const limpo = nome?.trim().slice(0, MAX_AUTOR_IA).trim();
  return limpo || AUTOR_PADRAO;
}

/** O `origin` que `POST /notes` e `POST /cards` aceitam. */
export async function origemDoCliente(server: McpServer, extra: Extra): Promise<OrigemMcp> {
  return { via: "mcp", author: await autorDoCliente(server, extra) };
}
