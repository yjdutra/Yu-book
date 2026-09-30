# @yu-book/mcp

Servidor MCP do Yu-book. Expõe o segundo cérebro como ferramentas que o Claude pode chamar.

**Estado: Etapa 4 de 5 — transporte HTTP e identidade.** As três primitivas do protocolo, com
escrita, sobre **dois transportes**. A Etapa 5 é a mesa de trabalho multi-repositório.

## Dois modos de operação, e a diferença é quem é você

O mesmo servidor, a mesma montagem (`src/servidor.ts`), as mesmas onze tools. O que muda é **como o
servidor sabe de quem é a requisição** — e isso muda tudo o que vem depois.

| | `stdio` | `http` |
|---|---|---|
| Quantos processos | um por pessoa, iniciado pelo cliente | um serviço, muitos clientes |
| Quem é você | o dono do processo | quem apresentou o token |
| De onde vem a credencial | `YUBOOK_EMAIL`/`YUBOOK_PASSWORD` no `.env` | OAuth 2.1, do navegador |
| A trava de escrita | a URL da API é local? | o escopo do token |
| Via de volta (log, progresso) | pelo próprio stdio | SSE, por sessão |

Em stdio a credencial no ambiente **está certa**: um processo, um usuário, e o processo é seu. Em
HTTP ela seria uma identidade só para todo mundo — por isso o boot **recusa subir** se
`YUBOOK_EMAIL` estiver definida ali. Ver `.env.example`, que separa as variáveis por transporte.

## Rodando em stdio

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

## Rodando em HTTP

```bash
env -u YUBOOK_EMAIL -u YUBOOK_PASSWORD \
  MCP_TRANSPORTE=http PORT=3335 \
  MCP_URL_PUBLICA=http://localhost:3335 \
  MCP_SEGREDO="$(openssl rand -base64 48)" \
  YUBOOK_API_URL=http://localhost:3334 \
  node apps/mcp/dist/index.js
```

O `env -u` não é firula: se as credenciais estiverem exportadas na sua sessão, o boot recusa — e é
esse o ponto.

**O que o cliente MCP faz sozinho**, sem ninguém registrar nada em lugar nenhum: acha
`/.well-known/oauth-authorization-server`, se cadastra por *dynamic client registration*, abre o
navegador em `/authorize`, e volta com um `code` que troca por tokens com PKCE.

**O que você faz:** na página que abre, digita email e senha da sua conta no Yu-book e marca — ou
não — a caixa de escrita. Marcada, o token vem com `yubook:write` e a sessão registra as onze tools;
desmarcada, cinco.

O servidor **não guarda estado durável**. Cliente registrado, código de autorização e refresh token
viajam cifrados dentro do próprio identificador (`src/auth/segredos.ts`), então um redeploy não
expulsa ninguém e não há mapa crescendo em memória.

## Hospedado na Railway

`railway.json` fica em [`apps/mcp/railway.json`](railway.json), como os dos outros dois serviços.
**Root Directory vazio** — apontar para `apps/mcp` quebra a resolução de `@yu-book/shared`. Watch
Paths: `apps/mcp/**`, `packages/shared/**`, `pnpm-lock.yaml`.

`NODE_ENV=production` e `MCP_TRANSPORTE=http` vão no `startCommand`, **não** como variáveis do
serviço. O primeiro porque `NODE_ENV` de serviço quebra o build (`tsc: not found`, as devDeps somem);
o segundo porque sem ele o processo sobe em stdio e fica mudo — no comando, é impossível esquecer.

As variáveis do painel, e **só** estas:

| | |
|---|---|
| `MCP_SEGREDO` | `openssl rand -base64 48`. Quem tiver isto forja qualquer token |
| `MCP_URL_PUBLICA` | o domínio que a Railway deu, sem barra final |
| `MCP_HOSTS_PERMITIDOS` | o mesmo domínio, só o hostname. **Sem ela não há defesa de DNS rebinding** |
| `YUBOOK_API_URL` | a API de produção |
| `MCP_ESCRITA_HABILITADA` | `0` ou `1` — o único desligamento global da escrita neste transporte |

`YUBOOK_EMAIL` e `YUBOOK_PASSWORD` são **proibidas**: o boot recusa subir com elas, e é essa recusa
que garante que ninguém opere como o dono do `.env`. `PORT` a Railway injeta.

As duas primeiras só existem depois de o serviço existir e o domínio ser gerado — então a ordem é
criar o serviço, pegar o domínio, preencher, e redeployar.

**Hospedado, a trava por host local não protege mais nada:** o alvo é a API de produção, e o que
decide a escrita é o escopo do token mais `MCP_ESCRITA_HABILITADA`. Um pedido mal interpretado pelo
modelo cria dado de verdade no segundo cérebro, e não existe desfazer deste lado.

## O ambiente local de escrita

**Em stdio, as tools de escrita só se registram contra uma API local.** Contra qualquer outro host
elas somem do `tools/list`, e o motivo vai para o stderr no boot. Ver `YUBOOK_ESCRITA_REMOTA` no
`.env.example`.

**Em HTTP essa trava não participa** — lá quem decide é o escopo do token, e o desligamento global é
`MCP_ESCRITA_HABILITADA=0`. São eixos diferentes para transportes diferentes, e não é engano: em
stdio não há identidade para consultar, então o que sobra é a URL; em HTTP a identidade existe e é
ela que manda. O diagnóstico de boot diz qual dos dois está valendo.

O alvo é um banco separado do de desenvolvimento e da produção, com acervo recriável:

```bash
# o nome do contêiner é o que você deu ao seu Postgres — ver o README da raiz
docker exec <contêiner> createdb -U postgres yubook_mcp
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/yubook_mcp?schema=public" \
  pnpm --filter @yu-book/api db:deploy

pnpm --filter @yu-book/api db:seed     # recria o acervo e o usuário mcp@yu-book.test
pnpm --filter @yu-book/api dev:mcp     # API na 3334 contra yubook_mcp
pnpm --filter @yu-book/mcp verificar   # confirma ambiente, escrita, login e volume (stdio)
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

Escrita — em stdio só contra API local; em HTTP, com escopo `yubook:write`:

| Tool | Faz | Desfaz com |
|---|---|---|
| `create_card` | Cria um card no **fim** de uma coluna, marcado como gerado por IA | (o aplicativo) |
| `create_note` | Cria uma nota, marcada como gerada por IA | `trash_note` |
| `move_card` | Move de coluna ou reordena dentro dela | outro `move_card` |
| `complete_card` | Conclui ou reabre um card, **sem movê-lo**; a conclusão fica marcada como feita por IA | `complete_card` com `completed: false` |
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
- **Conversa, mensagem e anexo do chat interno** (`/ai/conversations*`, desde 2026-09-23). Declarado
  em vez de presumido, porque uma entidade nova que não quebra nada é a que some do radar. Cada uma
  cai por um motivo próprio: **conversa** passaria no teste de forma — id e título rotulam bem —,
  mas não é acervo: é transcrição de um diálogo com outro modelo, e pô-la no menu do `@` a tornaria
  indistinguível de nota no único lugar do produto desenhado para alimentar um modelo. **Mensagem**
  seria um segundo conjunto sem limite, de conteúdo sintético — custo de contexto puro, com risco de
  o modelo tratar afirmação de outro modelo como fato do acervo. **Anexo** é um ponteiro para nota,
  card ou quadro, e os três já têm endereço aqui. Mandar uma mensagem (`POST
  /ai/conversations/:id/messages`) é recusado por três motivos independentes: é modelo chamando
  modelo, quando quem chega pelo MCP já tem um do outro lado; **gasta dinheiro do usuário** contra o
  teto diário, por decisão de um modelo, e no hospedado essa é a conta de produção; e a rota
  responde em `text/event-stream`, que uma tool — resultado único — não sabe representar.

## As decisões que valem conhecer

**Este servidor não usa amostragem (*sampling*), e isso é escolha.** Amostragem serve para o
servidor pedir emprestado o modelo de quem o chamou. Aqui, quem chega pelo MCP **já tem um modelo
do outro lado** — é ele que está lendo esta tool. Pedir amostragem seria pedir que gerasse um texto
que ele geraria sozinho, com uma volta a mais no protocolo e dependendo de uma capability que a
maior parte dos clientes não implementa. E a direção do projeto é a oposta: a IA dentro do Yu-book
roda em **modelo local, por privacidade** (RNF-01 do PRD de IA), enquanto amostragem faria o corpo
da nota atravessar o protocolo para ser processado por um modelo que não é o escolhido.

A decisão foi revisitada quando o transporte virou HTTP, e **continua a mesma**. O argumento que
caiu foi o de escala — "só paga a conta em servidor público", e agora ele é público. O que sobrou é
o que sempre foi o principal: quem chega por aqui já tem um modelo do outro lado, e o Yu-book quer o
processamento de nota num modelo local, não num emprestado.

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
Prisma. Custa uma requisição a mais — **duas**, nas cinco superfícies que imprimem data, ver a
decisão do fuso abaixo — e paga com tudo o que já está resolvido do outro lado: escopo por `userId`
vindo só do token, posse por cadeia no kanban, códigos de erro estáveis. Importar o Prisma exigiria
reimplementar esse escopo aqui — e um erro nisso vaza dado entre contextos.

**O dia de um prazo é o dia do usuário, e isso custa uma requisição.** Até 2026-09-23 os
formatadores usavam o fuso do **processo**. Na máquina do operador isso acertava por acaso; no
serviço hospedado, que roda em UTC, errava sempre — o front grava o prazo às 23:59:59 locais, o que
em UTC−3 vira 02:59 do dia seguinte, e o servidor relatava **todo prazo um dia à frente**, calado.
Agora `diaDoPrazo` exige o fuso como argumento, sem valor padrão, e `src/fuso.ts` o busca em
`ai_preference.timezone` por `GET /ai/settings`. Três coisas para não desfazer sem pensar:

- **O recuo é `FUSO_PADRAO`, nunca o fuso do processo.** Cair no processo é o defeito de volta.
- **Não há cache, de propósito.** Um mapa por credencial é a forma do mapa de sessões de `http.ts`,
  que precisou de cinco guardas para não vazar calado. Uma requisição a mais é custo previsível.
  O custo medido: +1 em `get_board`, `get_dashboard`, `create_card`, `move_card`, `complete_card`,
  `yubook://board/{id}` e — desde a marca de IA, que data a linha "gerada por IA" — `get_note` e
  `yubook://nota/{id}`; todas em paralelo, menos `create_card`, que precisa do fuso antes do POST.
- **Na escrita o recuo não é silencioso.** `create_card` com prazo **falha** se não conseguir ler o
  fuso, porque ali ele vira o instante gravado no banco — não um rótulo que morre com a conversa.

Efeito colateral que vale registrar: `railway.json` não define `TZ`, e depois disto **não deve**
definir. Nenhuma data do texto deste servidor lê mais o fuso do processo, então a variável seria
inerte — e sugeriria que ela resolve algo.

**`search_notes` nunca devolve corpo de nota.** É o mesmo problema que `GET /notes` teve: trazer o
corpo inteiro de 50 notas custava 4,2 MB por página, e a correção foi truncar no banco. Uma tool
tem exatamente o mesmo orçamento, com um agravante — quem paga é a janela de contexto do modelo.
Daí o par: `search_notes` acha, `get_note` lê. Buscar é barato; ler é caro e deliberado.

**A resposta é texto compacto, não JSON.** JSON de vinte resultados gasta um terço dos tokens em
chaves e aspas repetidas sem dizer nada ao modelo.

**Os caracteres de controle do destaque são convertidos.** O `snippet` da busca vem com `U+0001` e
`U+0002` em volta dos termos (INV-10) — existem para que nenhuma nota consiga forjar destaque em
HTML. Para o modelo são lixo, então viram `**negrito**` antes de sair.

**A identidade é por requisição, e o token do MCP carrega o da API dentro dele.** Este foi o
primeiro item a mudar quando o transporte virou HTTP, e mudou por inteiro.

Em stdio o servidor entra com email e senha e reentra quando o token de 15 minutos expira — com um
processo por pessoa, a conta do `.env` **é** a identidade. Em HTTP não há senha nenhuma no servidor:
o token de acesso que ele emite leva o `accessToken` da API **cifrado** no corpo, e a identidade
chega a cada chamada por `AsyncLocalStorage`, aberto nos invólucros de erro que envolvem todo
handler. Uma variável de módulo seria a mesma identidade para todos os clientes.

**Os dois relógios batem juntos, e não é detalhe.** O token do MCP vive `apiExp − 60 s`, derivado do
vencimento do token da API que ele carrega — nunca um número fixo. Igualá-los em 15 minutos não
bastaria: o da API nasce no login e o do MCP nasce na troca do código, até um minuto depois, então o
do MCP morreria por último e o 401 cairia **dentro de uma tool**, onde o cliente não sabe reagir.
Morrendo antes, ele cai na fronteira HTTP, onde o cliente sabe renovar.

E uma renovação do MCP é **uma** renovação da API, com janela de idempotência: a `apps/api` faz
detecção de reuso de refresh token, e duas apresentações do mesmo cookie revogariam todas as sessões
do usuário — inclusive a do navegador dele.

**Em stdio, o stdout é o canal do protocolo.** Um `console.log` esquecido injeta lixo no meio de uma
mensagem JSON-RPC e o cliente desconecta com um erro que não parece ter relação com o log. Todo
diagnóstico deste pacote vai para stderr, sem exceção.

## Convenções

Nome de tool é fronteira, como caminho de rota — por isso em inglês, igual a `/notes` e `/boards`.
O que é interno segue o resto do repositório e fica em português (`registrarToolsDeNotas`,
`limparDestaque`, `mensagemDeErro`). Ver a skill `convencoes-yu-book`.

## Onde a superfície mora agora

Desde a Etapa B da frente de IA (2026-09-23), **o metadado das onze tools não fica neste pacote**.
Título, descrição e schema vivem em [`packages/shared/src/ferramentas.ts`](../../packages/shared/src/ferramentas.ts),
e a formatação do acervo em [`packages/shared/src/formato.ts`](../../packages/shared/src/formato.ts)
— o `src/formato.ts` daqui deixou de existir. O motivo é que existe um **segundo consumidor**: o
chat interno de `apps/api` oferece as mesmas ações ao provedor e chama os services direto, e dois
catálogos escritos à mão divergiriam em silêncio. Aqui ficam os handlers, o transporte e a
autenticação.

**O preço disso precisa estar escrito:** editar uma `descricao` lá muda o contrato de conversa
deste servidor e o custo de todo turno, **e nenhum portão fica vermelho**. `tests/escrita.test.ts`
confere *quais* tools são anunciadas e que cada uma de escrita recusa token sem escopo — nunca o
texto de uma descrição, nunca o tamanho da resposta. Quem mexer no catálogo por causa do chat mexeu
no MCP junto.
