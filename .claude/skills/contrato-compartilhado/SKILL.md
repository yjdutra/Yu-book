---
name: contrato-compartilhado
description: Regras do pacote packages/shared do Yu-book — o que vira contrato compartilhado entre API e front, como adicionar schema Zod ou código de erro, por que sideEffects false não se remove, e o catálogo de espelhamentos frágeis que quebram em silêncio se divergirem (normalizarTitulo vs índice SQL, moverNoBoard vs renumeração do servidor, normalizarUrl vs unicidade de link, normalizarTag nos dois lados, o dia do prazo — que o servidor já resolve por shared com o fuso do usuário e o front ainda grava pelo fuso do navegador — e o metadado das ferramentas do acervo, uma definição só com dois consumidores, MCP e o assistente da API (chat e passos de rotina), sem portão sobre o texto, e a ferramenta da web, que só o assistente consome). Use ao criar ou alterar qualquer schema de validação, tipo de resposta, código de erro, descrição de ferramenta ou função usada pelos dois lados, ao acrescentar módulo a shared, e ao converter data ou prazo em qualquer pacote.
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
5. **Schema de atualização deriva do de criação** (`updateNoteSchema`, `notes.ts:41-42`;
   `cardUpdateSchema`, `kanban.ts:127-128`). Campo que só vale ao criar — `origin`, a marca de IA —
   entra no `.omit`, ou vira editável por PATCH sem ninguém ter decidido.
6. Se o módulo novo **constrói valor em escopo de módulo** — objeto, array, `z.object(...)`,
   qualquer coisa que não seja só `type`/`interface` —, confira o bundle do front antes de fechar.
   A flag abaixo só poda o que ninguém importa: **valor importado entra**, com o que o módulo
   dele constrói. Módulo do front que está no bundle inicial importa de `shared` só `import type`
   quando o valor traria schema ou metadado — `apps/web/src/lib/agentes.ts:16-18`, lido pelo
   painel contextual. `agenda.ts` (Etapa F) é o segundo caso: o painel e o Início leem as rotinas
   por `apps/web/src/components/rotinas/comum.tsx:1-8` e `lib/rotinas.ts`, só com tipo; quem traz
   valor dele (`Agenda.tsx`, `rascunho.ts`) entra por rota ou bloco `lazy`
   (`apps/web/src/pages/DashboardPage.tsx:26`). Um import de valor num módulo do painel desfaz isso.
   `chat.ts` (Etapa G) é o terceiro: `lib/sessaoChat.tsx`, sempre montado, **não** deduplica as
   fontes por `chaveDaFonteDoChat` (`:362-372`, medido) — quem tira a repetição é
   `components/assistente/Fontes.tsx:89-96`. Não "conserte" a sessão com o import, nem com uma
   segunda definição de "a mesma fonte" escrita à mão.

**`"sideEffects": false` no `package.json` de `shared` não é enfeite, e não se remove.** Sem ele o
bundler não pode presumir que importar `@yu-book/shared` é inócuo, e **todo** módulo do pacote entra
no bundle do front, inclusive os que nenhum componente importa — o custo cai na primeira pintura,
que é o que o usuário espera. Foi medido nesta forma: um módulo de metadado que o front não usa
entrou inteiro no bundle, e zerou com a flag. O ponteiro é fácil de perder porque `package.json` não
aceita comentário: a linha existe e não diz por quê. É esta seção que diz.

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

Lugares onde duas implementações precisam concordar e **divergir não gera erro** — gera
comportamento errado em silêncio. São o motivo principal desta skill existir.

**Não conte os itens desta seção: ela cresce e encolhe.** O que se confere é o eixo — *existe uma
segunda implementação desta regra, escrita à mão, e há um portão que acusa se as duas divergirem?*
Quando a resposta é "não" para a segunda pergunta, o item entra aqui. Quando a regra passa a morar
só em `packages/shared`, o item sai. §4.1 a §4.4 já passam por `shared`; §4.5 é o que **ainda não**
passou inteiro; §4.6 é o caso invertido — uma definição só, dois consumidores, e nenhum portão.

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

`normalizarTag` (`packages/shared/src/kanban.ts:50`) é chamada **nos dois lados**: o front normaliza
para montar o catálogo e comparar (`apps/web/src/components/SeletorDeTags.tsx:52,64`) e
`normalizarTags` normaliza de novo antes de gravar
(`apps/api/src/modules/kanban/kanban.service.ts:138`). Corta espaço, remove `#` inicial, colapsa
espaço interno, baixa a caixa e trunca em `MAX_TAG_TEXTO` — **não remove acento**: `revisão` é
gravada `revisão`.

Se um lado deixar de chamar: tags visualmente iguais viram entradas diferentes no catálogo do board
(`Banco` e `banco` lado a lado). Nada falha, nada avisa — só se percebe quando a lista já está suja.

**A chave de comparação de tags é `normalizarTitulo`, não uma função nova.** Quem precisa casar
`revisao` com `revisão` — a busca do seletor e a do painel contextual (`apps/web/src/lib/tags.ts:23`) —
usa `normalizarTitulo` de `wikilinks.ts`, a mesma do §4.1. Foi decisão explícita **não** criar uma
terceira definição de "mesmo texto" no projeto: `normalizarTag` canoniza para gravar,
`normalizarTitulo` compara. Não escreva uma `normalizarTagParaBusca`.

### 4.5 O dia do prazo ↔ as 23:59:59 que o front grava pelo fuso do navegador

**Metade desta dívida fechou na Etapa B, e a metade que sobrou trocou de lado: era "MCP × front",
agora é "`shared` × front".**

O erro que o espelhamento previne continua o mesmo: **`.slice(0, 10)` sobre o ISO**. O prazo é
gravado às 23:59:59 de um fuso local; em UTC−3 isso vira 02:59 do dia seguinte em UTC, e fatiar a
string relata **o dia errado, um dia à frente, em todo card com prazo**. Nada falha. O corte por
string continua seguro para `createdAt`/`updatedAt`, que são instantes; para prazo, não.

**O lado do servidor fechou.** A conversão mora em `packages/shared/src/formato.ts`: `diaDoPrazo`
(`:67`) e `diaParaPrazo` (`:85`), as duas sobre `diaLocal` (`packages/shared/src/ia.ts:39`), que
formata por `Intl` com `timeZone`. **O parâmetro `fuso` não tem valor padrão, e é a peça
principal** — um padrão traria de volta exatamente o defeito que a Etapa B consertou, o fuso do
*processo* passando por fuso do usuário. Quem chama declara de qual fuso está falando: o MCP
pergunta à API (`apps/mcp/src/fuso.ts:43`) e o chat recebe o `fuso` no contexto da ferramenta
(`apps/api/src/modules/assistente/ferramentas.service.ts:85-88`). As quatro funções escritas à mão
viraram duas, num lugar só. **Desde a Etapa F a volta passa por `instanteLocal`**
(`packages/shared/src/agenda.ts:165`), a mesma conversão de relógio de parede em instante que a
agenda de rotina usa: mexer nela move o prazo e o horário da rotina juntos, e o portão das duas é
`apps/api/tests/agenda.test.ts` mais `apps/mcp/tests/fuso.test.ts`.

**O lado do front não fechou.** `paraCampoData` (`apps/web/src/components/PainelCard.tsx:21`) e
`paraData` (`:30`) continuam usando `getMonth()`/`getDate()` e um `new Date("…T23:59:59")` cru —
isto é, o fuso do **navegador**, não `ai_preference.timezone`. Enquanto os dois coincidem, ninguém
vê nada. Quando divergem — operador viajando, navegador com outro fuso, ou o usuário mudando o fuso
em `/ajustes` sem mudar o do sistema —, a interface e tudo o que passa por `shared` (MCP, chat)
passam a discordar sobre qual é o dia do prazo, **e o banco guarda o que o navegador decidiu**.

Quem for mexer nesses dois: promova-os para `diaDoPrazo`/`diaParaPrazo` com o fuso vindo da API e
apague esta seção. **Não escreva uma terceira conversão de prazo** — foi o terceiro leitor escrito à
mão que segurou esta promoção por uma fase inteira.

**O front já lê pelo fuso do usuário em outro lugar.** A agenda de rotina (Etapa F) mostra horário
por `horarioNoFuso` e `horaNoFuso` (`apps/web/src/components/rotinas/comum.tsx:258`, `:281`), com o
fuso de `/ajustes` e **sem recuar ao navegador**: fuso ainda não carregado mostra "…". É o padrão que
`PainelCard` deveria seguir, não uma quarta conversão.

**`TZ` no ambiente não é conserto e agora nem é sintoma.** Pôr `TZ=America/Sao_Paulo` em
`apps/mcp/railway.json` trocaria um fuso de processo por outro fuso de processo, que continua não
sendo o do usuário — e depois da Etapa B a variável seria **inerte**: nenhuma data do texto do
servidor MCP lê mais o fuso do processo. Não a acrescente para "explicar" um prazo estranho.

### 4.6 Uma definição, dois consumidores — e nenhum portão sobre o texto

O caso invertido: aqui **não** há duas implementações. O metadado das ações do acervo — nome,
título, `descricao` e schema de entrada — mora só em `packages/shared/src/ferramentas.ts`, e é
exatamente o que a doutrina manda. O risco mudou de forma, não de tamanho.

**Desde a Etapa G o arquivo tem dois objetos, e só um vai ao MCP.** `FERRAMENTAS_DO_ACERVO` tem os
dois consumidores abaixo; `FERRAMENTAS_DA_WEB` (`:333`, `open_page`) só o assistente da API (RF-74).
O MCP fica fora dela **só porque registra tool à mão**, módulo por módulo: um laço sobre
`DEFINICOES_DO_ASSISTENTE` ou `FERRAMENTAS_DO_CHAT` no MCP publicaria `open_page` sem handler, e
nada falharia — o sinal é o `tools/list` sair da baseline da memória do agente `mcp`. Do outro lado,
definição de um nome do assistente se lê por `DEFINICOES_DO_ASSISTENTE` (`:374`), total sobre as
duas origens; nome que chega como `string` passa por uma guarda sobre ele
(`ehDoAssistente`, `apps/web/src/components/rotinas/ExecucaoRotina.tsx:64-66`). O cast
`nome as NomeDeFerramenta` compila: sem guarda, `FERRAMENTAS_DO_ACERVO[nome].titulo` lança com
`open_page`; com guarda só sobre o acervo, ela cai no nome cru.

**Dois consumidores, dois contratos diferentes, um arquivo:**

- `apps/mcp` publica esse metadado em `tools/list` (`src/tools/kanban.ts:18`, `notas.ts`,
  `kanban-escrita.ts`, `notas-escrita.ts`) — a `descricao` é o contrato de conversa do servidor MCP
  com qualquer modelo que se conecte;
- `apps/api` o oferece ao provedor no campo `tools` de **todo turno** do chat
  (`catalogoParaProvedor`, `src/modules/assistente/ferramentas.service.ts:288`, só as de
  `FERRAMENTAS_DO_CHAT`, estreitadas pela lista do agente — e, num passo de rotina, só a leitura dele) — ali a `descricao` é
  contrato **e** custo por turno.

Editar uma `descricao` para melhorar o chat muda o que o MCP publica, e encarece ou barateia todo
turno. **Nenhum teste fica vermelho.** `apps/mcp/tests/escrita.test.ts` confere **quais** tools são
anunciadas — derivadas, não listadas à mão —, nunca o texto nem o tamanho delas. Não há portão
sobre o `tools/list` em bytes.

**Segundo caso, mesmo eixo: `packages/shared/src/formato.ts`.** Os formatadores também têm uma
definição e dois consumidores — tools e resources do MCP, executores do chat (§7 da skill
`servidor-mcp-yu-book`) — e ali o texto não é só contrato: é o **resultado** sobre o qual o modelo
decide continuar ou desistir. `formatarBusca` diz, no caso vazio, que a busca é por palavra sobre
título e corpo e manda tentar o substantivo sozinho (`:184-185`); o argumento e o episódio que o
motivou estão no comentário ao lado (`:175-183`). Mudar uma dessas frases muda as duas superfícies,
e nenhum teste fica vermelho.

**Terceiro caso: o tipo `Dashboard`.** O Início e `formatarDashboard` (`formato.ts:338`, servido
pelo `get_dashboard` do MCP e do chat) leem a mesma resposta. Desde a Etapa F ela traz `rotinas`,
e o formatador **as ignora de propósito** — rotina não entra no MCP (RF-62). O mesmo par explica
por que `GET /dashboard` **só lê** `runsSeenAt` (`apps/api/src/modules/dashboard/dashboard.service.ts:57`)
e quem avança o marco é `POST /ai/runs/seen`: um GET que marcasse visto faria o modelo, ao consultar
o painel, apagar as "novas" que o operador ainda não viu.

Então, ao tocar em `ferramentas.ts`: diga no relato que as duas superfícies mudaram, e **meça** o
`tools/list` se o texto cresceu (a receita e a baseline estão na memória do agente `mcp`). O
critério de conteúdo é o da §10 da skill `servidor-mcp-yu-book`: *sabendo disto, o modelo faria algo
diferente?* Se não, é custo puro — cobrado agora em dois lugares.

## 5. Verificação

Depois de qualquer mudança em `packages/shared`:

```bash
pnpm --filter @yu-book/shared build && pnpm typecheck
```

Se tocou num dos espelhamentos do §4, rode também `pnpm --filter @yu-book/api test` e
`pnpm --filter @yu-book/mcp test`. **Nenhum dos dois cobre o §4.5 do lado do front nem o §4.6.**

- **§4.5.** O portão que existe é `apps/mcp/tests/fuso.test.ts`, e ele prova o lado do servidor —
  que a conversão usa o fuso **pedido à API**, não o do processo. O lado do front não tem portão
  nenhum e rodar na sua máquina não revela nada, porque o fuso do navegador é o certo aí. Para ver
  a divergência é preciso pôr um fuso diferente em `/ajustes` e comparar o prazo que a interface
  mostra com o que `get_card` relata.
- **§4.6.** Editar uma `descricao` não deixa nenhum teste vermelho, nos dois pacotes. Meça o
  `tools/list` à mão.
