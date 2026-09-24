---
name: migracao-prisma
description: Como criar e aplicar migrations do Yu-book com Prisma e Postgres, incluindo os objetos SQL que vivem fora do schema.prisma (configuração de busca pt_unaccent, immutable_unaccent, trigger de search_vector, índices GIN e trigram, índice único parcial) e as regras de SQL cru. Use ao alterar o modelo de dados, criar migration, mexer em índice ou escrever qualquer $queryRaw.
---

# Migrations e SQL do Yu-book

**`prisma migrate deploy` roda no boot de produção** (`start` de `apps/api/package.json`). Migration
quebrada não falha num pipeline — derruba o deploy. Trate cada migration como irreversível.

## 1. Fluxo

```bash
pnpm --filter @yu-book/api db:migrate    # prisma migrate dev — cria e aplica em dev
pnpm --filter @yu-book/api db:generate   # regenera o client se só mudou o schema
pnpm --filter @yu-book/api test          # a suíte fala com o Postgres de verdade
```

Nome de migration em `snake_case` descrevendo a entrega, no padrão já usado:
`notas_fase_1`, `busca_aproximada`, `kanban_fase_2`, `links_fase_3`, `duracao_do_link`.

## 2. Convenções do schema

- PK `uuid` (`@db.Uuid`, `@default(uuid())`).
- Coluna em `snake_case` via `@map`; tabela no singular via `@@map` (`user`, `note`, `board_column`).
- Timestamps `TIMESTAMP(3)` **sem timezone**. Tudo trafega em UTC, serializado com `.toISOString()`.
- `user_id` em toda tabela raiz. **`card` e `board_column` são exceção deliberada** — a posse vem da
  cadeia até `board.userId`. Não adicione `user_id` a elas.

## 3. O SQL que o Prisma não conhece

Estes objetos existem só nos arquivos `migration.sql`. O `schema.prisma` não os representa, e
`prisma migrate dev` não os recria sozinho. Alterá-los exige migration escrita à mão.

| Objeto | Onde nasceu | Para quê |
|---|---|---|
| `CREATE EXTENSION unaccent, pg_trgm` | `20260814000220_init` | Base da busca |
| Configuração `pt_unaccent` | `20260814000220_init` | `portuguese` + `unaccent`; faz `programacao` achar `programação` |
| `note_search_vector_update()` + trigger | `20260814000220_init` | Mantém `search_vector`; título peso A, corpo peso B |
| `public.immutable_unaccent(text)` | `20260814004639_notas_fase_1` | Wrapper `IMMUTABLE`; **sem ele nada é indexável** |
| `note_title_unico_idx` | `20260814004639_notas_fase_1:24` | `UNIQUE (user_id, lower(immutable_unaccent(title))) WHERE deleted_at IS NULL` |
| Índices GIN trigram em `note.title` e `card.title` | `busca_aproximada`, `kanban_fase_2` | Tolerância a erro de digitação |

**`immutable_unaccent` é o eixo de tudo.** Ele aparece no índice único, nos índices trigram e em
quase todo SQL cru. E precisa continuar espelhando `normalizarTitulo` de
`packages/shared/src/wikilinks.ts` — ver a skill `contrato-compartilhado`.

## 4. Regras de SQL cru

Sempre template tag, sempre parametrizado, sempre com cast explícito:

```ts
await prisma.$queryRaw`SELECT id FROM note WHERE user_id = ${userId}::uuid LIMIT ${n}::int`;
```

- **Nunca concatene string.** Fragmento composto usa `Prisma.sql`, `Prisma.join` e `Prisma.empty`.
  `Prisma.raw` só com literal do código — o apelido de tabela de `marcaDe`
  (`apps/api/src/modules/notes/search.service.ts:28-30`) —, nunca com entrada.
- **`count(*)` volta como `bigint`** — envolva em `Number()`.
- **Cast em número é obrigatório** quando o valor entra numa função que espera `int`: o Prisma envia
  número como `bigint`. É o motivo de `left(content_md, ${N}::int)`.
- Mutação que mexe em ordem roda em `prisma.$transaction`, e a função recebe
  `Prisma.TransactionClient`.

## 5. Erro do Prisma nunca vaza

`P2002` é traduzido por um helper local (`ehDuplicado`, `ehViolacaoDeTitulo`) para um `AppError` 409
com mensagem em português. A violação de título é detectada por `meta.target` conter `"title"`,
porque o Prisma reporta a expressão do índice e não o nome dele.

## 6. Antes de fechar

- [ ] `pnpm --filter @yu-book/api db:migrate` aplicou sem erro
- [ ] `pnpm typecheck` passa
- [ ] `pnpm --filter @yu-book/api test` passa
- [ ] Se criou objeto SQL fora do Prisma, ele está no `migration.sql` e não só no banco local
- [ ] Se mexeu em índice de busca, a busca sem acento e a busca aproximada continuam funcionando
