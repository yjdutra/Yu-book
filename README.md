# Yu-book

Segundo cérebro pessoal: notas de aula, projetos, trilha de estudos e trabalho, com kanban por
workspace, lista de empresas e calendário de eventos.

Proposta e decisões de escopo em [PROPOSTA.md](PROPOSTA.md).
Requisitos da fase atual em [docs/prd-fase-1-notas.md](docs/prd-fase-1-notas.md).

**Status: Fases 0 e 1 concluídas.**

- **Fase 0 — fundação:** monorepo, banco, autenticação JWT, deploy configurado.
- **Fase 1 — notas:** CRUD, editor Markdown split ao vivo com autosave, tags, workspaces,
  links `[[wiki]]` com backlinks, busca full-text por `Ctrl+K` e lixeira.

Próxima: Fase 2 — kanban.

---

## Estrutura

```
yu-book/
├─ apps/api/        Fastify + Prisma + Postgres
├─ apps/web/        React + Vite + Tailwind
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

## Deploy na Railway

Três serviços no mesmo projeto: **Postgres**, **API** e **web**.

### 1. Postgres
Adicione o plugin Postgres. Ele expõe `DATABASE_URL`.

### 2. Serviço da API
- **Config as code**: `apps/api/railway.json`
- **Variáveis**:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<openssl rand -base64 48>
CORS_ORIGIN=https://<seu-front>.up.railway.app
COOKIE_SAMESITE=none
ALLOW_SIGNUP=true          # volte para false depois de criar sua conta
```

`PORT` a Railway injeta sozinha. O `startCommand` roda `prisma migrate deploy` antes de subir,
então migrations são aplicadas a cada deploy.

### 3. Serviço do web
- **Config as code**: `apps/web/railway.json`
- **Variáveis**:

```
VITE_API_URL=https://<sua-api>.up.railway.app
```

> `VITE_API_URL` é lida **em tempo de build**, não em runtime. Se você trocar o valor, precisa
> fazer um novo deploy — mudar a variável sozinha não muda nada.

### Sobre o cookie entre domínios

API e front ficam em domínios diferentes (`api.up.railway.app` × `web.up.railway.app`), que o
navegador trata como **cross-site**. Daí `COOKIE_SAMESITE=none` — sem isso o cookie de refresh
simplesmente não é enviado e a sessão cai a cada 15 minutos.

Se você apontar um domínio próprio (`api.seudominio.com` e `app.seudominio.com`), os dois passam a
ser same-site: aí use `COOKIE_SAMESITE=lax` e `COOKIE_DOMAIN=.seudominio.com`, que é mais seguro.

---

## Usando (Fase 1)

A aplicação é **desktop-only** por decisão de projeto: abaixo de 1024px ela avisa em vez de
degradar o layout. Três colunas fixas — navegação, lista, editor — com larguras ajustáveis por
arrasto e persistidas.

| Atalho | O que faz |
|---|---|
| `Ctrl+N` | nova nota, com o cursor já no título |
| `Ctrl+K` | busca em tudo, de qualquer tela |
| `Ctrl+S` | salva agora, sem esperar o autosave |
| `Ctrl+B` / `Ctrl+I` / `` Ctrl+` `` | negrito / itálico / código |
| `[[` | autocomplete para vincular a outra nota |
| `Ctrl+/` | lista de atalhos |

**Autosave:** salva 800 ms depois que você para de digitar. Falha de rede não apaga o que está na
tela — o erro fica visível e há 3 novas tentativas a cada 5 s.

**Busca:** `Ctrl+K` aceita filtros no próprio campo — `tipo:aula`, `tag:jwt`, `#coders` — combináveis
com o termo. Ignora acento (`programacao` acha `programação`), aplica stemming (`autenticar` acha
`autenticação`) e, quando não acha nada exato, cai num fallback por semelhança de título que
tolera erro de digitação.

**Links entre notas:** `[[titulo]]` vira link clicável; se o título não existir, o link aparece
marcado como "criar" e clicar nele cria a nota. Renomear uma nota reescreve os `[[…]]` de todas as
que apontam para ela, então os links não quebram. Cada nota lista quem a referencia no rodapé.

**Lixeira:** excluir é reversível por 30 dias. A nota some de listagem, busca, autocomplete e
backlinks, mas dá para restaurar com tags e links intactos.

### Regras que valem conhecer

- **Título é único por usuário**, comparado sem acento e sem diferenciar maiúsculas. É o que faz
  `[[titulo]]` apontar sempre para uma nota só. Título repetido é recusado com aviso.
- **Campos de aula** (módulo, instrutor, link da gravação) ficam em `note.meta` (JSONB), num painel
  recolhível — adicionar um campo novo não pede migration.
- **Tag sem nenhuma nota é apagada sozinha**, para o autocomplete não acumular lixo.

## O que vem na Fase 2

Kanban: boards por workspace, colunas, cards com prazo e checklist, e vínculo card ↔ nota.
