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
servidor abre conexão para fora em **três** lugares, divididos em duas classes. O eixo está escrito
em `apps/api/src/modules/assistente/openrouter.service.ts:5-11`.

*Alvo vindo do usuário* — só `apps/api/src/modules/links/titulo.service.ts`, que lê o título de uma
URL colada. É a única superfície de SSRF, e paga por isso: orçamento total de 2000 ms (`:14`),
máximo de 512 KB e só HTML (`:15`), máximo de 3 saltos (`:16`), `destinoPermitido` (`:74`) exigindo
que **todos** os registros A/AAAA sejam públicos, e `redirect: "manual"` (`:175`) com revalidação do
IP a cada salto (`:170`) — redirecionar para 127.0.0.1 é recusado como se fosse o alvo original.
Falhar aqui **nunca** impede o link de ser salvo.

*Alvo vindo do ambiente* — `links/youtube.service.ts:14-15` (oEmbed e Data API) e
`assistente/openrouter.service.ts:74` (base em `OPENROUTER_BASE_URL`, caminho literal do nosso
código). Nenhuma parte da URL é escolhida por quem chama: **não há superfície de SSRF**, e por isso
nada passa por `destinoPermitido`. O texto que o usuário digita para filtrar o catálogo de modelos é
aplicado **depois, em memória** (`assistente/modelos.service.ts:116`), nunca concatenado na URL — é
essa linha que mantém o ponto nesta classe. Aqui falhar **sobe** com código estável, em vez de virar
`null`: o usuário clicou num botão e precisa saber que não aconteceu.

**Ponto de saída novo se classifica antes de ser escrito.** Se qualquer pedaço da URL — host,
caminho ou parâmetro que o alvo transforme em host — vier do usuário, ele cai inteiro na primeira
classe; não existe meia defesa. Contar pontos de saída nunca foi a invariante, e a contagem já
esteve errada aqui.

**INV-10 — Destaque de busca usa caracteres de controle, não HTML.** `HL_START` e `HL_END` são
os caracteres de controle `U+0001` e `U+0002` (`packages/shared/src/busca.ts:10-11`), para que
nenhuma nota consiga forjar marcação. O front nunca renderiza HTML de resultado de busca.

**INV-59 — Id de entidade relacionada vindo do cliente é conferido contra o usuário; a FK só
garante que existe.** `conferirWorkspace` (`apps/api/src/modules/notes/notes.service.ts:115`) roda
na criação e na edição de nota (`:232`, `:311`), como `criarBoard` já fazia
(`kanban.service.ts:209-214`). Antes dela, o `workspaceId` de outra conta era aceito e a resposta
devolvia o nome do workspace alheio; o inexistente caía em violação de FK, distinguível do alheio.
Os dois dão o mesmo 404 (INV-02). Com o chat criando nota, o id chega também dos argumentos que o
**modelo** escreveu. Porta nova que grave nota — ou qualquer FK vinda de fora — confere a posse.
Coberto em `apps/api/tests/marca-ia.test.ts:522`.

**A Etapa D levou a regra ao agente**: nota-base e coluna de fonte viva passam por
`conferirReferencias` (`apps/api/src/modules/assistente/agentes.service.ts:383`), a coluna pela
cadeia inteira no `where` (`:399`, INV-03); o `agentId` da conversa nova, por
`conversas.service.ts:111-116`. Três estreitamentos deliberados, que parecem furo:

- **no PATCH só a referência nova é conferida** (`:388`, `:394-396`; o gravado vem de `atualizar`,
  `:614-624`) — reconferir o gravado deixaria o agente ineditável quando uma coluna some depois de
  salvo, e o 404 nem diria qual;
- **a prévia confere só as notas-base** (`:693`): coluna alheia, inexistente ou fora do quadro
  declarado vira bloco `indisponivel` **sem nada dela** (`fonteComoTexto`, `:161-194`), porque o
  editor precisa abrir para tirar a fonte quebrada;
- **`kanban.cardsDaColuna` (`kanban.service.ts:323`) resolve a posse pela cadeia, mas não confere o
  `boardId` declarado** — quem precisa compara `coluna.boardId` (`agentes.service.ts:171`).
  Chamador novo que esqueça lê coluna do próprio usuário sob outro quadro, sem erro.

A corrida também dá 404: agente excluído entre o `findFirst` e o `create` da conversa bate na FK,
e ela é traduzida pelo **nome** da constraint, não só pelo `P2003` (`conversas.service.ts:133-141`
— no Prisma 6 o nome está em `meta.constraint`). Coberto em `apps/api/tests/agentes.test.ts:354-511`
e `:964`.

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
no padrão exato entre colchetes.

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
(`apps/api/src/modules/notes/search.service.ts:300`) repete o termo inline de propósito: movê-lo para
um CTE faz o planner perder o índice (comentário em `:308`). E `left(content_md, N::int)` precisa do
cast porque o Prisma envia número como `bigint`.

**INV-32 — Listagem de notas nunca carrega o corpo inteiro.** O trecho é truncado **no banco** em 600
caracteres. Trazer `contentMd` para a lista multiplica o tráfego por página.

---

## A frente de IA

**INV-47 — O teto diário corta antes de qualquer conexão sair, e o que prova isso é o dublê vazio.**
`garantirTeto` (`apps/api/src/modules/assistente/custo.service.ts:99`) roda **antes** do `fetch`, com
uma estimativa arredondada para cima (`estimarCustoMicros`, `:57`); em `formatar.service.ts:123-125`
ele está acima do `pedirDoProvedor`. A ordem é a invariante inteira: conferir depois também devolve
402, e a chamada já foi paga. O que a sustenta é a asserção de que o dublê **não recebeu nada**
(`apps/api/tests/assistente.test.ts:809`, lista de requisições vazia): um teste que só confira o
status 402 não distingue os dois mundos. A mesma técnica prova que `saude` sem chave não abre
conexão nenhuma (`:175`, CA-02).

**"Qualquer conexão" é por passo, não por mensagem — a Etapa B mudou a unidade.** Uma mensagem do
chat é até `MAX_PASSOS_DO_LACO = 5` (`packages/shared/src/chat.ts:26`) chamadas ao provedor, e o
`garantirTeto` de dentro do laço (`chat.service.ts:463`) **não** é redundância do que roda antes
dele (`:276`): o histórico cresce a cada passo, então o passo 4 custa mais que o passo 1, e um teto
conferido uma vez pagaria os outros quatro sem olhar. Hoistar a conferência para fora do laço é a
mudança que parece limpeza e derruba **só** o teste do corte no meio
(`apps/api/tests/chat.test.ts:243`) — o do gasto por linha continua verde. O fim declarado do laço
é a segunda metade da mesma defesa: sem ele, modelo em ciclo (buscar, não achar, buscar de novo)
gasta um teto inteiro numa pergunta só (`chat.test.ts:198`). Quem acrescentar uma terceira
superfície de IA responde primeiro qual é a unidade que ela paga.

**O que vai em todo passo entra na estimativa de todo passo.** Desde a Etapa D a mensagem `system`
é o contexto do agente — regras, instruções, notas-base e fontes vivas, até
`MAX_PREMISSAS_DO_AGENTE` —, montado a cada mensagem e posto em `mensagens`
(`chat.service.ts:223-227`, `:265-269`), que é o que `estimarPasso` conta (`:310-311`). Contexto
repassado ao provedor por fora de `mensagens` sairia da estimativa e o teto deixaria passar o passo
que o estoura. A prévia do editor estima o mesmo passo com o mesmo `MAX_SAIDA_TOKENS`
(`custo.service.ts:19-22`).

**INV-48 — A cascata de custo tem três degraus, o degrau escolhido é gravado, e o terceiro grava
zero.** `custoDaResposta` (`custo.service.ts:142`): `provedor` (o `cost` da resposta), `estimado`
(tokens × preço do catálogo) e `desconhecido` (nem custo nem token). Zero **não move o teto** — um
provedor que parasse de informar tornaria o teto decorativo em silêncio. Por isso `desconhecido` é
contado (`resumoDoDia`, `:81`) e sai na tela como `callsWithoutCostToday`
(`packages/shared/src/ia.ts:153-156`). Apagar a contagem, ou fundir os degraus num campo só, remove
o único sinal de que o teto parou de valer.

**INV-49 — A guarda de wikilink compara conjunto de alvos normalizados, não lista ordenada.**
`mesmosWikilinks` (`apps/api/src/modules/assistente/formatar.service.ts:78`) monta dois `Set` de
`normalizarTitulo` sobre `extrairWikilinks`. `note_link` é um conjunto (INV-17): ordem e repetição
não existem nela, e `[[Alpha]]` e `[[alpha]]` apontam para a mesma nota. Comparar por índice
recusaria uma formatação só por ela ter reagrupado itens — que é exatamente o que formatar faz — e a
chamada **já foi paga** quando esta função roda. Prompt é pedido; esta função é a garantia.

**INV-50 — `ai_usage.local_day` é gravado, não calculado na consulta.** A janela do teto é o dia do
**usuário**: `diaLocal(instante, fuso)` (`packages/shared/src/ia.ts:39`) com o fuso de
`ai_preference.timezone` (`apps/api/prisma/schema.prisma:422`), nunca `getDate()` do processo nem
`.slice(0, 10)` do ISO — a API roda em UTC na Railway e o operador não. `garantirTeto` devolve o
`localDay` que a linha de uso vai gravar (`custo.service.ts:104`), para que o dia do corte e o do
registro sejam o mesmo, ainda que a chamada atravesse a meia-noite. A coluna é `local_day`
(`schema.prisma:507`), com índice `(userId, localDay)` (`:521`). Trocar a gravação por um `WHERE`
sobre `createdAt` zera o teto três horas cedo, todo dia, sem erro nenhum.

**INV-51 — `AiUsage.noteId` é `SetNull`.** `apps/api/prisma/schema.prisma:518`, como em
`Event.noteId`. Apagar a nota **não** apaga o registro de gasto: com `Cascade`, o teto diário viraria
contornável por exclusão de nota, e a trilha de auditoria sumiria junto com o que a explica. Coberto
em `apps/api/tests/assistente.test.ts:488`. O registro é escrito **inclusive quando a chamada falha**
(`custo.service.ts:188`), porque falhar também pode ter custado.

**INV-52 — A fronteira do chat com o modelo é fechada pelo compilador, nos dois sentidos.** No
sentido de ida, `EXECUTORES` é `Record<NomeDeFerramenta, Executor | undefined>`
(`apps/api/src/modules/assistente/ferramentas.service.ts:128`) — **não** um `Partial`, e o
`| undefined` é a invariante: as ações que o chat não faz estão lá escritas como `undefined`
(`:221-223`), e uma ação nova em `packages/shared/src/ferramentas.ts` **não compila** sem alguém
decidir. É a técnica do rótulo do INV-41: o tipo cobra a decisão em cada sítio novo, em vez de
deixar o padrão ser o permissivo. Desde a Etapa C o chat **cria** (`create_card`, `create_note`) e
não move, não apaga, não edita. São **três** condições para uma ação chegar ao modelo, e as três
valem também na **execução**:

1. `FERRAMENTAS_DO_CHAT` (`packages/shared/src/ferramentas.ts:330`), lista **explícita** — não
   "todas menos algumas", para que ação nova não entre no chat só por existir;
2. `permitidas`, a lista da conversa (Etapa D): a do agente cortada pela primeira, e **sem valor
   padrão** (`ContextoDeFerramenta`, `:81-89`). O Assistente sem agente passa a lista inteira
   **explicitamente** (`agentes.service.ts:230`): esquecer o campo é erro de compilação, não uma
   conversa que ganha tudo calada. Estreita, nunca amplia — nome de agente gravado antes de a lista
   do chat mudar não entra (`:248-250`);
3. `EXECUTORES[nome]`.

`catalogoParaProvedor` confere as três (`:250`) e `executar` confere de novo (`:283-286`): o
catálogo diz o que se oferece, `executar` o que se executa, e sem a segunda conferência um executor
escrito para outra superfície ficaria executável por quem adivinhasse o nome. Os quatro casos —
nome desconhecido, fora do chat, fora do agente, sem executor — respondem igual, "não existe"
(`:268-271`). Trocar o tipo por `Partial`, a lista por um filtro de exclusão, dar padrão a
`permitidas` ou tirar a conferência de `executar` não quebra nada hoje e apaga uma delas. Coberto
por `apps/api/tests/agentes.test.ts:801` (CA-24: agente só de leitura não cria nem se o modelo
pedir). No sentido de volta, `argumentos` chega `unknown` e passa por `conferir` (`:105-110`), que
revalida com o **mesmo** schema que o provedor recebeu: o modelo é terceiro que devolve JSON
conforme um schema que pode ignorar, e o `parse` também é o que aplica os padrões declarados. Cast
no lugar do `parse` compila.

**RN-13, a vizinha: as regras do Yu-book vêm antes do agente.** A mensagem `system` sai de
`instrucoesPara(ferramentas)` (`agentes.service.ts:68`), não mais de um texto fixo no chat: as
regras que valem sempre — citar a origem, não tocar em `[[…]]`, não inventar, criar só a pedido —
abrem a mensagem, e as instruções do agente entram depois, como complemento. As linhas de cada
ferramenta só aparecem se ela está na lista: descrever ferramenta ausente convida o modelo a fingir
que a usou. Prompt é pedido, não garantia — a garantia de ação é a lista acima (RN-14); a ordem é
coberta por `agentes.test.ts:678`.

**INV-58 — A marca de conteúdo gerado é gravada só pelo servidor, e nunca some.** Os campos `ai*` de
`Note` e `Card` (Etapa C, §5.5 do PRD de IA) nascem na criação por `camposDaOrigem`
(`apps/api/src/lib/marca.ts:28`), e a origem chega ao service **por parâmetro**, nunca pelo corpo:

- o `origin` do corpo só aceita `via: "mcp"` (`packages/shared/src/marca.ts:42-45`) — aceitar
  `chat` deixaria um cliente HTTP se passar pelo assistente, com `conversationId` alheio. O
  servidor MCP o manda em toda tool que cria (`origemDoCliente`, `apps/mcp/src/autor.ts:49`); tool
  nova que crie sem ele grava conteúdo de modelo como humano, e nada acusa;
- `updateNoteSchema` e `cardUpdateSchema` **omitem** `origin` (`packages/shared/src/notes.ts:42`,
  `kanban.ts:128`), e as rotas de criação o desestruturam antes do service
  (`notes.routes.ts:39`, `kanban.routes.ts:88`), porque `origin` não é coluna;
- o chat monta a origem a partir da conversa (`ContextoDeFerramenta.origem`,
  `ferramentas.service.ts:74`, montado em `chat.service.ts:589`, com o `agentName` da sessão desde a
  Etapa D), e "virar nota" tira corpo, modelo e conversa da `AiMessage` **gravada** — do cliente
  vêm só título, tipo e workspace (`conversas.service.ts:223-266`).

**Nunca some:** nenhuma rota a remove, e editar só preenche `aiRevisedAt` — "gerada · revisada",
não "deixou de ser gerada". Revisão é **mudança de fato** de título ou corpo na nota
(`notes.service.ts:305-307`) e de título ou descrição no card (`kanban.service.ts:576-586`): o
autosave e o painel reenviam campo inalterado, e mover, favoritar ou mudar tag não conta. Formatar
com IA grava pelo autosave e **conta** como revisão — aceito, é edição que o usuário iniciou.

A leitura tem duas fontes e a segunda é frágil: o `select` do Prisma usa `CAMPOS_DA_MARCA`
(`marca.ts:40`), e as consultas cruas da busca usam `marcaDe("n" | "c")`
(`apps/api/src/modules/notes/search.service.ts:28`) nas cinco consultas. O tipo de `$queryRaw` é
afirmação, não conferência: consulta nova sem `marcaDe` compila e devolve `ai: null` para conteúdo
gerado — a marca some da busca, calada. Coberto por `apps/api/tests/marca-ia.test.ts`.

## Servidor MCP

**INV-40 — `formatarQuadro` imprime o id de cada coluna, e é o único lugar que imprime.**
`packages/shared/src/formato.ts:294` — o arquivo **mudou de pacote** na Etapa B (era
`apps/mcp/src/formato.ts`), e a mesma função agora serve duas superfícies: as tools e resources do
MCP e o executor `get_board` do chat (`apps/api/src/modules/assistente/ferramentas.service.ts:163`).
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
