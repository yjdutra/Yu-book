# @yu-book/mcp

Servidor MCP do Yu-book. Expõe o segundo cérebro como ferramentas que o Claude pode chamar.

**Estado: Etapa 1 — só leitura, transporte stdio.** Etapas seguintes em
[`../../docs/temp/proposta- mcp-inicial.md`](../../docs/temp/proposta-%20mcp-inicial.md).

## Rodando

```bash
cp apps/mcp/.env.example apps/mcp/.env    # ajuste email e senha da sua conta
pnpm --filter @yu-book/shared build
pnpm --filter @yu-book/mcp build
```

A API precisa estar no ar (`pnpm dev`, ou aponte `YUBOOK_API_URL` para a Railway).

**No Claude Code:** o [`.mcp.json`](../../.mcp.json) na raiz já registra o servidor. Ele lê o
`.env`, que não é versionado — a senha nunca entra no repositório.

**No Inspector** (a ferramenta da aula 04, versão TypeScript):

```bash
pnpm --filter @yu-book/mcp inspector
```

**Na unha**, sem cliente nenhum — útil para entender o protocolo:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| node --env-file=apps/mcp/.env apps/mcp/dist/index.js
```

## As tools

| Tool | Devolve | Custo de contexto |
|---|---|---|
| `search_notes` | Título, tipo, trecho e id — de notas **e** cards | Baixo, por desenho |
| `get_note` | Uma nota inteira, com backlinks e cards vinculados | Alto, e explícito |
| `list_boards` | Quadros com contagem de colunas e cards | Baixo |
| `get_board` | Colunas na ordem, com a face dos cards | Médio |

## As decisões que valem conhecer

**O servidor é um cliente da API, não do banco.** Ele fala HTTP com `apps/api` em vez de importar o
Prisma. Custa uma requisição a mais e paga com tudo o que já está resolvido do outro lado: escopo
por `userId` vindo só do token, posse por cadeia no kanban, códigos de erro estáveis. Importar o
Prisma exigiria reimplementar esse escopo aqui — e um erro nisso vaza dado entre contextos.

**`search_notes` nunca devolve corpo de nota.** É o mesmo problema que `GET /notes` teve: trazer o
corpo inteiro de 50 notas custava 4,2 MB por página, e a correção foi truncar no banco. Uma tool
tem exatamente o mesmo orçamento, com um agravante — quem paga é a janela de contexto do modelo.
Daí o par: `search_notes` acha, `get_note` lê. Buscar é barato; ler é caro e deliberado.

**A resposta é texto compacto, não JSON.** JSON de vinte resultados gasta um terço dos tokens em
chaves e aspas repetidas sem dizer nada ao modelo.

**Os caracteres de controle do destaque são convertidos.** O `snippet` da busca vem com `U+0001` e
`U+0002` em volta dos termos (INV-10) — existem para que nenhuma nota consiga forjar destaque em
HTML. Para o modelo são lixo, então viram `**negrito**` antes de sair.

**Login por credencial no ambiente, e não fluxo de autorização.** O refresh token vive num cookie
`httpOnly` e o `fetch` do Node não guarda cookie; em vez de manter um cookie jar, o servidor
simplesmente entra de novo quando o token de 15 minutos expira. Enquanto o transporte é stdio e
tudo roda na sua máquina, isso equivale a ter a senha no gerenciador do navegador. **É o primeiro
item a mudar** quando entrarem transporte HTTP e autenticação, no Advanced Topics.

**Em stdio, o stdout é o canal do protocolo.** Um `console.log` esquecido injeta lixo no meio de uma
mensagem JSON-RPC e o cliente desconecta com um erro que não parece ter relação com o log. Todo
diagnóstico deste pacote vai para stderr, sem exceção.

## Convenções

Nome de tool é fronteira, como caminho de rota — por isso em inglês, igual a `/notes` e `/boards`.
O que é interno segue o resto do repositório e fica em português (`registrarToolsDeNotas`,
`limparDestaque`, `mensagemDeErro`). Ver a skill `convencoes-yu-book`.
