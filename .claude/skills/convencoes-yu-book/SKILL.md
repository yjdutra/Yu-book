---
name: convencoes-yu-book
description: Convenções de código do Yu-book — nomenclatura em português no domínio e inglês na fronteira da API, imports ESM com extensão .js, estilo de comentário citando RF-xx, tipagem estrita, a injeção para teste que não pode usar valor padrão de parâmetro, e a ausência deliberada de linter. Use antes de escrever ou revisar qualquer código em apps/api, apps/web ou packages/shared, e sempre que precisar decidir como nomear algo neste repositório.
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

**`apps/web` é a exceção:** sobrescreve para `moduleResolution: "Bundler"`
(`apps/web/tsconfig.json:5-6`), e ali o import interno vai **sem** extensão, como todo o código do
front já faz. Não acrescente `.js` lá.

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

**Valor padrão de parâmetro reassume o ambiente.** `f(x = env.ALGO)` chamado com `undefined` cai no
padrão — então `f(chaveQueNaoExiste)` responde como se houvesse chave, e o teste de "sem chave"
passa testando outra coisa. Mordeu duas vezes na mesma entrega da frente de IA. Quando a **ausência**
é um caso de teste, o parâmetro é obrigatório (`temChave`,
`apps/api/src/modules/assistente/openrouter.service.ts:65`) ou a injeção vem por objeto com checagem
de `in`, que distingue "não informei" de "informei que não há" (`saude`,
`apps/api/src/modules/assistente/assistente.service.ts:23-28`). O valor padrão continua certo quando
o que se injeta é uma **função** e a ausência não é caso de teste — `buscarTitulo(…, permitido:
Guarda = todosPublicos)` (`apps/api/src/modules/links/titulo.service.ts:66`) e a guarda e o
resolvedor de `abrirPagina` (`apps/api/src/modules/web/pagina.service.ts:359-363`).

**Injetar o relógio num laço sobre todas as contas pede também o escopo, obrigatório.** A suíte da
API roda no banco de desenvolvimento, que guarda a conta real: uma volta global com `agora`
inventado dispararia as rotinas agendadas do operador. Daí `voltaDaAgenda(agora, registro,
somenteDe)` (`apps/api/src/modules/assistente/agendador.service.ts:161-165`) com os três sem padrão —
o relógio de produção passa `null`, "todas", por extenso; o teste passa o próprio usuário.

## 4. Comentário

Comentário explica **por quê**, nunca o quê. Em português. Cita o identificador do requisito quando
existe — `RF-14`, `RN-03`, `RNF-08`, `CA-16`, `S-04`.

**O identificador é local ao PRD da fase, não global, e os números se repetem entre fases.** `RF-19`
é o tema em `apps/web/src/lib/tema.ts:22` (Fase 4) e é "o ponteiro decide o destino do arraste" em
`apps/web/src/components/Quadro.tsx:167` (Fase 5). Quem lê resolve pelo arquivo em que o comentário
está: fases 1 a 5 em `docs/old/prd-fase-*.md`, fase nova em `docs/prd-fase-*.md`. Quem
escreve **não** renumera nem inventa prefixo de fase para desambiguar — o código inteiro já cita
assim, e mudar metade dele é pior que a ambiguidade.

**Nem todo PRD é de fase.** O `RF-xx` de todo código que serve o assistente, em qualquer pacote —
`modules/assistente/`, `/ajustes`, agentes, a marca de IA — resolve para
`docs/prd-ia-no-yu-book.md`, que tem **fases próprias de 1 a 4** (§5.1 a §5.4) e seções de etapa
sem fase (§5.5 em diante), entregues em etapas com letra. "Fase 2" num comentário do módulo de IA é
*Formatar nota*, não a Fase 2 de produto.

```ts
// RF-15. Ctrl+L puro é a barra de endereço do navegador — daí o Shift.
```

Vários comentários documentam decisões de planner do Postgres ou de identidade de callback do React.
**Remover o código que eles descrevem quebra desempenho ou comportamento em silêncio.** Se um
comentário explica uma escolha que parece estranha, ela é deliberada — confirme antes de mexer.

## 5. Estilo

2 espaços, aspas duplas, ponto e vírgula, ~100 colunas. Arquivos `.tsx` só quando há JSX — por isso
`apps/web/src/lib/auth.tsx` e `workspace.tsx` são `.tsx`, e renderizam Providers.

Sem barris (`index.ts` reexportador) em `apps/web`, inclusive nas subpastas: importe do arquivo.
`components/` admite **subpasta por papel** — primitivos em `base/`, a casca em `casca/`, e uma
por área que cresceu além de um arquivo, como `assistente/` e `ajustes/`. `lib/` mistura hooks,
utilitários puros e módulos de query — não reorganize.

**Caractere invisível ou de controle vai no fonte como escape `\uXXXX`, nunca literal** — em
regex inclusive (`[\u0300-\u036f]`, `U+2028`, `U+FEFF`). Literal não se vê na revisão, e `U+2028`
dentro de regex é quebra de linha para o parser. As ferramentas Write/Edit do agente convertem o
escape em literal ao gravar — mordeu de novo na Etapa G: grave por script (heredoc com aspas
simples) e confira com
`grep -nP '[\x{0000}-\x{0008}\x{000b}\x{000c}\x{000e}-\x{001f}\x{007f}-\x{009f}\x{0300}-\x{036f}\x{2028}\x{2029}\x{feff}]'`.

## 6. Verificação

```bash
pnpm --filter @yu-book/shared build   # sempre antes de typecheckar os apps
pnpm typecheck
pnpm --filter @yu-book/api test       # exige Postgres no ar
```

Rode e **relate a saída real**. Não afirme que passou sem ter rodado.
