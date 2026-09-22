---
name: contrato-compartilhado
description: Regras do pacote packages/shared do Yu-book — o que vira contrato compartilhado entre API e front, como adicionar schema Zod ou código de erro, e o catálogo de espelhamentos frágeis que quebram em silêncio se divergirem (normalizarTitulo vs índice SQL, moverNoBoard vs renumeração do servidor, normalizarUrl vs unicidade de link, normalizarTag nos dois lados, e o dia do prazo entre o front e o MCP — o único que ainda não passa por shared, e que hoje relata o dia errado no MCP hospedado). Use ao criar ou alterar qualquer schema de validação, tipo de resposta, código de erro ou função usada pelos dois lados, e ao converter data ou prazo em qualquer pacote.
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
  `normalizarTag`, `parseSearchQuery`, `splitHighlight`, `progressoChecklist`, `idDoYoutube`,
  `formatarDuracao`).

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

Cinco lugares onde duas implementações precisam concordar e **divergir não gera erro** — gera
comportamento errado em silêncio. São o motivo principal desta skill existir.

Os quatro primeiros passam por `packages/shared`, como manda a doutrina. **O quinto não** — e não é
mais só dívida: ele está **errado em produção**, no MCP hospedado. Ver §4.5.

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

### 4.4 `normalizarTag` ↔ a normalização do card no servidor

`normalizarTag` (`packages/shared/src/kanban.ts:48`) é chamada **nos dois lados**: o front normaliza
para montar o catálogo e comparar (`apps/web/src/components/SeletorDeTags.tsx:51,63`) e
`normalizarTags` normaliza de novo antes de gravar
(`apps/api/src/modules/kanban/kanban.service.ts:136`). Corta espaço, remove `#` inicial, colapsa
espaço interno, baixa a caixa e trunca em `MAX_TAG_TEXTO` — **não remove acento**: `revisão` é
gravada `revisão`.

Se um lado deixar de chamar: tags visualmente iguais viram entradas diferentes no catálogo do board
(`Banco` e `banco` lado a lado). Nada falha, nada avisa — só se percebe quando a lista já está suja.

**A chave de comparação de tags é `normalizarTitulo`, não uma função nova.** Quem precisa casar
`revisao` com `revisão` — a busca do seletor e a da barra lateral (`apps/web/src/lib/tags.ts:24`) —
usa `normalizarTitulo` de `wikilinks.ts`, a mesma do §4.1. Foi decisão explícita **não** criar uma
terceira definição de "mesmo texto" no projeto: `normalizarTag` canoniza para gravar,
`normalizarTitulo` compara. Não escreva uma `normalizarTagParaBusca`.

### 4.5 O dia do prazo ↔ as 23:59:59 locais que o front grava

**Dívida declarada, e hoje ela está cobrando: este espelhamento deveria morar em `packages/shared`,
não mora, e o MCP hospedado está errado por causa disso.**

O front grava o prazo às **23:59:59 do fuso local** (`paraData`,
`apps/web/src/components/PainelCard.tsx:26`, convenção da Fase 2, documentada em
`apps/web/src/lib/tempo.ts:43`) e lê de volta em `paraCampoData` (`PainelCard.tsx:15`). Do lado do
MCP o par é `diaDoPrazo` e `diaParaPrazo` (`apps/mcp/src/formato.ts:56,71`). São quatro funções
escritas à mão para uma conversão só.

**O erro que isso previne é `.slice(0, 10)` sobre o ISO.** Em UTC-3, 23:59:59 local vira 02:59 do
dia seguinte em UTC — fatiar a string relata **o dia errado, um dia à frente, em todo card com
prazo**. Nada falha; o modelo só passa a informar prazos deslocados. O corte por string continua
seguro para `createdAt`/`updatedAt`, que são instantes; para prazo, não.

#### O defeito vivo: "hora local" é a do **processo**, não a do usuário

`diaDoPrazo` usa `getMonth()`/`getDate()` e `diaParaPrazo` monta `new Date("AAAA-MM-DDT23:59:59")`
— as duas leem o fuso **do processo**. Em stdio isso acerta por acidente, porque o processo roda na
máquina do operador. **Hospedado, erra:** `apps/mcp/railway.json` não define `TZ` e a Railway roda
em UTC. Medido: um prazo gravado pelo front como `2026-09-22T02:59:59Z` é `2026-09-21` em
`America/Sao_Paulo` e `2026-09-22` em UTC — o MCP hospedado relata **todo prazo um dia à frente** do
que a interface mostra, e `diaParaPrazo` grava o prazo **três horas cedo** (23:59:59 UTC = 20:59:59
local). É exatamente o erro de um dia que a seção existe para evitar, entrando por outra porta.

Pôr `TZ=America/Sao_Paulo` no `railway.json` apaga o sintoma e **não** é o conserto: troca o fuso do
processo por outro fuso do processo, que continua não sendo o do usuário.

#### O conserto, que agora tem peça

A Etapa A da frente de IA trouxe as duas coisas que faltavam:

- `diaLocal(instante, fuso)` (`packages/shared/src/ia.ts:39`), que formata por `Intl` com `timeZone`
  — sem tabela de horário de verão nossa;
- o fuso do usuário **no domínio pela primeira vez**: `ai_preference.timezone`
  (`apps/api/prisma/schema.prisma:351`), com padrão `FUSO_PADRAO` (`packages/shared/src/ia.ts:24`).

Quem for mexer nos dois lados promove a conversão para `packages/shared` usando `diaLocal` e o fuso
vindo da API — **não** o do processo —, e apaga esta seção. Não duplique a conversão num terceiro
lugar: um terceiro leitor de prazo escrito à mão fecha a porta dessa promoção. Note que `diaLocal`
hoje é chamada **só pelo servidor**, de propósito (o comentário em `ia.ts:26-38` diz por quê); usar
a mesma função é o que impede uma segunda definição de "o dia do usuário".

## 5. Verificação

Depois de qualquer mudança em `packages/shared`:

```bash
pnpm --filter @yu-book/shared build && pnpm typecheck
```

Se tocou num dos cinco espelhamentos, rode também `pnpm --filter @yu-book/api test`. O §4.5 não
tem teste que o cubra — e rodar à mão na sua máquina **não** reproduz o defeito, porque o fuso do
seu processo é o certo. Para conferir o caminho hospedado é preciso forçar o fuso:
`TZ=UTC node -e "…"` sobre `diaDoPrazo`, ou olhar o prazo que o serviço da Railway relata para um
card cujo prazo você conhece.
