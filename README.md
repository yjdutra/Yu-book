# Yu-book

Segundo cérebro pessoal: notas de aula, projetos, trilha de estudos e trabalho, com kanban por
workspace, gaveta de links e um dashboard que responde o que precisa de você agora.

Proposta e decisões de escopo em [PROPOSTA.md](PROPOSTA.md).
Requisitos por fase em [docs/old/prd-fase-1-notas.md](docs/old/prd-fase-1-notas.md),
[docs/old/prd-fase-2-kanban.md](docs/old/prd-fase-2-kanban.md),
[docs/old/prd-fase-3-links.md](docs/old/prd-fase-3-links.md) e
[docs/old/prd-fase-4-dashboard.md](docs/old/prd-fase-4-dashboard.md).

**Status: Fases 0 a 4 concluídas.**

- **Fase 0 — fundação:** monorepo, banco, autenticação JWT, deploy configurado.
- **Fase 1 — notas:** CRUD, editor Markdown split ao vivo com autosave, tags, workspaces,
  links `[[wiki]]` com backlinks, busca full-text por `Ctrl+K` e lixeira.
- **Fase 2 — workspace global + kanban:** seletor que troca o contexto da aplicação inteira,
  boards por workspace, arrasto com mouse e teclado, cards com prazo, prioridade e checklist,
  vínculo card ↔ nota nos dois sentidos e cards na paleta de busca.
- **Fase 3 — gaveta de links:** favoritos e "ver depois", captura arrastando o link para dentro da
  janela, título lido da página com guarda contra endereço interno.
- **Fase 4 — dashboard e tema claro:** tela inicial em `/` com prazos, notas recentes e a fila de
  links; a aplicação deixou de ser dark-only.

Próxima: Fase 5 — agenda no Google Calendar.

---

## Estrutura

```
yu-book/
├─ apps/api/        Fastify + Prisma + Postgres
├─ apps/web/        React + Vite + Tailwind
├─ apps/mcp/        servidor MCP — roda local, não é deployado
└─ packages/shared/ schemas Zod e tipos usados pelos dois
```

`packages/shared` é compilado antes dos apps — é de lá que saem os schemas de validação que a
API e o front usam **em comum**, então uma regra de senha nunca fica divergente entre os dois.

## Rodando local

Requisitos: Node ≥ 20.19, pnpm 9, um Postgres.

```bash
pnpm install
pnpm --filter @yu-book/shared build

# Postgres via docker, se você ainda não tiver um:
docker run -d --name yubook-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
createdb -h localhost -U postgres yubook   # ou: docker exec yubook-db createdb -U postgres yubook

cp apps/api/.env.example apps/api/.env      # ajuste DATABASE_URL e gere o JWT_SECRET
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @yu-book/api db:migrate       # cria as tabelas + busca full-text
pnpm dev                                    # API na 3333, front na 5173
```

Gere o segredo com `openssl rand -base64 48`. A API recusa subir com `JWT_SECRET` curto —
falhar no boot é melhor que rodar inseguro.

Abra `http://localhost:5173`, crie sua conta (`ALLOW_SIGNUP=true` em dev) e pronto.

### Comandos úteis

| Comando | O que faz |
|---|---|
| `pnpm dev` | sobe API e front juntos |
| `pnpm build` | compila shared → api → web |
| `pnpm typecheck` | checagem de tipos em tudo |
| `pnpm db:migrate` | cria/aplica migration nova |
| `pnpm db:studio` | Prisma Studio para olhar os dados |
| `pnpm --filter @yu-book/api test` | testes de integração (usam o `DATABASE_URL` do `.env`) |

Os testes de integração sobem o Fastify inteiro e falam com o Postgres de verdade — é onde a
renumeração de posições, a verificação de posse e a busca por índice são checadas. Eles criam e
apagam os próprios dados; o resto do banco fica intacto.

---

## Autenticação

O modelo é o padrão de dois tokens:

- **Access token** (JWT HS256, 15 min) vai no header `Authorization`. No front ele vive **em
  memória** — nunca em `localStorage`, para que um XSS não consiga persistir a sessão roubada.
- **Refresh token** (opaco, 48 bytes aleatórios, 7 dias) vive num cookie `httpOnly`, restrito ao
  path `/auth`. No banco guardamos só o **hash** — vazar o banco não dá sessão a ninguém.

O que isso protege, concretamente:

| Comportamento | Por quê |
|---|---|
| **Rotação a cada refresh** | um refresh token nunca serve duas vezes |
| **Detecção de reuso** | token já revogado reaparecendo = ele vazou → todas as sessões do usuário caem |
| **Consumo atômico** | dois refreshes simultâneos: só um vence (`updateMany` com filtro `revokedAt: null`) |
| **Header `X-Yu-Book-Client`** | força preflight CORS no `/auth/refresh` — é a defesa contra CSRF quando o cookie é `SameSite=none` |
| **Rate limit no login** | 10 tentativas / 5 min por IP |
| **argon2id** (19 MiB, t=2) | parâmetros OWASP para o hash da senha |
| **Tempo constante no login** | usuário inexistente também paga o custo de um hash — não dá para descobrir quais emails existem |
| **`userId` só do token** | nenhuma query aceita id vindo do body ou da query string |

Feche o cadastro (`ALLOW_SIGNUP=false`) assim que criar sua conta.

---

## Banco

Uma entidade `Note` com um campo `kind` (`aula`/`projeto`/`trilha`/`trabalho`/`livre`) cobre todos
os tipos de anotação — é o que permite **uma** busca atravessar todos os contextos. Campos
específicos de um tipo (módulo, instrutor, link da gravação) ficam em `note.meta` (JSONB), sem
migration a cada campo novo.

A busca full-text já está montada na migration inicial:

- configuração `pt_unaccent` = stemming em português + `unaccent`, então **`programacao` encontra
  `programação`**;
- `search_vector` mantido por trigger, com o título pesando mais que o corpo (peso A vs B);
- índice GIN para o full-text e GIN/trigram no título, para tolerar erro de digitação.

Verificado em: busca sem acento, busca com dois termos e similaridade por trigrama.

---

## Desempenho

O caminho mais percorrido da aplicação é o autosave: ele dispara a cada 800 ms de pausa na
digitação, então tudo que ele arrasta junto é multiplicado por hora de escrita.

| Onde | O que era | O que é |
|---|---|---|
| Cache do front após salvar | invalidava lista, contadores, tags, títulos e o detalhe: **6 requisições por pausa** | costura a resposta no cache e só invalida o que mudou de fato: **1 requisição** |
| `note_link` no autosave | recalculava os links a cada salvamento do corpo | só quando o conjunto de `[[…]]` muda |
| `GET /notes` | trazia o corpo inteiro de 50 notas para montar trechos de 160 caracteres | o banco trunca em 600 — **4,2 MB → 24 KB** por página, medido com notas de 100 KB |
| `GET /notes/counts` | quatro `count` por chamada | uma varredura com `FILTER` |
| Respostas da API | sem compressão | gzip acima de 1 KB |
| Bundle inicial | 600 KB (185 KB gzip), kanban incluído | 525 KB (164 KB gzip); o kanban vira um chunk de 24 KB carregado sob demanda |

Duas decisões que **não** foram tomadas, de propósito:

- **O debounce continua em 800 ms.** É requisito da Fase 1 (RF-14) e tem critério de aceitação
  próprio. O problema nunca foi a frequência do salvamento, e sim o que cada salvamento arrastava.
- **O `PATCH` continua devolvendo o corpo da nota.** Em nota muito grande isso dobra o tráfego do
  autosave, mas manter a resposta completa é o que garante que o cache do front nunca divirja do
  banco. Se um dia você escrever notas de centenas de KB, dá para devolver uma resposta enxuta e
  fundir no cliente.

O que sustenta isso são os testes de integração de `tests/notas.test.ts`: eles provam que pular o
recálculo de link não perde backlink, inclusive no caso em que a nota-alvo é criada **depois** do
`[[…]]` que aponta para ela.

---

## Deploy na Railway

Três serviços no mesmo projeto, todos apontando para **este mesmo repositório**: **Postgres**,
**API** e **web**.

> **A ordem importa.** A API precisa saber o domínio do front (`CORS_ORIGIN`) e o front precisa
> saber o domínio da API (`VITE_API_URL`). Como os domínios só existem depois que os serviços são
> criados, crie os dois primeiro, gere os domínios, e só então preencha as variáveis. Os passos
> abaixo já estão nessa ordem.

### 1. Postgres

`+ New → Database → PostgreSQL`. Ele expõe `DATABASE_URL`, que os outros serviços leem por
referência — nunca copie a string à mão.

### 2. Crie os dois serviços a partir do repositório

`+ New → GitHub Repo → Yu-book`, duas vezes. Em **cada** serviço, na aba *Settings*:

| Campo | API | web |
|---|---|---|
| **Root Directory** | *(vazio — a raiz do repositório)* | *(vazio)* |
| **Config-as-code path** | `apps/api/railway.json` | `apps/web/railway.json` |
| **Watch Paths** | `apps/api/**`, `packages/shared/**`, `pnpm-lock.yaml` | `apps/web/**`, `packages/shared/**`, `pnpm-lock.yaml` |

**Root Directory precisa ficar vazio.** O build roda `pnpm install` na raiz para que o workspace
`@yu-book/shared` seja encontrado; apontando para `apps/api` o pnpm não enxerga o monorepo e o
build quebra na resolução da dependência.

**Watch Paths** evita que cada push reconstrua os dois serviços. Sem elas, mexer numa cor do front
faz a API reiniciar junto.

Em *Settings → Networking*, clique em **Generate Domain** nos dois. Anote os dois endereços.

### 3. Variáveis da API

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<gere com: openssl rand -base64 48>
CORS_ORIGIN=https://<dominio-do-web>.up.railway.app
COOKIE_SAMESITE=none
ALLOW_SIGNUP=true
NIXPACKS_NODE_VERSION=22
```

- `PORT` a Railway injeta sozinha.
- **`JWT_SECRET` com menos de 32 caracteres derruba o processo no boot**, de propósito: falhar na
  subida é melhor que rodar inseguro.
- `NODE_ENV=production` é o que liga a flag `Secure` no cookie de refresh — sem ela, o navegador
  recusa um cookie `SameSite=none` e você fica num laço de login.
- `ALLOW_SIGNUP=true` só até você criar sua conta (passo 5).

### 4. Variáveis do web

```
VITE_API_URL=https://<dominio-da-api>.up.railway.app
NIXPACKS_NODE_VERSION=22
```

> `VITE_API_URL` é lida **em tempo de build**, não em runtime. Trocar o valor não muda nada até
> um novo deploy acontecer — é o erro mais fácil de cometer aqui.

### 5. Primeiro acesso

1. Abra o log da API. O `startCommand` roda `prisma migrate deploy` antes de subir, então você deve
   ver as **cinco migrations** sendo aplicadas na primeira vez.
2. Confirme `GET /health` respondendo `{"status":"ok"}` e `GET /health/db` respondendo
   `{"database":"up"}`.
3. Abra o front, crie sua conta.
4. **Volte e troque `ALLOW_SIGNUP` para `false`.** A Railway redeploya sozinha ao salvar.

### O que costuma dar errado

| Sintoma | Causa |
|---|---|
| Build falha em `@yu-book/shared not found` | Root Directory apontando para `apps/api` em vez da raiz |
| Front carrega mas toda chamada dá erro de CORS | `CORS_ORIGIN` sem o `https://`, com barra no fim, ou apontando para o domínio errado |
| Login funciona e a sessão cai a cada 15 min | `COOKIE_SAMESITE` diferente de `none`, ou `NODE_ENV` que não é `production` |
| Front chama `localhost:3333` em produção | `VITE_API_URL` definida **depois** do build — force um redeploy |
| Web sobe e morre com `vite: not found` | o build podou as devDependencies. `vite preview` é quem serve os arquivos; se acontecer, troque o `start` do web por um servidor estático em `dependencies` |
| Migration falha em `CREATE EXTENSION` | o usuário do Postgres não tem permissão — no plugin da Railway ele tem, mas em banco externo pode não ter |

### Sobre o cookie entre domínios

API e front ficam em domínios diferentes (`api.up.railway.app` × `web.up.railway.app`), que o
navegador trata como **cross-site**. Daí `COOKIE_SAMESITE=none` — sem isso o cookie de refresh
simplesmente não é enviado e a sessão cai a cada 15 minutos.

Se você apontar um domínio próprio (`api.seudominio.com` e `app.seudominio.com`), os dois passam a
ser same-site: aí use `COOKIE_SAMESITE=lax` e `COOKIE_DOMAIN=.seudominio.com`, que é mais seguro.

---

## Usando

A aplicação é **desktop-only** por decisão de projeto: abaixo de 1024px ela avisa em vez de
degradar o layout. A coluna de navegação é a mesma em tudo; ao lado dela ficam o dashboard (`/`),
lista + editor (`/n`) ou o quadro + painel do card (`/b`). As larguras são ajustáveis por arrasto e
persistidas.

**A tela inicial** responde uma pergunta só: o que precisa de mim agora? Prazos vencidos no topo (o
único conteúdo do app com urgência de verdade), depois o que vence na semana, as últimas notas
editadas e o tamanho da fila de "ver depois". Tudo em uma requisição, e nada dali escreve: cada
item leva ao lugar onde a alteração acontece.

**Tema claro e escuro** pelo seletor no rodapé da navegação. Na primeira visita ele segue a
preferência do sistema; depois vale a sua escolha, guardada por dispositivo. A decisão é aplicada
antes da primeira pintura, então não há piscada ao carregar.

| Atalho | O que faz |
|---|---|
| `Ctrl+N` | nova nota, com o cursor já no título |
| `Ctrl+K` | busca notas e cards, de qualquer tela |
| `Ctrl+Shift+B` | vai para os boards |
| `Ctrl+Shift+L` | abre a gaveta de links |
| `Ctrl+S` | salva agora, sem esperar o autosave |
| `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` | negrito / itálico / código |
| `[[` | autocomplete para vincular a outra nota |
| `N` | novo card na coluna com foco |
| `Espaço` | pega e solta o card com foco; setas movem, `Esc` cancela |
| `Ctrl+/` | lista de atalhos |

**Autosave:** salva 800 ms depois que você para de digitar. Falha de rede não apaga o que está na
tela — o erro fica visível e há 3 novas tentativas a cada 5 s.

**Busca:** `Ctrl+K` aceita filtros no próprio campo — `tipo:aula`, `tipo:card`, `tag:jwt`,
`#coders` — combináveis com o termo. Ignora acento (`programacao` acha `programação`), aplica
stemming (`autenticar` acha `autenticação`) e, quando não acha nada exato, cai num fallback por
semelhança de título que tolera erro de digitação. Cards entram nos resultados junto com as notas,
identificados pelo board e pela coluna.

**Links entre notas:** `[[titulo]]` vira link clicável; se o título não existir, o link aparece
marcado como "criar" e clicar nele cria a nota. Renomear uma nota reescreve os `[[…]]` de todas as
que apontam para ela, então os links não quebram. Cada nota lista quem a referencia no rodapé.

**Lixeira:** excluir é reversível por 30 dias. A nota some de listagem, busca, autocomplete e
backlinks, mas dá para restaurar com tags e links intactos.

### Workspace é contexto, não filtro

O seletor no topo da navegação troca o contexto da **aplicação inteira**: lista de notas, paleta de
busca e lista de boards passam a enxergar só aquele workspace, e a escolha sobrevive a recarregar a
página. "Todos os workspaces" desliga o escopo. Digitar `#outro` na paleta sobrepõe o escopo
naquela busca sem trocar o contexto.

Excluir um workspace exclui os boards e cards dele — a confirmação diz quantos — mas **não** exclui
notas: elas ficam sem workspace.

### Kanban

Board pertence a um workspace e nasce com `A fazer`, `Fazendo` e `Feito`. Card tem título,
descrição em Markdown, prazo, prioridade, checklist e vínculo opcional a uma nota.

- **Mover:** arrastar com o mouse ou pegar com `Espaço` e mover com as setas — as duas formas
  fazem a mesma coisa, e cada etapa é anunciada para leitor de tela. O movimento aparece na hora;
  se a API recusar, o card volta sozinho e o erro fica visível.
- **Ordem:** as posições são renumeradas em transação a cada movimento, então não existe empate
  nem buraco na fila.
- **Limite de WIP:** por coluna, opcional. Estourar sinaliza o cabeçalho (`4/3`) e não bloqueia
  nada — com um usuário só, bloquear gera contorno, não disciplina.
- **Excluir coluna com cards** exige escolher: mover para outra coluna ou excluir junto. A API
  recusa a exclusão que não diz o que fazer com eles.
- **Arquivar** tira o card do board sem apagá-lo; desarquivar devolve ao fim da mesma coluna.
  Excluir card é definitivo — não há lixeira de card.

### Gaveta de links

`Ctrl+Shift+L` abre a gaveta sobre qualquer tela, com duas listas: **favoritos** (os sites de
sempre, em grade reordenável) e **ver depois** (a fila do que você guardou para consumir e apagar).

Para guardar, **arraste o link de outra janela e solte em qualquer ponto do Yu-book** — duas faixas
aparecem, você escolhe a lista e pronto. Não precisa abrir nada antes, e o que você estava fazendo
continua onde estava. Com a gaveta aberta, `Ctrl+V` também salva.

- **O item aparece na hora**, com o domínio como nome, e o título real entra quando a API responde.
- **A mesma URL não entra duas vezes** na mesma lista: `www.github.com/` e `github.com` são o mesmo
  link, mas `watch?v=A` e `watch?v=B` não são.
- **Excluir não pergunta nada** — some na hora, com 8 segundos de "desfazer".
- **Nada expira sozinho.** A fila mostra há quanto tempo cada item está parado e destaca o que
  passou de 30 dias; quem apaga é você.
- A gaveta é **uma só**: não segue o workspace ativo.

Sem favicon, de propósito: guardar a imagem exigiria storage de objetos e buscá-la de um serviço de
terceiros entregaria a ele a lista de tudo que você salva. A identidade é a inicial do domínio num
bloco de cor derivada dele — mesma cor para o mesmo site, sempre.

**Vídeo do YouTube é caso especial**, porque é a maior parte da fila. Ele ganha o título de
verdade e a miniatura no lugar do bloco de letra:

- O título vem do **oEmbed** do YouTube — sem chave de API e com ~1 KB de resposta. O leitor
  genérico de título não dava conta: a página de um vídeo passa de 1,3 MB e o `<title>` fica além
  do limite de 512 KB que ele lê, então o link era salvo como "youtube.com".
- A **miniatura** é montada a partir do id do vídeo (`i.ytimg.com/vi/<id>/mqdefault.jpg`), sem
  nenhuma requisição no momento de salvar. Quem baixa é o navegador, ao exibir a lista. Isso
  revela ao Google **qual vídeo** apareceu na sua lista — bem menos do que um serviço de favicon,
  que veria todos os domínios que você guarda.
- A **duração** só aparece se existir `YOUTUBE_API_KEY` no ambiente da API. Sem a chave, nada é
  requisitado e o resto continua funcionando. Não há caminho barato sem chave: o `lengthSeconds`
  fica por volta do byte 700.000 da página do vídeo.

Para ligar a duração: crie uma chave da **YouTube Data API v3** no Google Cloud e defina
`YOUTUBE_API_KEY` no serviço da API. Cada link salvo custa 1 unidade da cota diária de 10.000.

### Sobre ler o título da página

Este é o único ponto do Yu-book em que **o servidor abre conexão para um endereço que veio de
fora**, então ele é tratado como hostil:

| Defesa | O que impede |
|---|---|
| Recusa IP de laço, privado, link-local, CGNAT e multicast | usar o Yu-book para varrer a rede interna da Railway |
| Revalida **a cada redirecionamento**, no máximo 3 saltos | um endereço público que redireciona para `localhost` |
| Recusa `169.254.169.254` como qualquer outro link-local | ler as credenciais de metadados da nuvem |
| Lê no máximo 512 KB, e só se for HTML | derrubar a API com uma resposta de 2 GB |
| Orçamento de 2 segundos no total | prender a requisição num servidor que não responde |
| Título cortado em 200 caracteres e renderizado como texto | script vindo do `<title>` de terceiro |

Falhar em qualquer uma dessas etapas **nunca** impede o link de ser salvo: ele fica com o domínio
como nome, e há um botão para tentar ler o título de novo.

### Card ↔ nota

O card mostra a nota vinculada; a nota lista, no rodapé, os cards que a referenciam, ao lado de
"Referenciada por". Dá para criar uma nota já vinculada a partir do título do card. Mandar a nota
para a lixeira desfaz o vínculo e mantém o card.

### Regras que valem conhecer

- **Título é único por usuário**, comparado sem acento e sem diferenciar maiúsculas. É o que faz
  `[[titulo]]` apontar sempre para uma nota só. Título repetido é recusado com aviso.
- **Campos de aula** (módulo, instrutor, link da gravação) ficam em `note.meta` (JSONB), num painel
  recolhível — adicionar um campo novo não pede migration.
- **Tag sem nenhuma nota é apagada sozinha**, para o autocomplete não acumular lixo.
- **Nome de board é único por workspace** e nome de coluna é único por board — duas colunas "Feito"
  no mesmo board é erro de digitação, não intenção.
- **Card não atravessa boards.** Mover para uma coluna de outro board é recusado.

## Sobre as cores

A rampa `ink-950 → ink-200` é **semântica**: `ink-950` é sempre "o fundo mais profundo" e `ink-200`
sempre "o texto de maior contraste". O tema claro inverte os valores, não o significado — por isso
a troca vive inteira no CSS e nenhum componente tem condicional de tema.

O contraste dos dois temas é verificado por cálculo, não por impressão: **74 pares texto/fundo**
(incluindo o realce de sintaxe e os blocos coloridos gerados por domínio) passam em WCAG AA. A
auditoria encontrou e corrigiu inclusive uma falha antiga do tema escuro — branco sobre
`accent-500` estava em 4,47:1, abaixo do mínimo de 4,5.

## O que vem na Fase 5

Agenda no Google Calendar: um botão "agendar" no card e na nota cria o evento num calendário
dedicado, com link de volta. Sem tela de calendário aqui — quem mostra é o Google.

Depois, busca semântica (Fase 6, opcional). Lista de empresas saiu do escopo — a Cod3rs já tem uma,
compartilhada com o orientador.
