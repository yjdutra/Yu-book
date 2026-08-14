# Yu-book — Proposta de Projeto

**Um "segundo cérebro" pessoal para a jornada na Coders:** notas de aula, projetos, trilha de estudos e trabalho, com kanban por workspace, lista de empresas e calendário de eventos.

Aplicação **single-user** (só você usa), mas com autenticação JWT de verdade — porque vai ficar exposta na internet.

---

## 1. Princípio orientador: uma entidade forte, não sete

O maior risco aqui é criar sete módulos independentes (notas de aula, notas de projeto, notas de trilha, notas de trabalho, empresas, eventos, kanban) e acabar com sete CRUDs que não conversam.

**Decisão central:** existe **uma** entidade `Note` com um campo `kind`. Aula, projeto, trilha e trabalho são *tipos* de nota, não tabelas diferentes.

Ganhos imediatos:
- **Uma** busca cobre tudo. É isso que torna a busca "inteligente" — o resultado atravessa contextos ("aquilo que anotei sobre JWT" aparece tanto da aula quanto do projeto).
- **Um** editor, **um** sistema de tags, **um** endpoint de listagem com filtros.
- Adicionar um novo tipo de nota amanhã = adicionar um valor no enum. Zero código novo.

Só ganham tabela própria as entidades com **campos e comportamento realmente distintos**: `Company` (site, setor, status de candidatura), `Event` (início/fim, all-day) e o Kanban (`Board`/`Column`/`Card`).

---

## 2. Escopo funcional

### 2.1 Notas (núcleo)
- Editor **Markdown** com preview. Sem editor rich-text/WYSIWYG — Markdown é portável e você já vai usar em README.
- Campos: título, conteúdo, `kind` (`aula` | `projeto` | `trilha` | `trabalho` | `livre`), tags, workspace, data do ocorrido, URL de referência, favorito.
- Campos extras específicos de aula ficam em uma coluna JSONB (`meta`): módulo, número da aula, instrutor, link da gravação. Sem migration para cada campo novo.
- **Links entre notas** no estilo wiki: `[[titulo-da-nota]]`. Resolvidos na renderização + seção "referenciada por" no rodapé da nota. É barato de implementar e é o que transforma notas soltas em conhecimento conectado.

### 2.2 Busca
Em duas etapas, deliberadamente:

| Fase | Tecnologia | Entrega |
|---|---|---|
| **1** | Postgres FTS (`tsvector` em português) + `pg_trgm` para erros de digitação | Busca por palavra-chave com ranking, snippet destacado, filtros combináveis por tipo/tag/workspace/período |
| **2** | `pgvector` + embeddings + RAG | Busca semântica ("como eu resolvi autenticação?") e **"pergunte às suas notas"** com resposta citando as notas de origem |

A Fase 1 resolve ~80% do uso real e custa quase nada (é nativo do Postgres, sem serviço extra). A Fase 2 só entra quando existir volume de notas suficiente para justificar — buscar semanticamente em 12 notas é teatro.

### 2.3 Workspaces
Um agrupador simples (nome + cor + ícone) que atravessa notas, boards, eventos e empresas. Ex.: `Coders`, `Trabalho`, `Freela`, `Pessoal`.

Um seletor global no topo filtra a aplicação inteira. **Não é multi-tenancy** — é uma coluna `workspace_id` e um filtro.

### 2.4 Kanban
- `Board` pertence a um workspace → `Column` (ordenada) → `Card` (ordenado).
- Card: título, descrição, prazo, prioridade, checklist (JSONB) e **vínculo opcional a uma nota**.
- Drag-and-drop com ordenação por `position` (float, ou inteiros com renumeração — resolvido em 20 linhas). Sem CRDT, sem colaboração em tempo real, sem WebSocket: você é o único usuário.

### 2.5 Empresas
Lista com nome, site, setor, status (`interesse` / `aplicado` / `entrevista` / `descartada`), tags e observações em Markdown. Visualização em tabela filtrável + link direto para o site.

Bônus barato: reaproveitar o Kanban como pipeline de candidaturas em vez de criar um fluxo próprio.

### 2.6 Calendário
Eventos com título, início/fim, all-day, local/URL, workspace e vínculo opcional a nota ou card. Visão mensal + agenda (lista dos próximos). Recorrência: **fora do MVP** — é a funcionalidade que mais consome tempo e menos se usa; entra depois via RRULE se fizer falta.

### 2.7 Dashboard
Tela inicial com: notas recentes, cards com prazo próximo, próximos eventos e busca em destaque. É o que faz a aplicação parecer útil no primeiro segundo.

---

## 3. Stack

| Camada | Escolha | Por quê |
|---|---|---|
| API | **Node + TypeScript + Fastify** | Rápido, leve, ótimo suporte a TS. NestJS traria decorators, módulos e DI que não se pagam num projeto solo |
| ORM | **Prisma** | Migrations confiáveis e tipagem end-to-end. FTS e pgvector via `$queryRaw` onde o Prisma não cobre |
| Banco | **Postgres 16** (Railway) | Faz busca full-text, JSONB e, depois, vetores. Um banco só |
| Validação | **Zod** | Schema único compartilhado entre API e front |
| Auth | **JWT** (access 15min + refresh 7d rotativo) | Detalhado na seção 5 |
| Front | **React + Vite + TypeScript** | SPA estática, build rápido, deploy trivial |
| UI | **Tailwind + shadcn/ui** | Componentes prontos, sem carregar design system |
| Estado/dados | **TanStack Query** | Cache e revalidação de graça; dispensa Redux |
| Deploy | **Railway** | 2 serviços: API e front estático, + Postgres gerenciado |

**Monorepo** com pnpm workspaces:

```
yu-book/
├─ apps/api/          # Fastify + Prisma
├─ apps/web/          # React + Vite
└─ packages/shared/   # tipos e schemas Zod compartilhados
```

**Alternativa considerada:** Next.js full-stack (um único deploy, ~$5/mês a menos). Descartada porque você pediu uma API explícita — e uma API separada é reutilizável por um app mobile, extensão de navegador ou script de importação no futuro. Se preferir economizar e simplificar, é uma troca legítima e podemos reavaliar.

---

## 4. Modelo de dados

```sql
user          id, email, password_hash, name, created_at

workspace     id, user_id, name, color, icon, position, created_at

note          id, user_id, workspace_id?, kind, title, content_md,
              meta jsonb,          -- campos livres por tipo (módulo, instrutor…)
              source_url?, occurred_at?, is_favorite,
              search_vector tsvector,   -- GIN index
              created_at, updated_at

tag           id, user_id, name, color        -- UNIQUE (user_id, name)
note_tag      note_id, tag_id                 -- PK composta
note_link     from_note_id, to_note_id        -- wiki links resolvidos

board         id, user_id, workspace_id, name, position
column        id, board_id, name, position, wip_limit?
card          id, column_id, title, description_md, position,
              due_date?, priority, checklist jsonb, note_id?, archived

company       id, user_id, workspace_id?, name, website, sector?,
              status, notes_md, created_at

event         id, user_id, workspace_id?, title, description?,
              starts_at, ends_at, all_day, location?, url?,
              note_id?, card_id?
```

Índices que importam: GIN em `note.search_vector`, GIN trigram em `note.title`, e B-tree em `(user_id, kind)`, `(column_id, position)`, `(user_id, starts_at)`.

`user_id` está em toda tabela raiz — permite um segundo usuário no futuro sem refatoração, e custa uma coluna.

---

## 5. Autenticação

- Login com email + senha (**argon2id** para o hash).
- **Access token JWT** de 15 min no header `Authorization`, mantido em memória no front.
- **Refresh token** opaco de 7 dias em cookie `httpOnly` + `Secure` + `SameSite=Strict`, com rotação a cada uso e persistido hasheado no banco (permite revogar sessão).
- Registro **fechado** por variável de ambiente (`ALLOW_SIGNUP=false`) depois que sua conta existir. Aplicação pública na internet com signup aberto é convite para lixo no banco.
- Rate limit no `/auth/login` (`@fastify/rate-limit`), CORS restrito ao domínio do front, Helmet.
- Toda query filtra por `user_id` vindo do token — nunca do body ou da query string.

Sem OAuth, sem 2FA, sem RBAC. Um usuário, um papel.

---

## 6. API (esboço)

```
POST   /auth/register | /auth/login | /auth/refresh | /auth/logout
GET    /me

GET    /notes                ?q= &kind= &tags= &workspace= &from= &to= &page=
POST   /notes
GET    /notes/:id            (inclui backlinks)
PATCH  /notes/:id
DELETE /notes/:id
GET    /search               busca unificada em notas, cards, empresas e eventos

GET    /workspaces           POST /workspaces           PATCH/DELETE /:id
GET    /tags

GET    /boards ?workspace=   POST /boards
GET    /boards/:id           board completo com colunas e cards
POST   /columns              PATCH/DELETE /columns/:id
POST   /cards                PATCH/DELETE /cards/:id
PATCH  /cards/:id/move       { columnId, position }

GET/POST/PATCH/DELETE  /companies
GET    /events ?from= &to=   POST/PATCH/DELETE /events

GET    /dashboard            agregado da home em 1 request
```

Padrão de resposta único, erros com código estável, paginação por cursor nas listas grandes.

---

## 7. Roadmap

| Fase | Entrega | Estimativa |
|---|---|---|
| **0 — Fundação** | Monorepo, Prisma + migrations, JWT completo, deploy Railway funcionando ponta a ponta, healthcheck | 2–3 dias |
| **1 — Notas** | CRUD, editor Markdown, tags, wiki links, busca FTS com filtros | 4–5 dias |
| **2 — Workspaces + Kanban** | Seletor global, boards, drag-and-drop, vínculo card↔nota | 3–4 dias |
| **3 — Empresas + Calendário** | Tabela de empresas, visão mensal e agenda | 2–3 dias |
| **4 — Dashboard + polimento** | Home agregada, atalhos de teclado, modo escuro, export Markdown | 2 dias |
| **5 — Busca semântica** *(opcional)* | pgvector, embeddings, "pergunte às suas notas" | 3–4 dias |

**Fases 0 a 4 = aplicação completa e usável.** A Fase 5 entra quando o volume de notas justificar.

Regra de ouro: **a Fase 0 termina com deploy em produção**, ainda que só com login. Deploy no fim do projeto é onde projetos pessoais morrem.

---

## 8. Custo (Railway)

| Item | Estimativa |
|---|---|
| Plano Hobby | US$ 5/mês (inclui US$ 5 de uso) |
| API + Postgres + front estático | Cabe no crédito incluído nesse volume de uso |
| Fase 5 (embeddings) | Centavos — indexação é uma vez por nota |

Realisticamente: **~US$ 5/mês**.

---

## 9. O que NÃO vamos fazer (e por quê)

| Descartado | Motivo |
|---|---|
| Microserviços | Um usuário. Um deploy |
| Redis / fila de jobs | Não há trabalho assíncrono real. FTS do Postgres é síncrono e rápido |
| Elasticsearch | Postgres FTS resolve com milhares de notas |
| WebSocket / tempo real | Você não colabora consigo mesmo |
| Editor WYSIWYG | Markdown é portável e mais rápido de digitar |
| Testes E2E completos | Testes de integração nos endpoints críticos (auth, busca, move de card). O resto não se paga |
| Docker local | Postgres da Railway direto no dev, ou `docker run postgres` avulso. Sem docker-compose de 4 serviços |
| Editor colaborativo, permissões, papéis, temas customizáveis, plugins | Nenhum tem usuário |
| Recorrência de eventos, notificações push, app mobile | Adiados. Entram se doer a ausência |

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| **Construir a ferramenta virar o estudo** | Timebox por fase. Se a Fase 1 passar de uma semana, corta escopo — não prazo |
| **Notas vazias** (app pronto, sem conteúdo) | Usar a partir da Fase 1, em produção. Cada aula da Coders vira nota **enquanto** o resto é construído |
| **Lock-in dos seus dados** | Export de todas as notas em `.md` + `.json` já na Fase 4. Suas notas nunca ficam reféns do app |
| **Perda de dados** | Backup automático do Postgres na Railway + um script `pg_dump` semanal |

---

## 11. Próximo passo

Aprovada a proposta, começo pela **Fase 0**: monorepo, schema Prisma, auth JWT completo e deploy na Railway — uma aplicação que loga e responde em produção.

**Decisão pendente:** API separada + SPA (proposto acima, 2 serviços) ou Next.js full-stack (1 serviço, mais simples e barato, menos reaproveitável). Sem resposta, sigo com a proposta acima.
