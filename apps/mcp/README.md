# @yu-book/mcp

Servidor MCP do Yu-book. Expõe o segundo cérebro como ferramentas que o Claude pode chamar.

**Estado: Etapa 3 — as três primitivas do protocolo, com escrita, sobre stdio.** A Etapa 4
(transporte HTTP e identidade) vem depois do curso *MCP: Advanced Topics*.

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

## O ambiente local de escrita

**As tools de escrita só se registram contra uma API local.** Contra qualquer outro host elas somem
do `tools/list`, e o motivo vai para o stderr no boot. Ver `YUBOOK_ESCRITA_REMOTA` no `.env.example`.

O alvo é um banco separado do de desenvolvimento e da produção, com acervo recriável:

```bash
# o nome do contêiner é o que você deu ao seu Postgres — ver o README da raiz
docker exec <contêiner> createdb -U postgres yubook_mcp
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/yubook_mcp?schema=public" \
  pnpm --filter @yu-book/api db:deploy

pnpm --filter @yu-book/api db:seed     # recria o acervo e o usuário mcp@yu-book.test
pnpm --filter @yu-book/api dev:mcp     # API na 3334 contra yubook_mcp
pnpm --filter @yu-book/mcp verificar   # confirma ambiente, escrita, login e volume
```

O seed é idempotente: rodar duas vezes dá o mesmo estado. Ele escreve **pelos services**, não pelo
Prisma cru — é o que faz `note_link` existir (INV-17, tabela derivada) e as posições nascerem
contíguas (INV-11). Um seed com `prisma.note.create` produziria um banco que parece certo e mente
sobre o grafo.

## As tools

Leitura:

| Tool | Devolve | Custo de contexto |
|---|---|---|
| `search_notes` | Título, tipo, trecho e id — de notas **e** cards | Baixo, por desenho |
| `get_note` | Uma nota inteira, com backlinks e cards vinculados | Alto, e explícito |
| `list_boards` | Quadros com contagem de colunas e cards | Baixo |
| `get_board` | Colunas na ordem **com o id de cada uma**, e a face dos cards | Médio |
| `get_dashboard` | O agregado da tela inicial numa requisição só | Médio |

Escrita — só contra API local:

| Tool | Faz | Desfaz com |
|---|---|---|
| `create_card` | Cria um card no **fim** de uma coluna | (o aplicativo) |
| `move_card` | Move de coluna ou reordena dentro dela | outro `move_card` |
| `trash_note` | Manda a nota para a lixeira | `restore_note` — **menos o vínculo dos cards** |
| `restore_note` | Tira a nota da lixeira | `trash_note` |

Sobre a ressalva de `trash_note`: os `[[…]]` de e para a nota são apagados e **voltam** ao
restaurar (`recalcularLinks` + `reconstruirEntradas`); o `noteId` dos cards que apontavam para ela
**não** volta, e refazer é manual, um card por vez. Juntar os dois efeitos numa frase só foi o que
produziu uma afirmação errada na `description` da tool, corrigida na revisão — ver INV-19.

## O que deliberadamente **não** vira tool

- **Excluir card** (`DELETE /cards/:id`) e **excluir nota em definitivo** — as duas são
  irreversíveis, e card nem lixeira tem. Um mal-entendido apagaria trabalho sem volta. Ficam onde
  já estão: no aplicativo, com um humano confirmando.
- **Criar quadro, coluna ou workspace** — estrutura. Criar quadro por conversa gera quadro paralelo
  em silêncio, e excluir coluna exige decidir o destino dos cards (INV-14): é escolha de dono.
- **Editar nota ou card** (título, corpo, checklist) — é outro problema, não o mesmo maior. Envolve
  concorrência com o autosave do front e merge de conteúdo.
- **Listar a lixeira.** Consequência assumida: `restore_note` só alcança o que a própria conversa
  acabou de mandar para lá, porque `search_notes` não enxerga nota excluída. Se isso incomodar na
  prática, a saída é uma tool `list_trashed_notes` sobre `GET /notes?trash=true`.

## As decisões que valem conhecer

**Este servidor não usa amostragem (*sampling*), e isso é escolha.** Amostragem serve para o
servidor pedir emprestado o modelo de quem o chamou. Aqui, quem chega pelo MCP **já tem um modelo
do outro lado** — é ele que está lendo esta tool. Pedir amostragem seria pedir que gerasse um texto
que ele geraria sozinho, com uma volta a mais no protocolo e dependendo de uma capability que a
maior parte dos clientes não implementa. E a direção do projeto é a oposta: a IA dentro do Yu-book
roda em **modelo local, por privacidade** (RNF-01 do PRD de IA), enquanto amostragem faria o corpo
da nota atravessar o protocolo para ser processado por um modelo que não é o escolhido. Revisitar
quando o transporte virar HTTP e o servidor sair da máquina do operador — amostragem paga a conta
em servidor público e multiusuário, que não é o caso.

**Raízes (*roots*) não se aplicam.** Este servidor não abre um único arquivo: ele é cliente HTTP da
API. Implementar raízes hoje seria código morto. A lição vale para a mesa de trabalho, que precisa
de cópia em disco de vários repositórios.

**Log vale mais que progresso, e o motivo é auditoria.** Estas são as primeiras operações que
mudam dado. Todo diagnóstico deste pacote vai para stderr, que nenhum cliente MCP mostra — um
`notifications/message` por escrita é o único registro que o usuário chega a ver de que uma nota
foi para a lixeira. Progresso, com tools estreitas contra API local, é quase ornamental; entra
porque o mecanismo é o mesmo de que o backfill de embeddings vai precisar, e construí-lo agora
custa zero. O que não se faz é inventar passo artificial para a barra parecer cheia.

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
