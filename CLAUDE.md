# Yu-book

Segundo cérebro pessoal, single-user. Monorepo pnpm com três pacotes:

| Pacote | Stack | Papel |
|---|---|---|
| `apps/api` | Fastify 5 + Prisma 6 + Postgres 16 | API REST |
| `apps/web` | React 19 + Vite 6 + Tailwind v4 | SPA desktop-only |
| `packages/shared` | Zod 3 | Schemas e helpers usados pelos dois |

Proposta e decisões de escopo em `PROPOSTA.md`. Requisitos por fase em `docs/old/prd-fase-*.md` —
os comentários do código citam os identificadores `RF-xx`, `RN-xx`, `RNF-xx` e `CA-xx` de lá.
Fases 0 a 4 entregues; a próxima é a 5 (Google Calendar).

## Regras que quebram o projeto se ignoradas

- **Idioma do código:** domínio em **português** (`criar`, `mover`, `renumerarCards`, `ListaNotas`),
  fronteira da API em **inglês** (`title`, `contentMd`, `dueDate`). As duas convivem na mesma
  função. Não "padronize" para inglês.
- **`packages/shared` é fonte única de verdade.** Se a API e o front precisam concordar sobre algo,
  mora lá. Rode `pnpm --filter @yu-book/shared build` antes de qualquer typecheck dos apps.
- **Não existe ESLint, Prettier, Biome nem CI.** Estilo se aprende por imitação: 2 espaços, aspas
  duplas, ~100 colunas. Não instale linter.
- **Não instale biblioteca de UI nem de ícones.** Sem shadcn, sem Radix, sem Material. Ícone novo é
  SVG à mão em `apps/web/src/components/Icones.tsx`.
- **Nunca use a variante `dark:` do Tailwind.** O tema mora inteiro em CSS, em `apps/web/src/index.css`.
  Cor nova exige entrada no bloco `@theme` **e** em `:root[data-tema="claro"]`.
- **`apps/api` tem duas camadas e só duas:** `*.routes.ts` faz `schema.parse` → chama service →
  devolve; `*.service.ts` concentra regra e Prisma. Rota que importa `prisma` é violação.
- **Imports internos levam extensão `.js`** (ESM/NodeNext), inclusive em arquivos `.ts`.
- **`strict` e `noUncheckedIndexedAccess` estão ligados.** Todo acesso por índice devolve
  `T | undefined`.

## Verificação

```bash
pnpm --filter @yu-book/shared build    # antes de typecheckar os apps
pnpm typecheck                          # portão obrigatório
pnpm --filter @yu-book/api test         # exige Postgres no ar (DATABASE_URL do .env)
```

São os únicos portões automáticos que existem. Rode-os e relate a saída real.

## Onde está o conhecimento

| Skill | Para quê |
|---|---|
| `convencoes-yu-book` | Estilo, nomenclatura, comentário, tipagem |
| `contrato-compartilhado` | O que vai para `packages/shared` e os espelhamentos frágeis |
| `invariantes-yu-book` | Catálogo verificável do que não pode quebrar |
| `migracao-prisma` | Migrations e o SQL que vive fora do Prisma |
| `design-system-yu-book` | Tokens, temas, ícones, acessibilidade |
| `changelog-e-versao` | Formato do changelog, semver, commits |

Agentes especialistas em `.claude/agents/`. Só o `curador` escreve em `.claude/`; só o
`publicador` faz commit e deploy, e ele nunca dá push sem alguém pedir — aqui push para `master`
é deploy em produção.

`apps/mcp` é o servidor MCP do Yu-book. Ele **não é deployado**: roda na máquina do operador,
iniciado pelo cliente MCP, e fala HTTPS com a API.
