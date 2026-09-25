# Invariantes — servidor e contrato

Referência da skill `invariantes-yu-book`. Cobre `apps/api`, `packages/shared` e `apps/mcp`.
O front está em `referencias/front.md`.

## Segurança e escopo

**INV-01 — `userId` vem só do token.** Nenhuma query aceita id de usuário vindo do body, da query
string ou de parâmetro de rota. `request.userId` é preenchido exclusivamente por
`apps/api/src/lib/authenticate.ts`. Toda query filtra por ele.

**INV-02 — Id de outro usuário devolve 404, não 403.** Existência de recurso alheio não é revelada.
Documentado em `apps/api/src/modules/kanban/kanban.service.ts:44` (RNF-15).

**INV-03 — Posse do kanban resolve por cadeia, na mesma query.** `card` e `board_column` **não têm
coluna `user_id`**. A posse vem de `card → column → board.userId`, dentro do próprio `where` — nunca
"busca primeiro, confere depois". Adicionar `user_id` a essas tabelas é mudança de modelo, não
conveniência.

**INV-04 — Escrita condicional em vez de checar-depois-agir.** Mutação usa
`updateMany`/`deleteMany` com o escopo no `where` e testa `count === 0` para lançar 404. Elimina a
corrida entre checagem e efeito. O argumento inteiro está em `conversas.service.ts:180-186`, que
adotou a forma atômica de propósito: a forma checar-depois-agir deixa a posse como **disciplina de
quem escreve a próxima função**; a atômica a deixa no tipo da consulta.

**Duas exceções antigas, nomeadas — não são precedente.** `atualizarWorkspace`
(`apps/api/src/modules/organizacao/organizacao.service.ts:83`) faz `findFirst` antes do `update`
por id, e `excluir` (`apps/api/src/modules/links/links.service.ts:148`) faz `doUsuario` antes do
`delete`. As duas **escopam** certo e pagam a corrida; são dívida declarada aqui, não licença.
Numa revisão: código novo nessa forma é violação, e estas duas não se citam como apoio. Quem for
convertê-las, converta-as — não copie a forma delas para um terceiro sítio.

**Quando a condição é "não existe outra", o `where` não alcança: a escrita condicional é um
índice.** RN-19 (uma execução de rotina em andamento por conta) é `findFirst` + `create` em
`iniciar` — e, desde a Etapa F, também o `updateManyAndReturn` que converte a `pulada` de um horário
em `em_andamento` (`execucao.service.ts:590-612`): são duas escritas que gravam o status, e as duas
passam pelo índice. Na janela de deploy duas instâncias da API convivem (INV-60): dois "Rodar agora"
passam juntos pela consulta. Quem garante é o índice único parcial
`ai_routine_run_uma_em_andamento_idx` (migration `20260924233000_ia_etapa_e_uma_execucao`), e o
`P2002` dele vira o mesmo 409 em `ehOutraEmAndamento`
(`apps/api/src/modules/assistente/execucao.service.ts:157-168`, aplicado em `:638-642`) —
reconhecido por `meta.target = ["user_id"]` mais o modelo, porque o Prisma não dá o nome de índice
parcial. O `Set` `iniciando` (`:145-151`) é só otimização do clique duplo local: confiar nele no
lugar do índice reabre a corrida. Coberto em `apps/api/tests/rotinas.test.ts:785`. RN-19 vale para
os dois tipos de entrada; a idempotência pela ideia (RN-18) só existe na entrada por coluna —
no pedido cada execução é independente (`execucao.service.ts:532-557`, `rotinas.test.ts:2035`).

**INV-05 — `TOKEN_EXPIRED` e `UNAUTHORIZED` são códigos distintos de propósito.** O primeiro dispara
o refresh no front; o segundo derruba a sessão. Fundir os dois cria laço de login.
`apps/api/src/lib/authenticate.ts`.

**INV-06 — Refresh token roda com rotação e consumo atômico; a detecção de reuso tem janela de
graça.** Cada refresh revoga o apresentado, e a atomicidade vem de
`updateMany({ where: { id, revokedAt: null } })` com checagem de `count`
(`apps/api/src/modules/auth/auth.service.ts:151`). A detecção de reuso **não é incondicional**:
`GRACA_DE_REUSO_MS = 30_000` (`:20`) faz o token reapresentado dentro de 30 s da revogação devolver
401 **sem** derrubar a cadeia (`:134`); fora da janela, o reuso continua revogando todas as sessões
do usuário (`:140`). A janela existe por causa do servidor MCP, que não é navegador e não retenta
por conta própria. **O custo está declarado no comentário e não é pequeno:** ela cega exatamente a
corrida que a rotação existe para pegar — quem roubar um refresh e usá-lo primeiro sobrevive à
janela, e o legítimo toma 401 mudo. Coberto por `apps/api/tests/auth-refresh.test.ts`.

**INV-07 — Login paga custo constante.** Email inexistente ainda calcula um argon2 descartável, para
que o tempo de resposta não revele quais emails existem.

**INV-08 — O que separa as defesas de saída é a origem do alvo, não a contagem de pontos.** O
servidor abre conexão para fora em duas classes. O eixo está escrito em
`apps/api/src/modules/assistente/openrouter.service.ts:5-11`.

*Alvo vindo de fora — do usuário ou do modelo* — sai **só** por `pedirPublico`
(`apps/api/src/lib/saidaSegura.ts:335`), que concentra a classe inteira: só `http`/`https`
(`:359`); `hostRecusado` por nome, antes de resolver, a cada salto (`:361-364`); `todosPublicos`
(`:109-110`) exigindo que **todos** os endereços sejam públicos, conferido a cada salto antes de
conectar (`:382`) — redirecionar para 127.0.0.1 é recusado como o alvo original; redirecionamento
manual até `maxSaltos`; orçamento de tempo total, resolução inclusa (`:307-323`); corte de bytes
depois de descomprimir. Nunca lança: a falha volta com motivo, e cada consumidor decide o que ela
vira. Consumidores: o título de link (`apps/api/src/modules/links/titulo.service.ts:68-75` — 2 s,
512 KB, só HTML; falhar vira `null` e **nunca** impede o link de ser salvo) e `open_page`
(`apps/api/src/modules/web/pagina.service.ts:364-377` — 8 s, 1 MB, texto, sem LinkedIn; falhar
vira texto para o modelo). Consumidor novo passa por `pedirPublico` com os próprios limites.

**A conexão é presa aos endereços conferidos — é o que fecha o DNS rebinding.** O nome é resolvido
uma vez por salto e o socket recebe **esses** endereços pelo `lookup` da requisição (`lookupPreso`,
`saidaSegura.ts:164-192`); `agent: false` (`:247`) não reaproveita socket aberto para outro
endereço; IP literal é o próprio endereço conferido, sem resolvedor (`:366-373`). Por isso
`node:http`, não `fetch` (`:29-30`): o `fetch` resolve **de novo**, e até a Etapa G o título de link
conferia por `dns.lookup` e conectava pelo `fetch` — um DNS que respondesse público e depois 127.0.0.1
passava. Voltar ao `fetch` compila e deixa a suíte de links verde; quem acusa é
`apps/api/tests/web.test.ts:355`, sem DNS real: dois servidores na mesma porta em 127.0.0.1 e
127.0.0.2, um resolvedor que responde .2 e depois .1, e uma guarda que recusa só .1.

**O corte de bytes se declara na fronteira.** Pedaço que enche o limite exatamente não corta: o
próximo corta (`cabe` = 0), e o `end` sem próximo não (`saidaSegura.ts:279-296`). O gunzip entrega
16 KiB por vez e 1 MB é múltiplo disso: parar no pedaço que enche o limite, sem esperar o próximo,
entregava a página comprimida maior que 1 MB como se estivesse inteira (`web.test.ts:519`).

*Alvo vindo do ambiente* — `links/youtube.service.ts:14-15` (oEmbed e Data API) e
`assistente/openrouter.service.ts:139` (base em `OPENROUTER_BASE_URL`, caminho literal do nosso
código). Nenhuma parte da URL é escolhida por quem chama: **não há superfície de SSRF**, e por isso
nada passa por `pedirPublico`. A busca na web da Etapa G é desta classe: é um campo `plugins` no
pedido ao OpenRouter (`passo.service.ts:202-204`), e quem abre as páginas é o provedor. O texto que
o usuário digita para filtrar o catálogo de modelos é aplicado **depois, em memória**
(`assistente/modelos.service.ts:221-235`), nunca concatenado na URL — é essa linha que mantém o
ponto nesta classe. Aqui falhar **sobe** com código estável, em vez de virar `null`: o usuário
clicou num botão e precisa saber que não aconteceu.

**As guardas protegem a rede interna, não o conteúdo** (RN-24). Um agente com `open_page` e o
acervo à mão junta dado privado, texto não confiável e saída de rede: a página pode pedir que ele
abra `https://atacante/?q=<o que leu>`, e isso passa por todas as guardas
(`pagina.service.ts:19-27`). A cerca "é dado, não instrução" (`paginaComoTexto`, `:428`) e as linhas
da web no `system` (`agentes.service.ts:131-152`) são pedido, e a página pode forjar a cerca. A
mitigação é o opt-in — fora de `FERRAMENTAS_PADRAO` e de `FERRAMENTAS_SEM_AGENTE` — e o aviso de
`levaOAcervoParaFora` (`apps/web/src/components/agentes/ferramentas.ts:66-71`), no editor do agente
(`EditorAgente.tsx:1025`) e no passo de rotina (`PainelDoBloco.tsx:565`). O texto da tela não
promete mais que "instrução" (`EditorAgente.tsx:1037-1041`): garantia só a lista (RN-14, INV-52).

**Ponto de saída novo se classifica antes de ser escrito.** Se qualquer pedaço da URL — host,
caminho ou parâmetro que o alvo transforme em host — vier do usuário **ou do modelo**, ele cai
inteiro na primeira classe; não existe meia defesa. Contar pontos de saída nunca foi a invariante,
e a contagem já esteve errada aqui duas vezes.

**INV-10 — Destaque de busca usa caracteres de controle, não HTML.** `HL_START` e `HL_END` são
os caracteres de controle `U+0001` e `U+0002` (`packages/shared/src/busca.ts:10-11`), para que
nenhuma nota consiga forjar marcação. O front nunca renderiza HTML de resultado de busca. **Texto
de terceiro chega sem eles:** `limparTituloDaFonte`
(`apps/api/src/modules/web/pagina.service.ts:50-60`) serve o título da página aberta e o da citação
da busca (`assistente/fluxo.ts:128`), e o texto da página passa por `normalizarEspacos`
(`pagina.service.ts:223-232`).
Porta nova de texto da web usa uma das duas (`apps/api/tests/web.test.ts:745`, `:1082`).

**INV-59 — Id de entidade relacionada vindo do cliente é conferido contra o usuário; a FK só
garante que existe.** `conferirWorkspace` (`apps/api/src/modules/notes/notes.service.ts:115`) roda
na criação e na edição de nota (`:232`, `:311`), como `criarBoard` já fazia
(`kanban.service.ts:209-214`). Antes dela, o `workspaceId` de outra conta era aceito e a resposta
devolvia o nome do workspace alheio; o inexistente caía em violação de FK, distinguível do alheio.
Os dois dão o mesmo 404 (INV-02). Com o chat criando nota, o id chega também dos argumentos que o
**modelo** escreveu. Porta nova que grave nota — ou qualquer FK vinda de fora — confere a posse.
Coberto em `apps/api/tests/marca-ia.test.ts:523`.

**A Etapa D levou a regra ao agente**: nota-base e coluna de fonte viva passam por
`conferirReferencias` (`apps/api/src/modules/assistente/agentes.service.ts:429`), a coluna pela
cadeia inteira no `where` (`:445`, INV-03); o `agentId` da conversa nova, por
`conversas.service.ts:111-116`. Três estreitamentos deliberados, que parecem furo:

- **no PATCH só a referência nova é conferida** (`agentes.service.ts:434`, `:440-442`; o gravado vem
  de `atualizar`, `:664-674`) — reconferir o gravado deixaria o agente ineditável quando uma coluna some depois de
  salvo, e o 404 nem diria qual;
- **a prévia confere só as notas-base** (`agentes.service.ts:744`): coluna alheia, inexistente ou fora do quadro
  declarado vira bloco `indisponivel` **sem nada dela** (`fonteComoTexto`, `:203-236`), porque o
  editor precisa abrir para tirar a fonte quebrada;
- **`kanban.cardsDaColuna` (`kanban.service.ts:323`) resolve a posse pela cadeia, mas não confere o
  `boardId` declarado** — quem precisa compara `coluna.boardId` (`agentes.service.ts:213`).
  Chamador novo que esqueça lê coluna do próprio usuário sob outro quadro, sem erro.

A corrida também dá 404: agente excluído entre o `findFirst` e o `create` da conversa bate na FK,
e ela é traduzida pelo **nome** da constraint, não só pelo `P2003` (`conversas.service.ts:133-141`
— no Prisma 6 o nome está em `meta.constraint`). Coberto em `apps/api/tests/agentes.test.ts:354-511`
e `:964`.

**A Etapa E a levou à rotina** com a mesma forma — `conferirReferencias`
(`apps/api/src/modules/assistente/rotinas.service.ts:689`), só o que é novo no PATCH —, e um caso a
mais: a coluna das ideias usadas é reconferida quando ela **ou** o quadro da entrada mudam, porque a
regra é "do mesmo quadro" (INV-12). Coberto em `apps/api/tests/rotinas.test.ts:358` e `:447`. O
workspace da nota de saída entra do mesmo jeito, só quando novo (`rotinas.service.ts:717-729`,
`rotinas.test.ts:1935`), e `output_workspace_id` **não é FK de propósito**, como as colunas:
`SetNull` esconderia o workspace excluído, que precisa virar `problems`
(`apps/api/prisma/schema.prisma:795-797`).

## Integridade de dados

**INV-11 — Posições são contíguas, sempre.** `position` é reescrito como `0,1,2…` num único
`UPDATE … FROM (VALUES …)` dentro de transação: `renumerarCards`
(`apps/api/src/modules/kanban/kanban.service.ts:90`), `renumerarColunas` (`:100`) e
`renumerarFavoritos` (`apps/api/src/modules/links/links.service.ts`). Não existe empate nem buraco.
Posição fora do intervalo é **clampada**, não recusada.

**INV-12 — Card não atravessa board.** Mover para coluna de outro board é recusado com 422.

**INV-13 — Card arquivado sai da numeração.** Arquivar renumera os que ficam; desarquivar devolve ao
**fim** da mesma coluna. Arquivado não move, não aparece em busca, não conta em contador nem em prazo.

**INV-14 — Excluir coluna com cards exige destino.** Sem `moveCardsTo` nem `deleteCards`, a API
recusa com 409 `COLUNA_COM_CARDS` (`kanban.service.ts:450`). Cards movidos vão para o fim do destino
preservando a ordem relativa.

**INV-15 — Limite de WIP avisa e não bloqueia.** A API armazena `wipLimit` e **nunca o valida**. É
sinalização visual. Coberto por teste explícito em `apps/api/tests/kanban.test.ts`.

**INV-16 — Título é único por usuário, sem acento e sem caixa, só entre notas ativas.** Garantido
pelo índice parcial `note_title_unico_idx`
(`apps/api/prisma/migrations/20260814004639_notas_fase_1/migration.sql:24`) sobre
`lower(immutable_unaccent(title)) WHERE deleted_at IS NULL`. A lixeira pode conter título repetido —
e por isso restaurar pode falhar com 409.

**INV-17 — `note_link` é tabela derivada.** Nunca editada diretamente: é recalculada a partir dos
`[[…]]` do conteúdo. Renomear uma nota reescreve os `[[antigo]]` das que apontavam para ela, apenas
no padrão exato entre colchetes. **Por isso texto de terceiro gravado em nota planta vínculo — por
qualquer campo, não só o título.** `linkMarkdown`, da seção Fontes da saída de rotina, neutraliza o
título **e** a URL (`apps/api/src/modules/assistente/execucao.service.ts:871-887`, com o porquê;
`apps/api/tests/web.test.ts:1491`). Porta nova que grave texto da web em nota faz o mesmo com tudo.

**INV-18 — O recálculo de links é condicional, e isso tem consequência.** Só roda quando o conjunto
de alvos muda (`mesmosLinks`, `apps/api/src/modules/notes/notes.service.ts:217`). Por causa dessa
otimização, criar, renomear e restaurar precisam chamar `reconstruirEntradas` (`:202`) para religar
quem já apontava para aquele título — inclusive quando a nota-alvo nasce **depois** do `[[…]]`.

**INV-19 — Excluir nota desfaz dois vínculos; restaurar refaz um só.** O soft delete apaga os
`note_link` nos dois sentidos **e** zera o `noteId` dos cards. Restaurar
(`apps/api/src/modules/notes/notes.service.ts:401-403`) chama `recalcularLinks` e
`reconstruirEntradas`, então **os `[[…]]` voltam nos dois sentidos**; o `noteId` do card **não**
volta, e refazer é manual, um card por vez (RN-07). Não junte os dois numa frase só: juntar já
produziu uma afirmação errada na `description` de `trash_note`, que teve de ser corrigida.

**INV-20 — Tag órfã é apagada sozinha.** Toda operação que desassocia roda `limparTagsOrfas`. Tags
são sempre `trim().toLowerCase()`. Renomear tag para nome existente **funde** as duas, não dá erro.

**INV-21 — Excluir workspace apaga boards e cards, mas não notas.** FK de nota é `SET NULL`; a de
board é `CASCADE`. É por isso que `Workspace` carrega `boardCount` e `cardCount` — a confirmação
precisa dizer quanto se perde.

**INV-22 — Link duplicado devolve o existente, não erro.** Proteção contra clique duplo. A unicidade
é sobre a URL já normalizada. Só favoritos têm ordem manual; "ver depois" ordena por `createdAt desc`
e tentar mover dá 422.

---

## SQL e planner

**INV-31 — Duas armadilhas de planner no SQL.** `porSimilaridade`
(`apps/api/src/modules/notes/search.service.ts:303`) repete o termo inline de propósito: movê-lo para
um CTE faz o planner perder o índice (comentário em `:311`). E `left(content_md, N::int)` precisa do
cast porque o Prisma envia número como `bigint`.

**INV-32 — Listagem de notas nunca carrega o corpo inteiro.** O trecho é truncado **no banco** em 600
caracteres. Trazer `contentMd` para a lista multiplica o tráfego por página.

---

## A frente de IA

**INV-47 — O teto diário corta antes de qualquer conexão sair, e o que prova isso é o dublê vazio.**
`garantirTeto` (`apps/api/src/modules/assistente/custo.service.ts:124`) roda **antes** do `fetch`, com
uma estimativa arredondada para cima (`estimarCustoMicros`, `:62`); em `formatar.service.ts:123-125`
ele está acima do `pedirDoProvedor`. A ordem é a invariante inteira: conferir depois também devolve
402, e a chamada já foi paga. O que a sustenta é a asserção de que o dublê **não recebeu nada**
(`apps/api/tests/assistente.test.ts:809`, lista de requisições vazia): um teste que só confira o
status 402 não distingue os dois mundos. A mesma técnica prova que `saude` sem chave não abre
conexão nenhuma (`:175`, CA-02).

**"Qualquer conexão" é por passo, não por mensagem — a Etapa B mudou a unidade, e a Etapa E pôs a
conferência dentro do passo.** Uma mensagem do chat é até `MAX_PASSOS_DO_LACO = 5`
(`packages/shared/src/chat.ts:26`) chamadas ao provedor, e um passo de rotina é o mesmo laço. As
duas superfícies chamam `passoNoProvedor` (`apps/api/src/modules/assistente/passo.service.ts:169`),
e `garantirTeto` roda **dentro** dele, antes do `fetch`, em toda chamada (`:174-176`): a invariante
vale por construção para quem usa o passo, e superfície que abra o provedor por fora dele a perde.
O `garantirTeto` que o chat faz antes do laço (`chat.service.ts:248-252`) **não** é redundância: é o
402 de quem já estourou, com nada gravado nem transmitido; o de dentro existe porque o histórico
cresce a cada passo, e o passo 4 custa mais que o passo 1. Tirar a conferência de dentro do passo
é a mudança que parece limpeza e derruba **só** o teste do corte no meio
(`apps/api/tests/chat.test.ts:243`) — o do gasto por linha continua verde. O fim declarado do laço
é a segunda metade da mesma defesa: sem ele, modelo em ciclo (buscar, não achar, buscar de novo)
gasta um teto inteiro numa pergunta só (`chat.test.ts:198`).

**A rotina paga por passo e por execução (RN-17).** `tetoExtra` (`passo.service.ts:136-141`) roda
depois do diário e antes da conexão, com a mesma estimativa; a rotina o preenche com o gasto
acumulado da execução contra `runCapMicros` (`execucao.service.ts:1087-1096`). Recusa ali lança sem
linha de uso — nada foi chamado (`passo.service.ts:160-163`). O `garantirTeto` de `iniciar`
(`execucao.service.ts:508-524`) estima sem contexto, só para o 402 imediato; o corte de verdade é o
de cada chamada. Coberto em `apps/api/tests/rotinas.test.ts:835`.

**O que vai em todo passo entra na estimativa de todo passo.** Desde a Etapa D a mensagem `system`
é o contexto do agente — regras, instruções, notas-base e fontes vivas, até
`MAX_PREMISSAS_DO_AGENTE` —, montado a cada mensagem do chat (`chat.service.ts:193-199`) e a cada
passo de rotina (`execucao.service.ts:999-1003`), e posto em `mensagens` (`chat.service.ts:237-241`,
`execucao.service.ts:1037-1053`), que é o que `estimarPasso` conta (`passo.service.ts:61-67`).
Contexto repassado ao provedor por fora de `mensagens` sairia da estimativa e o teto deixaria
passar o passo que o estoura. A prévia do editor estima o mesmo passo com o mesmo
`MAX_SAIDA_TOKENS` (`custo.service.ts:24-27`).

**A busca na web entra na estimativa da chamada que a leva, e só dela (RN-25, Etapa G).**
`buscaNaWeb` vai só na primeira chamada de cada mensagem (`chat.service.ts:445`) e de cada passo
de rotina (`execucao.service.ts:1083`): as voltas do laço não buscam de novo, e cada busca é
cobrada. `estimarComBusca` (`custo.service.ts:81-92`) é a conta única — do passo (`estimarPasso`),
do 402 de `iniciar` e da prévia do agente, que tira a busca **por diferença** entre as duas
estimativas (`agentes.service.ts:768-774`) para que `costPerStepMicros + webSearchMicros` seja o
que o teto usa. Ela soma a tarifa **e** `CHARS_ESTIMADOS_DA_BUSCA` ao contexto
(`packages/shared/src/agentes.ts:84-98`): os resultados entram como tokens de entrada e, num
modelo caro, custam mais que a tarifa (`apps/api/tests/web.test.ts:1170`). A tarifa só vale com o
motor fixado — `engine: "exa"` em `PLUGIN_DA_BUSCA` (`passo.service.ts:76`). `buscaNaWeb` não tem
valor padrão em `estimarPasso` nem em `PedidoDoPasso` (`:61-67`, `:129-135`).

**INV-48 — A cascata de custo tem três degraus, o degrau escolhido é gravado, e o terceiro grava
zero.** `custoDaResposta` (`custo.service.ts:167`): `provedor` (o `cost` da resposta), `estimado`
(tokens × preço do catálogo) e `desconhecido` (nem custo nem token). Zero **não move o teto** — um
provedor que parasse de informar tornaria o teto decorativo em silêncio. Por isso `desconhecido` é
contado no dia (`resumoDoDia`, `:106`), que sai na tela como `callsWithoutCostToday`
(`packages/shared/src/ia.ts:153-156`), e no período do AI usage dash, com o degrau `estimado`
(`callsWithoutCost` e `estimatedMicros`, `apps/api/src/modules/assistente/uso.service.ts:233-234`).
Apagar a contagem, ou fundir os degraus num campo só, remove os sinais de que o teto parou de valer.

**A busca na web não cria degrau (Etapa G).** `comBusca` (`custo.service.ts:221-224`) soma a tarifa
só no `estimado`, que a conta por tokens não enxerga; `provedor` é tomado como já incluindo a busca
— somar contaria duas vezes —, e `desconhecido` fica zero: dar valor a ele o tiraria da contagem e
apagaria o sinal. É decisão **sem medição**, declarada com a receita de conferência (`:197-220`). A
chamada que falha grava zero e `desconhecido` mesmo que a busca tenha sido cobrada
(`passo.service.ts:218-238`): o gasto fica no painel do OpenRouter, fora do teto. Coberto em
`apps/api/tests/web.test.ts:1233`.

**INV-49 — A guarda de wikilink compara conjunto de alvos normalizados, não lista ordenada.**
`mesmosWikilinks` (`apps/api/src/modules/assistente/formatar.service.ts:78`) monta dois `Set` de
`normalizarTitulo` sobre `extrairWikilinks`. `note_link` é um conjunto (INV-17): ordem e repetição
não existem nela, e `[[Alpha]]` e `[[alpha]]` apontam para a mesma nota. Comparar por índice
recusaria uma formatação só por ela ter reagrupado itens — que é exatamente o que formatar faz — e a
chamada **já foi paga** quando esta função roda. Prompt é pedido; esta função é a garantia.

**INV-50 — `ai_usage.local_day` é gravado, não calculado na consulta.** A janela do teto é o dia do
**usuário**: `diaLocal(instante, fuso)` (`packages/shared/src/ia.ts:39`) com o fuso de
`ai_preference.timezone` (`apps/api/prisma/schema.prisma:445`), nunca `getDate()` do processo nem
`.slice(0, 10)` do ISO — a API roda em UTC na Railway e o operador não. `garantirTeto` devolve o
`localDay` que a linha de uso vai gravar (`custo.service.ts:129`), para que o dia do corte e o do
registro sejam o mesmo, ainda que a chamada atravesse a meia-noite. A coluna é `local_day`
(`schema.prisma:534`), com índice `(userId, localDay)` (`:552`). Trocar a gravação por um `WHERE`
sobre `createdAt` zera o teto três horas cedo, todo dia, sem erro nenhum. **A janela tem dois
leitores**, e os dois recortam por `localDay`: o teto (`resumoDoDia`, `custo.service.ts:105-106`) e
o AI usage dash (`uso.service.ts:93`, e o período anterior em `:140`), com portão em
`apps/api/tests/uso-ia.test.ts:107`. A tela mostra o dia gravado, não o recalculado
(`AiUsageCall.localDay`, `packages/shared/src/ia.ts:475-478`). Leitor novo entra nesta lista.

**INV-51 — `AiUsage.noteId` é `SetNull`.** `apps/api/prisma/schema.prisma:548`, como em
`Event.noteId`. Apagar a nota **não** apaga o registro de gasto: com `Cascade`, o teto diário viraria
contornável por exclusão de nota, e a trilha de auditoria sumiria junto com o que a explica. Coberto
em `apps/api/tests/assistente.test.ts:488`. O registro é escrito **inclusive quando a chamada falha**
(`custo.service.ts:246`), porque falhar também pode ter custado. `AiUsage.runId` segue a mesma regra
(`schema.prisma:550`): excluir a rotina não devolve o gasto do dia (`rotinas.test.ts:1340`).

**INV-52 — A fronteira do chat com o modelo é fechada pelo compilador, nos dois sentidos.** No
sentido de ida, `EXECUTORES` é `Record<NomeDoAssistente, Executor | undefined>`
(`apps/api/src/modules/assistente/ferramentas.service.ts:143`) — **não** um `Partial`, e o
`| undefined` é a invariante: as ações que o chat não faz estão lá escritas como `undefined`
(`:236-238`), e uma ação nova em `packages/shared/src/ferramentas.ts` — do acervo **ou** da web —
**não compila** sem alguém decidir. É a técnica do rótulo do INV-41: o tipo cobra a decisão em cada
sítio novo, em vez de deixar o padrão ser o permissivo. Desde a Etapa C o chat **cria**
(`create_card`, `create_note`) e não move, não apaga, não edita; desde a Etapa G um agente pode
**abrir página** (`open_page`, INV-08). São **três** condições para uma ação chegar ao modelo, e as
três valem também na **execução**:

1. `FERRAMENTAS_DO_CHAT` (`packages/shared/src/ferramentas.ts:391`), lista **explícita** — não
   "todas menos algumas", para que ação nova não entre no chat só por existir. É o **teto do que um
   agente pode ligar**, `open_page` inclusa, não o que toda conversa recebe;
2. `permitidas`, a lista da conversa (Etapa D): a do agente cortada pela primeira
   (`apps/api/src/modules/assistente/agentes.service.ts:281`), e **sem valor padrão**
   (`ContextoDeFerramenta`, `ferramentas.service.ts:83-105`). O Assistente sem agente passa
   `FERRAMENTAS_SEM_AGENTE` — o acervo, sem a web (`packages/shared/src/ferramentas.ts:404`) —
   **explicitamente** (`agentes.service.ts:274`): esquecer o campo é erro de compilação, não uma
   conversa que ganha tudo calada. Estreita, nunca amplia — nome gravado antes de a lista do chat
   mudar não entra;
3. `EXECUTORES[nome]`.

A definição de um nome da lista se lê por `DEFINICOES_DO_ASSISTENTE` (`packages/shared/src/ferramentas.ts:374`),
o mapa total das duas origens, e nunca por `FERRAMENTAS_DO_ACERVO[nome]` — que não tem `open_page`.
O servidor MCP fica fora da web só porque registra tool à mão (§4.6 de `contrato-compartilhado`).

`catalogoParaProvedor` confere as três (`ferramentas.service.ts:288-306`) e `executar` confere de novo
(`:326-331`): o catálogo diz o que se oferece, `executar` o que se executa, e sem a segunda
conferência um executor escrito para outra superfície ficaria executável por quem adivinhasse o
nome. Os quatro casos — nome desconhecido, fora do chat, fora do agente, sem executor — respondem
igual, "não existe" (`:310-313`). Trocar o tipo por `Partial`, a lista por um filtro de exclusão,
dar padrão a `permitidas` ou tirar a conferência de `executar` não quebra nada hoje e apaga uma
delas. Coberto por `apps/api/tests/agentes.test.ts:801` (CA-24: agente só de leitura não cria nem
se o modelo pedir) e, para a web, `apps/api/tests/web.test.ts:910` e `:929`. No sentido de volta,
`argumentos` chega `unknown` e passa por `conferir` (`ferramentas.service.ts:120-125`), que revalida
com o **mesmo** schema que o provedor recebeu: o modelo é terceiro que devolve JSON conforme um
schema que pode ignorar, e o `parse` também é o que aplica os padrões declarados. Cast no lugar do
`parse` compila.

**A rotina estreita mais uma vez, e pelo mesmo caminho (RN-16).** Um passo recebe só as ferramentas
**sem escrita** do agente: `ferramentasDaRotina` (`apps/api/src/modules/assistente/rotinas.service.ts:80-84`)
corta `FERRAMENTAS_DO_CHAT` pela lista do agente e tira as de `escrita` — `open_page` não escreve, e
fica —, e o resultado entra como `permitidas` — no catálogo (`execucao.service.ts:988-1004`) **e** no
`executar` (`:1145-1156`). Um `create_card` pedido pelo modelo cai no mesmo "não existe"; a escrita
da rotina é do código, na saída. Não passe a lista do agente inteira "porque o prompt diz que não
cria": RN-14. Coberto por `apps/api/tests/rotinas.test.ts:1406` e `:1442` (agente só de escrita sai
sem o campo `tools`).

**RN-13, a vizinha: as regras do Yu-book vêm antes do agente.** A mensagem `system` sai de
`instrucoesPara(ferramentas, buscaNaWeb)` (`agentes.service.ts:78`), não mais de um texto fixo no
chat: as regras que valem sempre — citar a origem, não tocar em `[[…]]`, não inventar, criar só a
pedido — abrem a mensagem, e as instruções do agente entram depois, como complemento. As linhas de
cada ferramenta só aparecem se ela está na lista: descrever ferramenta ausente convida o modelo a
fingir que a usou. O bloco da web (RN-24: citar o endereço, página é dado e não instrução, LinkedIn
nunca) só entra com `open_page` ou com a busca (`:131-152`, `web.test.ts:1299`). Prompt é pedido,
não garantia — a garantia de ação é a lista acima (RN-14); a ordem é coberta por
`agentes.test.ts:678`.

**INV-58 — A marca de conteúdo gerado é gravada só pelo servidor, e nunca some.** Os campos `ai*` de
`Note` e `Card` (Etapa C, §5.5 do PRD de IA) nascem na criação por `camposDaOrigem`
(`apps/api/src/lib/marca.ts:52`), e a origem chega ao service **por parâmetro**, nunca pelo corpo.
`OrigemIA` é **união discriminada por `via`** (`marca.ts:25-46`), não objeto de opcionais: o
compilador obriga o chat a gravar a conversa e a rotina a gravar a execução — com tudo opcional,
uma marca de chat sem `conversationId` compilava. O que o assistente monta é `OrigemDoAssistente`
(`:49`, `chat | rotina`), o tipo de `ContextoDeFerramenta.origem`:

- o `origin` do corpo só aceita `via: "mcp"` (`packages/shared/src/marca.ts:48-51`) — aceitar
  `chat` deixaria um cliente HTTP se passar pelo assistente, com `conversationId` alheio. O
  servidor MCP o manda em toda tool que cria (`origemDoCliente`, `apps/mcp/src/autor.ts:49`); tool
  nova que crie sem ele grava conteúdo de modelo como humano, e nada acusa;
- `updateNoteSchema` e `cardUpdateSchema` **omitem** `origin` (`packages/shared/src/notes.ts:42`,
  `kanban.ts:128`), e as rotas de criação o desestruturam antes do service
  (`notes.routes.ts:39`, `kanban.routes.ts:88`), porque `origin` não é coluna;
- o chat monta a origem a partir da conversa (`ContextoDeFerramenta.origem`,
  `ferramentas.service.ts:94`, montado em `chat.service.ts:539-544`, com o `agentName` da sessão
  desde a Etapa D), e "virar nota" tira corpo, modelo e conversa da `AiMessage` **gravada** — do
  cliente vêm só título, tipo e workspace (`conversas.service.ts:223-266`);
- a rotina monta a dela a partir da execução, no motor, para a saída — card **ou nota**, a mesma
  origem (`execucao.service.ts:1240-1250`): o autor é o modelo do último passo que **reescreveu**, e
  o `runId` gravado na saída é também o que deixa `fecharSemDono` achá-la (INV-60).

**Nunca some:** nenhuma rota a remove, e editar só preenche `aiRevisedAt` — "gerada · revisada",
não "deixou de ser gerada". Revisão é **mudança de fato** de título ou corpo na nota
(`notes.service.ts:305-307`) e de título ou descrição no card (`kanban.service.ts:576-586`): o
autosave e o painel reenviam campo inalterado, e mover, favoritar ou mudar tag não conta. Formatar
com IA grava pelo autosave e **conta** como revisão — aceito, é edição que o usuário iniciou.

A leitura tem duas fontes e a segunda é frágil: o `select` do Prisma usa `CAMPOS_DA_MARCA`
(`marca.ts:66`), e as consultas cruas da busca usam `marcaDe("n" | "c")`
(`apps/api/src/modules/notes/search.service.ts:28`) nas cinco consultas. O tipo de `$queryRaw` é
afirmação, não conferência: consulta nova sem `marcaDe` compila e devolve `ai: null` para conteúdo
gerado — a marca some da busca, calada. Coberto por `apps/api/tests/marca-ia.test.ts`.

**INV-60 — O motor de rotina decide pelo banco, nunca pelo `Map`: no deploy a API tem duas
instâncias.** A execução roda destacada da requisição (RNF-11), e as vivas moram num `Map` de
processo (`apps/api/src/modules/assistente/execucao.service.ts:143`). A Railway sobe a instância
nova **antes** do SIGTERM na velha, e na janela as duas convivem sem se enxergar (`execucao.service.ts:64-73`): "a API
é instância única" é falso justo quando importa. Cada cláusula fecha um caminho em que uma
instância pisaria na execução da outra, e todas parecem simplificáveis. O porquê de cada uma está
no comentário do sítio; aqui fica o mapa (as linhas sem arquivo são de `execucao.service.ts`):

- **Morte só pelo pulso.** `fecharSemDono` (`execucao.service.ts:265-320`) fecha só o que tem `heartbeatAt` vencido
  há 45 s (`:115`), e **reaplica o `where` na escrita** (`:290`). Fechar por "não está no meu
  `Map`" mata a execução viva da vizinha (`apps/api/tests/rotinas.test.ts:1000`).
- **Toda gravação do motor é condicional a `em_andamento`**; `count` zero chama `perder()`
  (`execucao.service.ts:964-968`), que larga a execução sem sobrescrever o desfecho alheio (`rotinas.test.ts:1504`).
- **`conferir()` imediatamente antes de criar a saída, sem `await` entre os dois**: antes de
  `criarCard` (`execucao.service.ts:1254-1255`) e antes de **cada tentativa de título** da nota (`criarNotaDeSaida`,
  `:839-861`) — a tentativa que colidiu não criou nada. É o último ponto em que cancelar deixa a
  ideia intacta.
- **A saída criada ganha de `interrompida`** (RN-16) — a **única** gravação sobre estado terminal
  alheio (`execucao.service.ts:1288-1308`), e só com `outputCardId` **e** `outputNoteId` nulos (`:1294-1298`).
  `fecharSemDono` acha a saída também pela marca — `card.aiRunId` ou `note.aiRunId`, a nota
  inclusive na lixeira (`:268-285`) —, e a execução que já a criou fecha `concluida`, nunca reabre
  a ideia (`rotinas.test.ts:1040`, `:2083`).
- **`encerrando = true` antes da gravação terminal** (`execucao.service.ts:933-935`, `:1342`, `:1352`): o pulso em voo
  não reescreve o motivo que a nossa gravação decidiu.
- **Cancelar vai ao banco** (`cancelRequestedAt`, `execucao.service.ts:1670-1697`), lido no pulso e antes de cada
  passo e volta (`rotinas.test.ts:1547`).
- **SSE.** A inscrição é a primeira linha do gerador (`execucao.service.ts:1489-1490`) — gerador descartado sem
  começar não roda `finally`, e um assinante inscrito fora acumularia deltas até o fim
  (`rotinas.test.ts:1197`) —, com a conferência `vivas.get(runId) !== viva && fila.length === 0`
  depois (`execucao.service.ts:1497`). `dobrar` (`:1570-1616`): evento que muda passo **nunca** segue depois do
  retrato, porque a tela o reaplicaria por cima. Execução da vizinha sai por `remota` (`:1627`),
  retratos do banco sem deltas (`rotinas.test.ts:1463`).

No SIGTERM as vivas são gravadas `interrompida` antes de `app.close()` (`apps/api/src/index.ts:37-51`);
a que morre sem SIGTERM para de pulsar, e a varredura de boot e de minuto a fecha (`index.ts:22-32`).

**A agenda (Etapa F) roda nas duas instâncias ao mesmo tempo, e o banco escolhe quem atende o
horário.** O relógio de 1 minuto (`apps/api/src/modules/assistente/agendador.service.ts:306-328`)
não tem dono; a exclusão é toda de escrita:

- **Cada horário tem uma linha só**, pelo `@@unique([routineId, scheduledFor])`
  (`apps/api/prisma/schema.prisma:906`) — é ele que garante RN-20
  (`apps/api/tests/agenda.test.ts:356`). A execução manual tem `scheduledFor` nulo e a rotina
  excluída põe `routineId` nulo (`SetNull`), e nulo não colide.
- **A linha `pulada` é o estado do horário enquanto ele não roda.** A recusa grava ou soma
  `attempts` (`agendador.service.ts:88-144`), e a tentativa seguinte a converte em execução
  (`execucao.service.ts:590-612`) — as duas escritas condicionais a `status: pulada` **e** ao
  `attempts` que a tentativa viu; quem escreve primeiro leva, a outra vê zero (`tomada`,
  `agenda.test.ts:378`).
  **Nenhum caminho do motor grava `pulada`**: execução que começou nunca volta a ser tentativa, e é
  isso que impede a agenda de cobrar duas vezes (RN-21, `agenda.test.ts:602`).
- **A agenda não passa pelo `Set iniciando`** (`execucao.service.ts:486-490`). A recusa por ele
  viria de um início ainda sem linha; gravada como `pulada`, tomaria o horário do outro pelo único,
  e nenhum dos dois rodaria. RN-19 continua pelo índice parcial (INV-04).
- **No SIGTERM, `pararAgenda()` é aguardado antes de `encerrarExecucoes`**
  (`apps/api/src/index.ts:42`): uma volta em curso que começasse execução depois da lista das vivas
  escaparia do `interrompida`.
- **Uma rotina com defeito não derruba a volta** — `try` por rotina e por horário
  (`agendador.service.ts:189-219`, `agenda.test.ts:811`).
- **A janela de 15 minutos só atende horário sem linha se `slot >= rotina.updatedAt`**
  (`pendentesDaRotina`, `agendador.service.ts:282`): sem isso, ligar, retomar ou pôr um horário
  vencido há pouco dispararia na hora uma execução que ninguém pediu. Por isso o PATCH grava
  `updatedAt` explícito (`apps/api/src/modules/assistente/rotinas.service.ts:951`), e **o motor e a
  `pulada` não escrevem em `ai_routine`** — escrita ali pularia o horário seguinte
  (`agenda.test.ts:772`).

**INV-61 — As chaves do OpenRouter não saem do servidor, e a de gerenciamento só lê, por caminhos
fixos.** A `OPENROUTER_MANAGEMENT_KEY` (Dashboard OpenRouter, 2026-09-25) **cria e apaga chaves** no
provedor. Toda leitura dela deságua em `pedirComGestao`
(`apps/api/src/modules/assistente/openrouter-painel.service.ts:100-113`), que aceita uma chave de
`CAMINHOS_DE_GESTAO` (`:51-57`) — o `POST /analytics/query` é consulta; hoje a leitura é
`chaveDeGestao` (`:88-90`), privada ao módulo. Grepe a variável antes de fechar diff que a toque. **O compilador guarda `pedirComGestao`, não a chave:**
`pedirDoProvedor` com ela noutro lugar aceita qualquer caminho, e os testes só veem as rotas que
existem (`apps/api/tests/openrouter-painel.test.ts:612`, `:630`). Caminho novo com ela é decisão do
operador; `/keys`, nunca. A saída das duas chaves para o navegador:

- **Rótulo `sk-…` redigido só por `rotuloPublico`** (`openrouter.service.ts:79-82`) — o padrão do
  provedor é o prefixo da chave. `saude()` e o painel passam por ela (`assistente.service.ts:46`,
  `openrouter-painel.service.ts:184`); leitura nova de `label` também.
- **Campo a campo**: `paraChave` (`openrouter-painel.service.ts:176-206`) não copia
  identificador de conta. Espalhar o `data` do provedor na resposta desfaz isso calado.
- **401/403 sem o texto do provedor** (`openrouter.service.ts:180-188`), que ecoa a credencial:
  `nomeDaChave` e `dicaSeRecusada` são texto nosso (`openrouter-painel.test.ts:647`).

## Servidor MCP

**INV-40 — `formatarQuadro` imprime o id de cada coluna, e é o único lugar que imprime.**
`packages/shared/src/formato.ts:275` — o arquivo **mudou de pacote** na Etapa B (era
`apps/mcp/src/formato.ts`), e a mesma função agora serve duas superfícies: as tools e resources do
MCP e o executor `get_board` do chat (`apps/api/src/modules/assistente/ferramentas.service.ts:178`).
`create_card` e `move_card` endereçam por `columnId`, e nenhuma outra saída expõe esse id — as
`description` das duas mandam chamar `get_board` justamente por isso. Custa 36 caracteres por
coluna, com teto de 20 colunas por quadro (~1 KB no pior caso), e é o primeiro candidato a
"economia de contexto" de quem lê `formato.ts` sem abrir `tools/kanban-escrita.ts`. Remover
deixa as duas tools de escrita **inalcançáveis** e as descrições mentindo.

**Passou a ter portão em 2026-09-23**, depois de nascer sem nenhum:
`apps/mcp/tests/fuso.test.ts:112` chama `get_board` com o `fetch` dublado e executa `formatarQuadro`
de verdade, asserindo o `  id:` da coluna. O portão entrou de carona num teste de fuso — então ele
é frágil por procedência: quem reescrever aquele teste tire a asserção do `id` de lá antes, ou a
invariante volta a não ter quem a defenda.

**INV-41 — Envelope cifrado carrega rótulo de tipo, e o rótulo é obrigatório nas duas pontas.**
`selar(dados, tipo)` e `abrir(envelope, tipo)` (`apps/mcp/src/auth/segredos.ts:68` e `:85`) exigem
um `TipoDeEnvelope` (`:59`), e `abrir` devolve `null` quando o rótulo não bate (`:100`). Parece
cerimônia removível — todos os envelopes usam a mesma chave, então todos se abrem de qualquer
jeito. **Era exatamente esse o buraco:** sem rótulo, o que separava um envelope de outro era só a
*forma* do conteúdo, e `Codigo` é superconjunto estrutural de `Refresh`. Um código de autorização
apresentado em `grant_type=refresh_token` abria como refresh válido e devolvia token com escopo de
escrita, contornando de uma vez o uso único, o `exp` de 60 s e o PKCE. Confirmado contra o servidor
de pé, antes e depois. O parâmetro é obrigatório para o compilador cobrar a decisão em cada sítio
novo, em vez de deixar o padrão ser o inseguro.

**INV-42 — A vida do token do MCP é derivada do vencimento do token da API, nunca fixada.**
`emitirTokens` calcula `apiExp − MARGEM_S` (`apps/mcp/src/auth/provedor.ts:225`, com `MARGEM_S = 60`
em `:59`) e recusa abaixo de `PISO_S = 120` (`:69`). **Igualar os dois TTLs em 900 s não resolve**:
o token da API nasce no login e o do MCP na troca do código, até 60 s depois, então com a mesma
duração o do MCP morre por último — e aí o 401 cai **dentro de uma tool**, onde o modelo tenta
contornar sozinho, em vez de cair na fronteira HTTP, onde o cliente sabe renovar. O tripwire está
em `verificarToken` (`apps/mcp/src/auth/segredos.ts:191`): a checagem `axp <= agora` é inalcançável
por construção e existe justamente para acusar quem trocar a derivação por um número fixo.

**INV-43 — A identidade de quem chamou anda em `AsyncLocalStorage`, não num portador de sessão.**
O contexto é aberto em `comErro`/`comErroDeResource` a partir de `extra.authInfo`
(`apps/mcp/src/erros.ts:75`) e lido em `credencialDaChamada` (`apps/mcp/src/cliente.ts:102`, sobre o
store de `:42`). **Guardar o token na sessão MCP quebra em silêncio:** a sessão vive 30 min e o
token 14, e duas requisições concorrentes da mesma sessão sobrescreveriam o portador uma da outra —
uma chamada operando como outra conta, sem erro. `apps/mcp/tests/identidade.test.ts` falha se
alguém trocar de volta. A variável de módulo `accessToken` (`cliente.ts:53`) continua existindo e é
alcançável **só pelo ramo stdio**: sob HTTP, chamada sem contexto é recusada com `SEM_IDENTIDADE`
(`cliente.ts:106`), e o retry de 401 está guardado pela ausência de store (`cliente.ts:166`).

**INV-44 — O par sessão/`McpServer` vaza em silêncio, e são cinco guardas, não uma.**
`apps/mcp/src/http.ts`. Cada sessão tem seu próprio `McpServer`, porque um servidor conecta a **um**
transporte. **Sessão que entra e nunca sai não dá erro nem log**: só ocupa memória até o processo
morrer semanas depois, com um sintoma que não aponta para cá. Daí a redundância, e nenhuma das
cinco é supérflua.

Para o par que **entrou** no mapa, `esquecer` (`:71`) é o único lugar que o tira e fecha o servidor
junto — três caminhos chegam nele: `onclose` (`:154`), que cobre só o `DELETE` (verificado no SDK
1.30, `close()` do transporte não é chamado em mais nada), `varrerOciosas` (`:93`) para o cliente
que some da rede, e `abrirEspaco` (`:105`) como teto duro.

Para o par que **nasce e nunca é mapeado** — invisível a todas as três acima —, duas guardas
irmãs: `mcp-session-id` desconhecido é recusado com 404 **antes** de qualquer construção (`:263`), e
o `finally` de `novaSessao` fecha o par quando `registrada` continua falso (`:174`), que é o caso do
`initialize` recusado pelo SDK e o do corpo malformado. Sem elas, um cliente com defeito vazaria um
par por tentativa, sem erro e sem log — e qualquer um pode repetir um id velho.

**INV-45 — A trava de escrita tem duas camadas, e a de baixo não é `return true` no stdio.**
`podeEscrever` (`apps/mcp/src/autorizacao.ts:56`) roda dentro de `comErroDeEscrita`
(`apps/mcp/src/erros.ts:134`), no ponto da chamada, depois de o registro condicional já ter decidido
a superfície. Parece redundante — se a tool não está no `tools/list`, quem a chamaria? **Quem a
chamaria é o defeito que esta camada existe para conter:** uma tool de escrita declarada no módulo
de leitura fica registrada **sempre**, para um token só de leitura e contra a API de produção, e
nada reclama — nem o compilador, nem o typecheck, nem a execução. Por isso o ramo stdio pergunta se
a API é local (`env.escritaLiberada`) em vez de liberar: assim a tool mal registrada continua
recusando contra API remota, que é o desastre que `YUBOOK_ESCRITA_REMOTA` existe para evitar.
Coberta por `apps/mcp/tests/escrita.test.ts`, que **deriva** o conjunto de escrita da diferença
entre dois `tools/list` em vez de listá-lo à mão.

**INV-46 — Escopo que muda com a sessão viva encerra a sessão, e o encerramento é simétrico.**
`apps/mcp/src/http.ts:300`: se `escritaPermitida` do token atual diverge do `escrita` com que a
sessão foi montada, o par é fechado e a resposta é 404. **O furo é real, não hipotético:**
`exchangeRefreshToken` (`apps/mcp/src/auth/provedor.ts:367`) aceita `scope` e filtra o concedido,
então um cliente renova pedindo só leitura e segue no mesmo `mcp-session-id` com as dez tools
anunciadas. Ganhar o escopo encerra tanto quanto perder, de propósito: o catálogo que o modelo vê
nunca anuncia tool que vai recusar nem esconde tool que já pode usar. Quem garante que a escrita não
acontece nesse intervalo é INV-45; esta invariante garante que a **superfície** não mente.
