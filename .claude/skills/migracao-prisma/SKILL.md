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
`notas_fase_1`, `busca_aproximada`, `kanban_fase_2`, `links_fase_3`, `ia_etapa_e_rotinas`.

**Sem terminal interativo, `prisma migrate dev` não roda** (é o caso de agente). A receita é gerar
o SQL e aplicar pelo `deploy`, que não pergunta nada:

```bash
cd apps/api && pnpm exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_<nome>/migration.sql
pnpm exec prisma migrate deploy && pnpm exec prisma generate
```

O prefixo `<timestamp>` ordena a aplicação: escrito à mão, ele precisa ficar **depois** do da última
migration da pasta, mesmo com o relógio da máquina atrás — `20260925150000_ia_etapa_f_agenda` foi
escolhido assim.

**O banco de desenvolvimento é de verdade.** O `DATABASE_URL` de `apps/api/.env` aponta para
`yubook`, que guarda a conta real do operador — e é nele que a suíte da API roda.

- **`prisma migrate reset` não é seguro**: apaga a conta junto.
- **Migration já aplicada não se edita** — nem em dev. Mudou de ideia depois de aplicar? Migration
  nova, aditiva: a Etapa E fechou com três (`ia_etapa_e_rotinas`, `_pulso`, `_uma_execucao`), e a
  emenda dela ganhou a quarta (`_pedido`) em vez de editar as três, que nem tinham subido.
- **Valor novo de enum não se usa na migration que o cria**: o Postgres recusa `ADD VALUE` usado na
  mesma transação. Ele entra sem uso, e o padrão ou dado que o usa vai na seguinte
  (`20260925133313_ia_etapa_e_pedido/migration.sql:5-6`).
- **Não rode `prisma format`.** Ele reformata o `schema.prisma` inteiro, não só o trecho novo, e o
  diff da entrega vira ruído. Alinhe à mão, como os vizinhos.

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
| `ai_routine_run_uma_em_andamento_idx` | `20260924233000_ia_etapa_e_uma_execucao` | `UNIQUE (user_id) WHERE status = 'em_andamento'` — RN-19, uma execução por conta (INV-04) |

**Índice parcial não aparece no `schema.prisma`, e o Prisma 6 nem o introspecta nem o derruba**:
`prisma migrate diff` sai vazio com ele no banco (conferido ao criar a migration, comentário no
`migration.sql` dela). Quem lê só o schema não sabe que a regra existe — por isso a tabela acima.

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
porque o Prisma reporta a expressão do índice e não o nome dele. **Índice parcial sobre coluna
simples** reporta as colunas: `ehOutraEmAndamento`
(`apps/api/src/modules/assistente/execucao.service.ts:155-166`) casa `meta.target = ["user_id"]`
**e** `meta.modelName`, para que o `P2002` de outro único do mesmo modelo suba como é. O mesmo
índice dispara também no `updateManyAndReturn` que converte uma `pulada` em `em_andamento` (Etapa F,
`execucao.service.ts:581`), com o mesmo `meta.target` do `create` — os dois caem no mesmo `catch`
(`:629-633`). O único do horário vem como `["routine_id", "scheduled_for"]`, e `ehHorarioTomado`
(`:170-180`) o separa: índice novo no mesmo modelo pede helper próprio, não um `includes` mais largo.

## 6. Antes de fechar

- [ ] `pnpm --filter @yu-book/api db:migrate` (ou a receita do §1) aplicou sem erro
- [ ] `pnpm typecheck` passa
- [ ] `pnpm --filter @yu-book/api test` passa
- [ ] Se criou objeto SQL fora do Prisma, ele está no `migration.sql` e não só no banco local
- [ ] Nenhuma migration já aplicada foi editada; nenhum `prisma format` no diff
- [ ] Se mexeu em índice de busca, a busca sem acento e a busca aproximada continuam funcionando
