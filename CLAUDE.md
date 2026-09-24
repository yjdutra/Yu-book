# Yu-book

Segundo cérebro pessoal, single-user. Monorepo pnpm com quatro pacotes:

| Pacote | Stack | Papel |
|---|---|---|
| `apps/api` | Fastify 5 + Prisma 6 + Postgres 16 | API REST |
| `apps/web` | React 19 + Vite 6 + Tailwind v4 | SPA desktop-only |
| `apps/mcp` | SDK MCP + stdio/HTTP | Servidor MCP, cliente da própria API |
| `packages/shared` | Zod 3 | Schemas e helpers que os outros três consomem |

Proposta inicial em `docs/old/PROPOSTA-inicial.md` (registro de época, não se atualiza).
Requisitos por fase em `docs/old/prd-fase-*.md` e, da Fase 5 em diante, em `docs/prd-fase-*.md` —
os comentários do código citam os identificadores `RF-xx`, `RN-xx`, `RNF-xx` e `CA-xx` de lá. A
frente de IA tem PRD próprio, `docs/prd-ia-no-yu-book.md`: é dele que saem os `RF-xx` de **todo
código que serve o assistente**, em qualquer pacote — a lista de arquivos cresce a cada etapa.
**Fases 0 a 5 entregues.** A 5 foi refino do que já existe
(`docs/old/prd-fase-5-refino.md`): tags de card, precisão do arraste, e o editor Markdown ao vivo com
CodeMirror 6. As três etapas dela foram fechadas **sem conferência de interface à mão** — a dívida
está registrada em `docs/historico.md`, e no caso do editor nenhum portão chega a instanciar uma
`EditorView`. Desde 2026-09-22 a **frente de IA** tem código, não só documento: a Etapa A entregou o
provedor OpenRouter, teto de gasto diário, a tela `/ajustes` e o botão de formatar nota, e a **Etapa
B** (2026-09-23) o chat ancorado, que lê o acervo por um laço de até cinco chamadas ao provedor por
mensagem. A **Etapa C** (2026-09-24) trouxe a marca de conteúdo gerado por IA, gravada só pelo
servidor, e com ela o chat passou a **criar** card e nota a pedido — não move, não apaga, não edita.
A **Etapa D** (2026-09-24) trouxe os **agentes especialistas**: instruções, notas-base, fontes vivas,
modelo e ferramentas próprios, fixos por conversa, numa área dentro de Assistente
(`/assistente/agentes`), sem item no trilho. A Fase 6 de produto (Google Calendar) segue sendo o item de menor prioridade.

**Cinco numerações vivem no repositório e não se convertem uma na outra.** As **fases de produto**
vão de 0 a 5 e estão fechadas; as **etapas do servidor MCP** são cinco, e a 4 (transporte HTTP e
identidade) foi entregue em 2026-09-01; o **roteiro de IA aplicada** tem fases próprias, e a 5 dele é
a frente de IA; dentro dessa frente, o **PRD de IA** tem as suas, de 1 a 4, entregues em etapas com
letra — a Etapa A cobriu as fases 1 e 2 dele, a Etapa B a fase 3, e as Etapas C e D não são fase dele (§5.5, §5.6); e o **redesenho de UI/UX** de
`apps/web` tem cinco etapas próprias, entregues em 2026-09-24 sem conferência na tela a cada etapa e
conferidas à mão pelo usuário no fechamento — relato, não checklist item por item (registro em
`docs/historico.md`); essa numeração está fechada. "Etapa 4" não é
"Fase 4", e o mesmo número significa coisas diferentes em cada eixo. Não unifique nem renumere — a
entrada de 2026-08-26 em `docs/historico.md` diz de onde vêm as quatro primeiras.

**O `RF-xx` do comentário resolve para o PRD da fase daquele código — os números colidem entre
fases.** `RF-19` é o tema claro em `apps/web/src/lib/tema.ts` e é a colisão pelo ponteiro em
`apps/web/src/components/Quadro.tsx`. Não renumere nem invente prefixo para desambiguar.

## Regras que quebram o projeto se ignoradas

- **Idioma do código:** domínio em **português** (`criar`, `mover`, `renumerarCards`, `ListaNotas`),
  fronteira da API em **inglês** (`title`, `contentMd`, `dueDate`). As duas convivem na mesma
  função. Não "padronize" para inglês.
- **`packages/shared` é fonte única de verdade.** Se a API e o front precisam concordar sobre algo,
  mora lá. Rode `pnpm --filter @yu-book/shared build` antes de qualquer typecheck dos apps.
  **E não é mais só API e front:** `packages/shared/src/ferramentas.ts` guarda o metadado das ações
  do acervo, e editar uma `descricao` ali muda ao mesmo tempo o que o servidor MCP publica em
  `tools/list` e o que o chat paga em todo turno. Nenhum teste fica vermelho. O mesmo vale para
  `packages/shared/src/formato.ts`, que imprime o texto das duas superfícies.
- **Não existe ESLint, Prettier, Biome nem CI.** Estilo se aprende por imitação: 2 espaços, aspas
  duplas, ~100 colunas. Não instale linter.
- **Não instale biblioteca de UI nem de ícones.** Sem shadcn, sem Radix, sem Material. Ícone novo é
  SVG à mão em `apps/web/src/components/Icones.tsx`. Botão, diálogo, menu e os demais primitivos já
  existem em `apps/web/src/components/base/`: use-os em vez de copiar classes.
- **Nunca use a variante `dark:` do Tailwind.** O tema mora inteiro em CSS, em `apps/web/src/index.css`.
  Cor nova exige entrada no bloco `@theme` **e** em `:root[data-tema="claro"]`.
- **`apps/api` tem duas camadas e só duas:** `*.routes.ts` faz `schema.parse` → chama service →
  devolve; `*.service.ts` concentra regra e Prisma. Rota que importa `prisma` é violação.
- **Imports internos levam extensão `.js`** (ESM/NodeNext), inclusive em arquivos `.ts` — menos em
  `apps/web`, que resolve como `Bundler` e importa sem extensão.
- **`strict` e `noUncheckedIndexedAccess` estão ligados.** Todo acesso por índice devolve
  `T | undefined`.

## Verificação

```bash
pnpm --filter @yu-book/shared build    # antes de typecheckar os apps
pnpm typecheck                          # portão obrigatório
pnpm --filter @yu-book/api test         # exige Postgres no ar (DATABASE_URL do .env); uma rodada por vez
pnpm --filter @yu-book/mcp test         # não precisa de banco nem de API no ar
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
| `servidor-mcp-yu-book` | Decisões do servidor MCP e a propagação quando o domínio muda |

Agentes especialistas em `.claude/agents/`. Só o `curador` escreve em `.claude/`; só o
`publicador` faz commit e deploy, e nunca dá push sem alguém pedir — aqui push para `master` é
deploy em produção, e **`apps/mcp` também é deployado**: quarto serviço na Railway, por
`apps/mcp/railway.json`. Ele tem **dois transportes**: stdio, que roda na máquina do operador, e
StreamableHTTP, que é o do serviço hospedado — ali ele é servidor OAuth 2.1 próprio e a identidade
vem de quem chamou. Ele **escreve** desde a Etapa 3, e **o que libera a escrita muda com o
transporte**: em stdio, a API ser local; em HTTP, o escopo do token mais `MCP_ESCRITA_HABILITADA`.
A trava por host local não participa do caminho HTTP, e hospedado ela não protege nada: o serviço
aponta para a API de produção. A skill `servidor-mcp-yu-book` tem os dois eixos.
