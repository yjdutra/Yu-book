---
name: convencoes-yu-book
description: Convenções de código do Yu-book — nomenclatura em português no domínio e inglês na fronteira da API, imports ESM com extensão .js, estilo de comentário citando RF-xx, tipagem estrita e a ausência deliberada de linter. Use antes de escrever ou revisar qualquer código em apps/api, apps/web ou packages/shared, e sempre que precisar decidir como nomear algo neste repositório.
---

# Convenções do Yu-book

Este repositório **não tem ESLint, Prettier nem Biome**. A consistência vem de imitação, não de
ferramenta. Antes de criar um arquivo, abra um vizinho da mesma pasta e copie a forma.

## 1. Idioma — a regra que mais se erra

O domínio é nomeado em **português**. A fronteira da API é em **inglês**. As duas convivem dentro
da mesma função, e isso é intencional.

| Em português | Em inglês |
|---|---|
| Funções de domínio: `criar`, `listar`, `atualizar`, `excluir`, `mover`, `buscarPorId` | Campos de DTO: `title`, `contentMd`, `dueDate`, `isFavorite` |
| Componentes React: `ListaNotas`, `ColunaQuadro`, `GavetaLinks` | Caminhos de rota: `/notes`, `/boards`, `/links` |
| Props e variáveis locais: `aberta`, `onFechar`, `carregando` | Nomes de coluna do banco |
| Módulos: `modules/organizacao/`, `lib/busca.ts`, `tests/apoio.ts` | Infraestrutura: `buildApp`, `authenticate`, `apiRequest` |
| Todo comentário e toda mensagem de erro ao usuário | Tipos vindos de `@yu-book/shared` |

Exemplo real da costura, em `apps/web/src/lib/notas.ts`: a função chama-se `paraResumo` e mapeia
`NoteDetail` para `NoteSummary` usando campos em inglês. Está certo assim.

**Nunca "padronize" para inglês.** Se estiver em dúvida sobre um nome novo, pergunte: isso atravessa
a fronteira HTTP? Se sim, inglês. Se não, português.

## 2. Módulos e imports

ESM puro (`"type": "module"`, `module: NodeNext`). **Todo import interno leva extensão `.js`**,
inclusive de arquivo `.ts`:

```ts
import { prisma } from "../../db.js";
import { criarNota } from "./notes.service.js";
```

Esquecer a extensão compila no editor e quebra em runtime.

## 3. Tipagem

`strict: true` e **`noUncheckedIndexedAccess: true`** em todo o monorepo. Todo acesso por índice
devolve `T | undefined`. Daí os `?? ""`, `?? []` e guardas `if (!x) return` espalhados pelo código —
não são paranoia, são o compilador.

Padrão de select tipado na API:

```ts
const CAMPOS = { id: true, title: true } satisfies Prisma.NoteSelect;
type Linha = Prisma.NoteGetPayload<{ select: typeof CAMPOS }>;
function paraNota(linha: Linha): NoteSummary { /* Date → toISOString(), ?? null */ }
```

Update parcial é sempre spread condicional, para distinguir "não enviado" de `null`:

```ts
...(input.title !== undefined && { title: input.title })
```

## 4. Comentário

Comentário explica **por quê**, nunca o quê. Em português. Cita o identificador do requisito quando
existe — `RF-14`, `RN-03`, `RNF-08`, `CA-16`, `S-04`.

**O identificador é local ao PRD da fase, não global, e os números se repetem entre fases.** `RF-19`
é o tema em `apps/web/src/lib/tema.ts:8` (Fase 1) e é "o ponteiro decide o destino do arraste" em
`apps/web/src/components/Quadro.tsx:165` (Fase 5). Quem lê resolve pelo arquivo em que o comentário
está: fases 1 a 4 em `docs/old/prd-fase-*.md`, Fase 5 em diante em `docs/prd-fase-*.md`. Quem
escreve **não** renumera nem inventa prefixo de fase para desambiguar — o código inteiro já cita
assim, e mudar metade dele é pior que a ambiguidade.

```ts
// RF-15. Ctrl+L puro é a barra de endereço do navegador — daí o Shift.
```

Vários comentários documentam decisões de planner do Postgres ou de identidade de callback do React.
**Remover o código que eles descrevem quebra desempenho ou comportamento em silêncio.** Se um
comentário explica uma escolha que parece estranha, ela é deliberada — confirme antes de mexer.

## 5. Estilo

2 espaços, aspas duplas, ponto e vírgula, ~100 colunas. Arquivos `.tsx` só quando há JSX — por isso
`apps/web/src/lib/auth.tsx` e `workspace.tsx` são `.tsx`, e renderizam Providers.

Sem barris (`index.ts` reexportador) em `apps/web`. `components/` é plano, sem subpastas. `lib/`
mistura hooks, utilitários puros e módulos de query — não reorganize.

## 6. Verificação

```bash
pnpm --filter @yu-book/shared build   # sempre antes de typecheckar os apps
pnpm typecheck
pnpm --filter @yu-book/api test       # exige Postgres no ar
```

Rode e **relate a saída real**. Não afirme que passou sem ter rodado.
