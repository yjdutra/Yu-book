---
name: contrato-compartilhado
description: Regras do pacote packages/shared do Yu-book e da fronteira com packages/cliente (o código de navegador que web e móvel dividem: fonte sem build, configurarApi, sideEffects do CSS, dedupe do React e do TanStack Query, só import type de shared, o módulo do pacote que o chunk inicial leva com tudo o que algum chunk usa, e o núcleo do chat, puro, com o efeito na sessão de cada app) — o que vira contrato compartilhado entre API e front, como adicionar schema Zod ou código de erro, por que sideEffects false não se remove, e o catálogo de espelhamentos frágeis que quebram em silêncio se divergirem (normalizarTitulo vs índice SQL, moverNoBoard vs renumeração do servidor, normalizarUrl vs unicidade de link, normalizarTag nos dois lados, o dia do prazo — que o servidor já resolve por shared com o fuso do usuário e o front ainda grava pelo fuso do navegador — e o metadado das ferramentas do acervo, uma definição só com dois consumidores, MCP e o assistente da API (chat e passos de rotina), sem portão sobre o texto, e a ferramenta da web, que só o assistente consome, e os sítios do front que uma ação de escrita nova no chat exige sem o compilador cobrar, e os tipos de anexo aceitos, listados em shared e detectados pelos bytes à mão na API, e os dias em que o evento da agenda aparece contra a consulta do período), o campo novo que o formatador compartilhado lê tolerando ausência, e os schemas não estritos, que descartam chave omitida em vez de recusá-la. Use ao criar ou alterar qualquer schema de validação, tipo de resposta, código de erro, descrição de ferramenta ou função usada pelos dois lados, ao acrescentar módulo a shared ou a packages/cliente, e ao converter data ou prazo em qualquer pacote.
---

# O contrato compartilhado

`packages/shared` existe para que **uma regra nunca fique divergente entre a API e o front**. É a
decisão de arquitetura mais importante do monorepo.

## 1. O que vai para lá

Vai:

- Todo schema Zod de entrada (`createNoteSchema`, `loginSchema`, `cardMoveSchema`…).
- Todo tipo de resposta da API (`NoteDetail`, `BoardSummary`, `Dashboard`…).
- Todo enum de domínio (`NOTE_KINDS`, `CARD_PRIORITIES`, `LinkKind`).
- Toda função que os dois lados precisam calcular igual (`normalizarTitulo`, `normalizarTag`…), e
  os limites que a tela confere antes de a API recusar (`MAX_BYTES_ARQUIVO`, em `arquivos.ts`).

Não vai: acesso a banco, chamada HTTP, qualquer coisa que importe `@prisma/client`, React ou Fastify.

## 2. Como adicionar

1. Crie ou edite o arquivo em `packages/shared/src/`.
2. **Reexporte em `packages/shared/src/index.ts`** — sem isso, nada enxerga.
3. `pnpm --filter @yu-book/shared build` — o pacote aponta para `./dist`, então os apps só veem o
   que foi compilado. **Typecheck dos apps sem esse build falha ou usa código velho.**
4. Só então `pnpm typecheck`.
5. **Schema de atualização deriva do de criação** (`updateNoteSchema`, `notes.ts:41-42`;
   `cardUpdateSchema`, `kanban.ts:129-130`). Campo que só vale ao criar — `origin`, a marca de IA —
   entra no `.omit`, ou vira editável por PATCH sem ninguém ter decidido. **Os schemas não são
   estritos:** chave omitida é descartada, não recusada — `origin` junto de `completed` no PATCH do
   card passa com 200 e conclusão humana (INV-63). Ação que precisa do campo ganha schema e rota
   próprios (`cardCompleteSchema`, `kanban.ts:142`), e a marca dela, tipo próprio (`AiCompletion`,
   `marca.ts:50`, que **não** é `AiMark`: segue o estado e some ao reabrir). **Regra que cruza
   campos não roda no schema parcial:** o servidor a reaplica sobre o valor **mesclado** com o
   gravado — `mesclarHorario` + `resolverHorario` no evento (`eventos.service.ts:251-255`), a mesma
   função de `shared` que o schema de criação chama; "hora só com data" na tarefa, repetida à mão
   (`tarefas.ts:51-54`, `tarefas.service.ts:221-226`).
6. Se o módulo novo **constrói valor em escopo de módulo** — objeto, array, `z.object(...)` —,
   confira o bundle do front antes de fechar (receita na memória do agente `frontend`). A flag
   abaixo só poda o que ninguém importa: **valor importado entra**, com o que o módulo constrói e
   importa como valor — `tarefas.ts` traz `eventos.ts` (`:2`), que traz `agenda.ts`
   (`eventos.ts:2`), que traz `ia.ts` (`agenda.ts:2`). Módulo do front no chunk inicial importa de
   `shared` só `import type` quando o valor traria schema ou metadado
   (`apps/web/src/lib/agentes.ts:18-20`, `packages/cliente/src/agenda.ts:3-12`), e o valor vem por
   rota ou `lazy` (`apps/web/src/pages/DashboardPage.tsx:27-29`). O redutor do chat (`aplicarEvento`,
   `packages/cliente/src/chat.ts:263-270`), no chunk inicial, **não** deduplica fontes por
   `chaveDaFonteDoChat` (medido): quem tira a repetição é `components/assistente/Fontes.tsx:89-96`,
   do web — não "conserte" o redutor com o import nem com outra definição de "a mesma fonte".
   **`ia.ts` é o caso aberto:** `casca/contexto/ContextoAjustes.tsx:2` lê `components/ajustes/comum.ts`,
   que importa `microsParaDolares` como valor (`:1`), e `shared/ia.ts` entra no chunk inicial (medido
   em 2026-09-25; dívida de 9b2aec6) — "a seção é `lazy()`" não justifica o import.

**`"sideEffects": false` no `package.json` de `shared` não é enfeite, e não se remove.** Sem ele o
bundler não pode presumir que importar `@yu-book/shared` é inócuo, e **todo** módulo do pacote entra
no bundle do front, até os que ninguém importa (medido: um módulo de metadado zerou com a flag).

## 3. Códigos de erro

`ERROR_CODES` em `packages/shared/src/errors.ts` é um **union type**. Um código novo precisa ser
adicionado lá antes de ser usado — o typecheck barra o resto. O formato de resposta de erro é único,
`{ "error": { "code": "TITULO_DUPLICADO", "message": "…", "issues": [ … ] } }`, e `issues` só
aparece em `ZodError` (HTTP 422). Nunca formate erro na mão na rota: lance
`AppError(status, code, msg)` ou os helpers de `apps/api/src/lib/errors.ts` e deixe o
`setErrorHandler` de `app.ts` montar a resposta.

**O front ramifica por `code`, nunca por `message`**: a mensagem é do humano, o código é o contrato.

## 4. Os espelhamentos frágeis

Lugares onde duas implementações precisam concordar e **divergir não gera erro** — gera
comportamento errado em silêncio. São o motivo principal desta skill existir.

**Não conte os itens desta seção: ela cresce e encolhe.** O que se confere é o eixo — *existe uma
segunda implementação desta regra, escrita à mão, e há um portão que acusa se as duas divergirem?*
Quando a resposta é "não" para a segunda pergunta, o item entra aqui. Quando a regra passa a morar
só em `packages/shared`, o item sai — salvo o caso invertido do §4.6, uma definição e dois consumidores.

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

Se divergirem: a UI otimista mente — o card aparece numa posição e salta para outra na resposta. A
prova do servidor é `apps/api/tests/mover-card.test.ts` (200 movimentos aleatórios, sem posição
repetida nem buraco): leia-o antes de mexer em qualquer um dos dois lados.

### 4.3 `normalizarUrl` ↔ a unicidade de link

`packages/shared/src/links.ts` decide o que é "o mesmo link": descarta fragmento, `www.` e barra
final, mas **preserva a query string** (`watch?v=A` e `watch?v=B` são links diferentes). O banco tem
`UNIQUE (user_id, kind, url)` sobre o valor já normalizado.

Se divergirem: o front deixa de detectar duplicata que o banco recusa, ou vice-versa.

### 4.4 `normalizarTag` ↔ a normalização do card no servidor

`normalizarTag` (`packages/shared/src/kanban.ts:51`) é chamada **nos dois lados**: o front normaliza
para montar o catálogo e comparar (`apps/web/src/components/SeletorDeTags.tsx:52,64`) e
`normalizarTags` normaliza de novo antes de gravar
(`apps/api/src/modules/kanban/kanban.service.ts:147`). Corta espaço, remove `#` inicial, colapsa
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

O erro que o espelhamento previne continua o mesmo: **`.slice(0, 10)` sobre o ISO**. O prazo é
gravado às 23:59:59 de um fuso local; em UTC−3 isso vira 02:59 do dia seguinte em UTC, e fatiar a
string relata **o dia errado, um dia à frente, em todo card com prazo**. Nada falha. O corte por
string continua seguro para `createdAt`/`updatedAt`, que são instantes, e para `task.date`, que é
`DATE` civil e chega como meia-noite UTC; para prazo, não. Evento e tarefa (frente de agenda) fecham
este defeito por construção — o cliente não converte fuso, e o eixo está em INV-66.

**O lado do servidor fechou.** A conversão mora em `packages/shared/src/formato.ts`: `diaDoPrazo`
(`:73`) e `diaParaPrazo` (`:91`), as duas sobre `diaLocal` (`packages/shared/src/ia.ts:48`), que
formata por `Intl` com `timeZone`. **O parâmetro `fuso` não tem valor padrão, e é a peça
principal** — um padrão traria de volta exatamente o defeito que a Etapa B consertou, o fuso do
*processo* passando por fuso do usuário. Quem chama declara de qual fuso está falando: o MCP
pergunta à API (`apps/mcp/src/fuso.ts:43`) e o chat recebe o `fuso` no contexto da ferramenta
(`apps/api/src/modules/assistente/ferramentas.service.ts:110-113`). **Desde a Etapa F a volta passa por `instanteLocal`**
(`packages/shared/src/agenda.ts:165`), a mesma conversão de relógio de parede em instante que a
agenda de rotina usa: mexer nela move o prazo e o horário da rotina juntos, e o portão das duas é
`apps/api/tests/agenda.test.ts` mais `apps/mcp/tests/fuso.test.ts`. **A aritmética de dia
`AAAA-MM-DD` é uma só**, `somarDias` (`agenda.ts:223`), que a janela do AI usage dash também usa.
Mora em `agenda.ts` e não em `ia.ts` porque `agenda.ts:2` importa `ia.ts`: o inverso fecharia
um ciclo. Não escreva uma segunda. **De instante para hora de parede é `horaLocal`**
(`agenda.ts:210`), par de `diaLocal`, sobre a mesma conversão da ida: não escreva outra no servidor.

**O lado do front não fechou.** `paraCampoData` (`apps/web/src/components/PainelCard.tsx:22`) e
`paraData` (`:31`) continuam usando `getMonth()`/`getDate()` e um `new Date("…T23:59:59")` cru —
isto é, o fuso do **navegador**, não `ai_preference.timezone`. Enquanto os dois coincidem, ninguém
vê nada. Quando divergem — operador viajando, navegador com outro fuso, ou o usuário mudando o fuso
em `/ajustes` sem mudar o do sistema —, a interface e tudo o que passa por `shared` (MCP, chat)
passam a discordar sobre qual é o dia do prazo, **e o banco guarda o que o navegador decidiu**.

Quem for mexer nesses dois: promova-os para `diaDoPrazo`/`diaParaPrazo` com o fuso vindo da API e
apague esta seção. **Não escreva uma terceira conversão de prazo.**

**O front já lê pelo fuso do usuário em outro lugar.** A agenda de rotina (Etapa F) mostra horário
por `horarioNoFuso` e `horaNoFuso` (`apps/web/src/components/rotinas/comum.tsx:258`, `:281`), com o
fuso de `/ajustes` e **sem recuar ao navegador**: fuso ainda não carregado mostra "…". É o padrão que
`PainelCard` deveria seguir, não uma quarta conversão.

**`TZ` no ambiente não é conserto:** no serviço do MCP trocaria um fuso de processo por
outro, e **inerte** — desde a Etapa B nenhuma data do texto do MCP lê o fuso do processo.

### 4.6 Uma definição, dois consumidores — e nenhum portão sobre o texto

O caso invertido: aqui **não** há duas implementações. O metadado das ações do acervo — nome,
título, `descricao` e schema de entrada — mora só em `packages/shared/src/ferramentas.ts`, e é
exatamente o que a doutrina manda. O risco mudou de forma, não de tamanho.

**Desde a Etapa G o arquivo tem dois objetos, e só um vai ao MCP.** `FERRAMENTAS_DO_ACERVO` tem os
dois consumidores abaixo; `FERRAMENTAS_DA_WEB` (`:527`, `open_page`) só o assistente da API (RF-74).
O MCP fica fora dela **só porque registra tool à mão**, módulo por módulo: um laço sobre
`DEFINICOES_DO_ASSISTENTE` ou `FERRAMENTAS_DO_CHAT` no MCP publicaria `open_page` sem handler, e
nada falharia — o sinal é o `tools/list` sair da baseline da memória do agente `mcp`. Do outro lado,
definição de um nome do assistente se lê por `DEFINICOES_DO_ASSISTENTE` (`:568`), total sobre as
duas origens; nome que chega como `string` passa por uma guarda sobre ele
(`ehDoAssistente`, `apps/web/src/components/rotinas/ExecucaoRotina.tsx:64-66`). O cast
`nome as NomeDeFerramenta` compila: sem guarda, `FERRAMENTAS_DO_ACERVO[nome].titulo` lança com
`open_page`; com guarda só sobre o acervo, ela cai no nome cru.

**Dois consumidores, dois contratos diferentes, um arquivo:**

- `apps/mcp` publica esse metadado em `tools/list` (`apps/mcp/src/tools/`, um módulo por área e
  risco, como `kanban.ts:18`) — a `descricao` é o contrato de conversa do servidor MCP com qualquer
  modelo que se conecte;
- `apps/api` o oferece ao provedor no campo `tools` de **todo turno** do chat
  (`catalogoParaProvedor`, `src/modules/assistente/ferramentas.service.ts:412`, só as de
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
título e corpo e manda tentar o substantivo sozinho (`:205-206`); o argumento e o episódio que o
motivou estão no comentário ao lado (`:196-204`). Mudar uma dessas frases muda as duas superfícies,
e nenhum teste fica vermelho. **Campo novo lido ali tolera ausência** (`card.files?.length`,
`formato.ts:348-351`), apesar do tipo: o MCP formata depois da escrita, contra uma API que pode ser
mais velha (§13 de `servidor-mcp-yu-book`). O detalhe do card leva `files` **sem URL** — ela vence
em 1 h —, e quem mostra o arquivo pede `GET /cards/:id/files` (`packages/shared/src/kanban.ts:226-228`).

**Terceiro caso: o tipo `Dashboard`.** O Início e `formatarDashboard` (`formato.ts:385`, servido
pelo `get_dashboard` do MCP e do chat) leem a mesma resposta. Desde a Etapa F ela traz `rotinas`,
e o formatador **as ignora de propósito** — rotina não entra no MCP (RF-62). O mesmo par explica
por que `GET /dashboard` **só lê** `runsSeenAt` (`apps/api/src/modules/dashboard/dashboard.service.ts:59`)
e quem avança o marco é `POST /ai/runs/seen`: um GET que marcasse visto faria o modelo, ao consultar
o painel, apagar as "novas" que o operador ainda não viu.

**Quarto caso: ação de escrita nova no chat.** Além da API (INV-52), o front tem sítios que o
compilador cobra: `EXPLICACAO` (`apps/web/src/components/agentes/ferramentas.ts:16`) e, se ela cria
um **tipo** novo, o `COMO_MOSTRAR` de cada app, total sobre `ChatCreated["kind"]` (web
`components/assistente/Conversa.tsx:79`, móvel `components/chat/Criados.tsx:26`). E sítios que não:
`ROTULO_DA_ACAO` e `ICONE_DA_ACAO` (`packages/cliente/src/chat/StatusDaResposta.tsx:20`, `:45`) caem
no nome cru e na faísca; cada app invalida por `kind` citado (`apps/web/src/lib/chat.ts:54-71`,
`apps/movel/src/lib/sessaoChat.ts:103-108`); o editor de agente trata toda escrita como criação
salvo exceção por nome (`EditorAgente.tsx:531-541`); e **escrita que não cria não passa pelo evento
`criado`** (o do Desfazer): a sessão a marca pelo evento `ferramenta` e invalida no `finally`
(`apps/web/src/lib/sessaoChat.tsx:368-371`, `:400-401`; `apps/movel/src/lib/sessaoChat.ts:109-114`, `:131`).

Então, ao tocar em `ferramentas.ts`: diga no relato que as duas superfícies mudaram, e **meça** o
`tools/list` se o texto cresceu (a receita e a baseline estão na memória do agente `mcp`). O
critério de conteúdo é o da §10 da skill `servidor-mcp-yu-book`: *sabendo disto, o modelo faria algo
diferente?* Se não, é custo puro — cobrado agora em dois lugares.

### 4.7 `TIPOS_DE_ARQUIVO` ↔ `detectarTipo`

O que se anexa a card é decidido **pelos bytes**, na API: `detectarTipo`
(`apps/api/src/modules/arquivos/arquivos.service.ts:87-110`) reconhece cada tipo por assinatura
escrita à mão. `TIPOS_DE_ARQUIVO` (`packages/shared/src/arquivos.ts:25-50`) é a lista que o resto
lê: o `accept` do seletor (`ACEITA_ARQUIVO`, `:53`), `ehImagem`, e na própria API `nomeCoerente` e
o tipo do texto por extensão (`mimeDaExtensao`, `arquivos.service.ts:75-78`).

Se divergirem: tipo só em `shared` aparece no seletor e toma 415 (`TIPO_NAO_PERMITIDO`) em todo
envio; tipo que só `detectarTipo` conhece é gravado sem extensão corrigida e baixa como anexo
mesmo sendo imagem. **Não há portão**: `apps/api/tests/arquivos.test.ts:888` lista os casos à mão,
e não percorre `TIPOS_DE_ARQUIVO`. Tipo novo entra nos dois, com a assinatura e um caso no teste.

### 4.8 O evento no período: `diasDoEvento` e `MAX_DIAS_DO_EVENTO` ↔ a consulta da API

`GET /agenda` e `GET /events` trazem o evento que se sobrepõe à janela, semiaberto em
`[startsAt, endsAt)` (`apps/api/src/modules/eventos/eventos.service.ts:154-175`). Quem desenha dia a
dia usa `diasDoEvento` (`packages/shared/src/eventos.ts:314`; o calendário do móvel,
`apps/movel/src/components/agenda/itens.ts:80`, e o bloco Hoje do web, `BlocoHoje.tsx:53`), a mesma regra em dias locais: o evento
com hora que acaba às 00:00 traz `endDate` no dia seguinte e não aparece nele. **Não desenhe de
`date` a `endDate`** — o calendário mostraria o evento num dia que a API desse dia não devolve.
Portão: `apps/api/tests/eventos.test.ts:635`.

O limite também tem dois leitores. `MAX_DIAS_DO_EVENTO` (`eventos.ts:35`) recusa o evento longo e é
o piso de `startsAt` na consulta (`eventos.service.ts:163-168`), para o índice `(user_id, starts_at)`
cortar dos dois lados. Subi-lo é seguro; **baixá-lo** com eventos mais longos já gravados os tira
das janelas em que terminam, sem erro — e o portão (`eventos.test.ts:850`) cria o mais longo pelo
limite novo e segue verde.

## 5. Verificação

Depois de qualquer mudança em `packages/shared` (em `packages/cliente`, basta o typecheck):
```bash
pnpm --filter @yu-book/shared build && pnpm typecheck
```

Se tocou num dos espelhamentos do §4, rode também `pnpm --filter @yu-book/api test` e
`pnpm --filter @yu-book/mcp test`. **Nenhum dos dois cobre o lado do front do §4.5 nem o §4.6.** O
§4.5 não se revela na sua máquina, onde o fuso do navegador é o certo: ponha outro fuso em
`/ajustes` e compare o prazo da tela com o que `get_card` relata. O §4.6 se mede à mão.

## 6. `packages/cliente`: o que os dois fronts dividem

`shared` é o contrato com a API, sem React nem HTTP (§1). **`packages/cliente` é o código de
navegador que web e móvel precisam igual** — cliente HTTP e sessão, `tema.css`, `base/`, ícones,
foco preso (`packages/cliente/src/api.ts:1-9`) e, desde a Fase 5 da agenda, o núcleo do chat, o
Markdown e o ditado — e as chaves de cache que pacote e apps leem, numa definição só
(`agenda.ts:33-41`, `ia.ts:1-15`). Cópia num app seria um espelhamento do §4; o de um app só fica nele.

- **Fonte, não build:** `exports` aponta para `src/` e o Vite de cada app compila. Não lê
  `import.meta.env`: cada app chama `configurarApi` no `main.tsx`, antes de montar (`api.ts:12-25`).
- **`"sideEffects": ["*.css"]`** (`packages/cliente/package.json:6`): o TS é podável como o de
  `shared` (§2), o `tema.css` nunca. Não troque por `false`.
- **React e TanStack Query são `peerDependency`** (`packages/cliente/package.json:30-34`), **e cada
  `vite.config` os põe em `resolve.dedupe`** (`apps/web/vite.config.ts:7-14`, idem no móvel), sem
  erro de build se faltar: dois Reacts dão "Invalid hook call"; duas Queries, dois contextos, e os
  hooks de `agenda.ts` não acham o `QueryClient` do app.
- **De `shared`, só `import type`** (`api.ts:10`, `chat.ts:2-11`, `agenda.ts:3-12`): valor levaria
  o módulo de `shared` ao chunk inicial (§2, passo 6). Duas exceções, com a razão ao lado: módulo
  que não arrasta nada (`markdown.ts:1-6`) e `hoje.ts:1-7`, que arrasta (`somarDias` é uma só, §4.5)
  e por isso, no web, só tela `lazy` importa.
- **Módulo do pacote que o inicial importa leva para lá toda exportação dele que algum chunk use**
  (medido três vezes: o transporte do chat pela lista de conversas do móvel; `useConcluirTarefa`,
  +1,4 kB, por `agenda.ts`; `motivoSemChat` por `ia.ts`). O que só tela `lazy` usa mora em módulo
  à parte, com entrada própria no `exports` (`chat/AvatarIA.tsx:3-8`, `concluirTarefa.ts:8-15`).
- **O núcleo do chat é estado; o efeito é de cada app** (`packages/cliente/src/chat.ts:24-29`):
  `aplicarEvento` é puro; erro, invalidação e marcas de "concluiu" ficam na sessão de cada front.
