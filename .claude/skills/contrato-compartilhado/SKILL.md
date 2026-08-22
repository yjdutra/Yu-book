---
name: contrato-compartilhado
description: Regras do pacote packages/shared do Yu-book — o que vira contrato compartilhado entre API e front, como adicionar schema Zod ou código de erro, e o catálogo de espelhamentos frágeis que quebram em silêncio se divergirem (normalizarTitulo vs índice SQL, moverNoBoard vs renumeração do servidor, normalizarUrl vs unicidade de link). Use ao criar ou alterar qualquer schema de validação, tipo de resposta, código de erro ou função usada pelos dois lados.
---

# O contrato compartilhado

`packages/shared` existe para que **uma regra nunca fique divergente entre a API e o front**. É a
decisão de arquitetura mais importante do monorepo.

## 1. O que vai para lá

Vai:

- Todo schema Zod de entrada (`createNoteSchema`, `loginSchema`, `cardMoveSchema`…).
- Todo tipo de resposta da API (`NoteDetail`, `BoardSummary`, `Dashboard`…).
- Todo enum de domínio (`NOTE_KINDS`, `CARD_PRIORITIES`, `LinkKind`).
- Toda função que os dois lados precisam calcular igual (`normalizarTitulo`, `normalizarUrl`,
  `parseSearchQuery`, `splitHighlight`, `progressoChecklist`, `idDoYoutube`, `formatarDuracao`).

Não vai: acesso a banco, chamada HTTP, qualquer coisa que importe `@prisma/client`, React ou Fastify.

## 2. Como adicionar

1. Crie ou edite o arquivo em `packages/shared/src/`.
2. **Reexporte em `packages/shared/src/index.ts`** — sem isso, nada enxerga.
3. `pnpm --filter @yu-book/shared build` — o pacote aponta para `./dist`, então os apps só veem o
   que foi compilado. **Typecheck dos apps sem esse build falha ou usa código velho.**
4. Só então `pnpm typecheck`.

## 3. Códigos de erro

`ERROR_CODES` em `packages/shared/src/errors.ts` é um **union type**. Um código novo precisa ser
adicionado lá antes de ser usado — o typecheck barra o resto. O formato de resposta de erro é único:

```jsonc
{ "error": { "code": "TITULO_DUPLICADO", "message": "…", "issues": [ … ] } }
```

`issues` só aparece em `ZodError` (HTTP 422). Nunca formate erro na mão na rota: lance
`AppError(status, code, msg)` ou os helpers de `apps/api/src/lib/errors.ts` e deixe o
`setErrorHandler` de `app.ts` montar a resposta.

**O front ramifica por `code`, nunca por `message`.** A mensagem é para o humano; o código é o
contrato.

## 4. Os espelhamentos frágeis

Três lugares onde duas implementações precisam concordar e **divergir não gera erro** — gera
comportamento errado em silêncio. São o motivo principal desta skill existir.

### 4.1 `normalizarTitulo` ↔ o índice único do Postgres

`packages/shared/src/wikilinks.ts` faz NFD, remove diacríticos e passa para minúsculas. Isso
**espelha exatamente** `lower(immutable_unaccent(title))`, a expressão do índice
`note_title_unico_idx`, criado na migration `20260814004639_notas_fase_1`.

Se divergirem: `[[titulo]]` deixa de resolver para a nota certa, e a checagem de título duplicado
passa a discordar do banco. Alterar um lado obriga a alterar o outro **e** a criar migration.

### 4.2 `moverNoBoard` ↔ a renumeração do servidor

`apps/web/src/lib/kanban.ts` replica no cliente a matemática que
`apps/api/src/modules/kanban/kanban.service.ts` executa em transação, para que o arraste apareça
antes da resposta da API.

Se divergirem: a UI otimista mente — o card aparece numa posição e salta para outra quando a resposta
chega. A prova da matemática do servidor está em `apps/api/tests/mover-card.test.ts`, que faz 200
movimentos aleatórios e verifica que não sobra posição repetida nem buraco. Leia esse teste antes de
mexer em qualquer um dos dois lados.

### 4.3 `normalizarUrl` ↔ a unicidade de link

`packages/shared/src/links.ts` decide o que é "o mesmo link": descarta fragmento, `www.` e barra
final, mas **preserva a query string** (`watch?v=A` e `watch?v=B` são links diferentes). O banco tem
`UNIQUE (user_id, kind, url)` sobre o valor já normalizado.

Se divergirem: o front deixa de detectar duplicata que o banco recusa, ou vice-versa.

## 5. Verificação

Depois de qualquer mudança em `packages/shared`:

```bash
pnpm --filter @yu-book/shared build && pnpm typecheck
```

Se tocou num dos três espelhamentos, rode também `pnpm --filter @yu-book/api test`.
