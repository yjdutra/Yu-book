# Histórico de contexto

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo. Aqui ficam as
**decisões** e os porquês; o que mudou fica em [`../CHANGELOG.md`](../CHANGELOG.md).

O que entra: decisão tomada e alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que não entra: relato de "o que
eu fiz hoje" sem decisão dentro.

---

## 2026-08-24 — Fase 5, Etapa B: o arraste do kanban, e o índice que não podia oscilar

Entregue a precisão do arraste. Só `apps/web` mudou; contrato, banco, API e MCP ficaram intactos.
Requisitos em [`prd-fase-5-refino.md`](prd-fase-5-refino.md) §5.3.

**O índice de inserção virou contagem geométrica, não "o ponto médio do card sob o cursor".** A
regra do ponto médio, que era a redação original de RF-18, oscila: inserir empurra o card que estava
sob o cursor, a metade dele cruza o ponteiro, e a conta se inverte no frame seguinte — com a mão
parada. O vizinho pulava sozinho. A contagem — quantos cards da coluna têm o ponto médio acima do
ponteiro, ignorando o arrastado — é idempotente por construção: inserir em `k` empurra só quem tem
índice `≥ k`, então recontar devolve `k` de novo. Não depende da altura do card arrastado nem de
onde ele foi pego. RF-18 foi reescrito no PRD com essa explicação, para que a redação antiga não
volte parecendo simplificação.

**`MeasuringStrategy.Always` foi descartado depois de verificado no `dist`, não deduzido.** RF-20
pedia. No `@dnd-kit/core` 6.3.1 instalado, `isDisabled()` devolve `false` tanto para `Always` quanto
para o default enquanto o arraste acontece — os dois são idênticos durante o gesto —, e a remedição
periódica depende de `frequency` **numérico**, que o default deixa como a string `"optimized"`. Quem
remede é o `SortableContext`, a cada mudança de `items`, e mover o card no estado local muda `items`
a cada `dragOver`. Trocar a estratégia só acrescentaria medição **fora** do arraste. RF-20 virou um
bloco de "já atendido, não implementar" no PRD, com o motivo escrito: sem isso, a próxima leitura do
requisito reintroduz a mudança e o custo volta sem que nada acuse.

**As estratégias de ordenação são assimétricas de propósito: desligadas nos cards, ligadas nas
colunas.** `verticalListSortingStrategy` deslocava o vizinho pela altura do card ativo em cima de um
DOM que já tinha sido reordenado pelo estado local — deslocamento duplo, e o `SortableContext`
religava os transforms justamente no primeiro frame em que a lista se repete, que é quando a mão
para para mirar. Nos cards, quem abre o vão é o DOM. Nas colunas não dá para desligar: ali os
`items` não mudam durante o gesto e o transform é o único mecanismo que existe. Padronizar os dois
lados quebra um deles, e a tentação de padronizar é real porque o código fica com dois
`SortableContext` visivelmente diferentes lado a lado. Virou RF-27 no PRD e INV-36 no catálogo de
invariantes.

**O card do vão some por opacidade e nunca por `visibility` ou `display`.** Ele é o elemento focado,
e é nele que o `KeyboardSensor` escuta. Escondê-lo de verdade tiraria o foco do documento e mataria
o arraste por teclado inteiro — e **nada acusaria**: `typecheck` passa, os testes da API passam, e
não existe teste de front neste projeto. Pela mesma razão o contorno tracejado é `outline` e não
`border`: borda mudaria o box e dispararia remedição da coluna no meio do gesto.

**O limiar do auto-scroll ficou assimétrico entre os eixos (`{x: 0.06, y: 0.22}`).** O default de
0,2 da largura cria uma faixa de ~280 px num board de 1400 px, e o dnd-kit para no **primeiro**
contêiner que consegue rolar: dentro dessa faixa, o board horizontal ganha sempre, e a primeira e a
última coluna nunca rolariam na vertical. Estreitar o eixo x devolve a rolagem vertical às colunas
das pontas sem tirar a horizontal do board. É a única mudança da etapa apoiada em **análise do
comportamento da biblioteca**, e não em observação do gesto — o que a torna a primeira candidata a
estar errada.

**Pendência, e é a que mais pesa: a verificação à mão do gesto não foi feita.** Nenhum portão
automático valida esta etapa. O que passou foi `pnpm typecheck` nos quatro pacotes, os 55 testes de
integração da API (rodados como regressão; nenhum novo, porque a API não mudou) e o build do front —
e nenhum deles observa um arraste. **CA-14 a CA-22 estão implementados e não verificados.** O
operador decidiu fechar assim mesmo para começar a Etapa C; o registro fica para que ninguém leia
"entregue" como "conferido". Dois pontos merecem destaque quando a conferência acontecer:

1. **Arrastar uma posição e parar a mão.** Nenhum vizinho pode pular. É o sintoma que motivou a
   etapa inteira e o que a contagem geométrica e as estratégias desligadas existem para eliminar —
   se ele sobrevive, a hipótese estava errada, não o ajuste.
2. **Rolagem vertical na primeira e na última coluna de um board largo**, com o board também
   rolando na horizontal. É a única mudança sem observação por trás.

O `curador` já rodou na mesma sessão: INV-35 (o índice geométrico e por que a regra do ponto médio
oscila) e INV-36 (a assimetria das estratégias de ordenação) entraram em `invariantes-yu-book`, e
INV-30 e INV-33 ganharam notas — o catálogo está em 272 de 300 linhas, perto do teto.

---

## 2026-08-24 — Fase 5, Etapa A: tag de card, e o eixo que faltava no quadro

Entregues as tags de card e a busca no cartão de tags da barra lateral. Requisitos em
[`prd-fase-5-refino.md`](prd-fase-5-refino.md), um PRD novo que cobre as três etapas da Fase 5.

**A Fase 5 deixou de ser o Google Calendar.** O PRD assume a numeração nova: refino do que já
existe é a Fase 5, e a agenda passa para a Fase 6. Não é reordenação por conveniência — o operador
decidiu que o Calendar é a prioridade mais baixa hoje, e a `PROPOSTA-inicial.md` já tratava a agenda
como conveniência, com condição de corte de meio dia. Só a Etapa A está entregue; B (arraste) e C
(copiar nota, editor ao vivo) não começaram.

**Revertemos o NO6 da Fase 2, de propósito.** O PRD do kanban dizia, com todas as letras, que
etiqueta era coisa de nota e que o card não teria a sua. O uso desmentiu: coluna e assunto são eixos
independentes, e sem o segundo o quadro só sabia agrupar por estágio — quem quisesse ver "tudo de
banco de dados" espalhado por três colunas não tinha como. Forçar isso no eixo que existia
significava criar coluna por assunto, que é justamente o que faz um kanban parar de dizer em que
ponto as coisas estão. Um não-objetivo revertido pelo uso é conhecimento adquirido, não erro
corrigido, e por isso está escrito no changelog em vez de apagado do PRD antigo.

**Tag de card é `text[]` na linha do card, sem tabela.** A tentação era reaproveitar a tabela `tag`,
que já existe para as notas. Ela tem cor, id próprio, unicidade por usuário e um `limparTagsOrfas`
que roda depois de cada desvínculo. Tag de card não quer nada disso: o escopo é um board, a
identidade é o próprio texto, não há renomeação e ela morre com o card. Reaproveitar a tabela
obrigaria `limparTagsOrfas` a varrer duas relações e daria catálogo global e cor a algo que não usa
nenhum dos dois — acoplando duas coisas que só coincidem no nome. O preço aceito é a assimetria:
duas noções de "tag" no projeto, com armazenamentos diferentes, e quem ler o schema pela primeira
vez vai estranhar. Está anotado no comentário do modelo `Card` por causa disso.

**O filtro do board é OU; o filtro de notas da barra lateral continua E.** Divergência deliberada
entre duas telas que parecem fazer a mesma coisa. No cartão de notas (RF-07 da Fase 1) o objetivo é
**estreitar** até achar uma nota específica, e cada tag adicionada corta mais. No board o objetivo é
o oposto: **agregar** assuntos espalhados por colunas diferentes. Com E, selecionar a segunda tag
esvaziaria o quadro quase sempre, já que poucos cards carregam duas etiquetas ao mesmo tempo — o
gesto pareceria quebrado. Se um dia isso confundir, a saída é rotular o modo na barra, não unificar
a semântica.

**RN-05 — com filtro ativo, o arraste é desligado, e isso é recusa e não limitação.** O índice de
destino do arraste é contado sobre a lista renderizada. Com o quadro recortado, "soltar na segunda
posição" significa a segunda posição *do recorte*, e o servidor renumera a coluna inteira em cima
desse número (RN-01 / INV-11): a ordem real embaralharia sem ninguém ver, que é exatamente a
corrupção silenciosa que a invariante existe para impedir. A alternativa seria traduzir o índice do
recorte para o da lista real — possível, mas é aritmética que só está certa enquanto ninguém mexe
na coleção durante o gesto, e errar ali não dá erro, dá ordem trocada. Vale para mouse **e**
teclado: `coluna.cards` continua sendo a verdade para contagem, WIP e posição; o filtro só decide o
que é pintado. O quadro filtrado diz por que o arraste não responde e oferece o botão de limpar.

**Nenhum endpoint novo.** O catálogo de tags de um board sai dos cards que o `GET /boards/:id` já
traz inteiros. Um `/boards/:id/tags` seria uma segunda fonte de verdade para a mesma informação, com
a chance de discordar da primeira num intervalo de cache. A consequência boa é que a última
desmarcação faz a tag sumir do catálogo sozinha — não há órfã para limpar, e é o que dispensa um
`limparTagsOrfas` do lado do card.

**O `ADD COLUMN` ficou sem `NOT NULL`, e foi mantido como o gerador escreveu.** É a convenção do
próprio Prisma para lista escalar: `String[]` não aceita nulo do lado do cliente, e o default
`ARRAY[]::TEXT[]` cobre as linhas existentes. Editar o SQL à mão para "melhorar" a migration
introduziria drift entre o arquivo e o que o Prisma espera, e `migrate deploy` roda no boot de
produção — drift ali derruba deploy. Regra que vale para a próxima: migration gerada não se edita
por estética.

**Dívida nova, do tipo que quebra em silêncio:** `normalizarTag` é chamada no front, antes de
mandar, e de novo na API, antes de gravar. A repetição é intencional — confiar no cliente aqui é
como confiar nele no `userId` —, mas se um dos dois lados deixar de chamar, `Banco` e `banco` viram
duas entradas no catálogo do board e nada acusa: `typecheck` passa, os testes passam, e o efeito só
aparece como duas etiquetas quase iguais na barra de filtro. Entra na lista de espelhamentos
frágeis, ao lado de `normalizarTitulo`/`immutable_unaccent` e de `moverNoBoard`/renumeração.

**Pendência.** A verificação à mão da interface — dois temas, navegação por teclado no seletor de
tags e na barra de filtro — **não foi feita**. O que passou foi `pnpm typecheck` nos quatro pacotes,
55 testes da API e o build do front; o formato do MCP foi conferido isoladamente. A propagação para
as skills que a §13 do PRD exige já foi feita pelo `curador` na mesma sessão: `normalizarTag` entrou
no catálogo de espelhamentos frágeis de `contrato-compartilhado`, e RN-05 e a assimetria entre as
duas noções de tag viraram INV-33 e INV-34 em `invariantes-yu-book`.

---

## 2026-08-24 — Cor dos agentes, e o enum que não aceita `gray`

Os nove agentes em `.claude/agents/` ganharam `color:` no frontmatter. É apresentação pura: a cor
identifica o agente na lista de tarefas e no transcript do Claude Code, e nada no Yu-book depende
dela.

**`gray` não existe, e falha calada.** `versionador` e `zelador` tinham sido postos em `color: gray`,
que o binário do Claude Code ignora em silêncio — não avisa, não recusa o agente, apenas não pinta.
O enum aceito tem oito valores e nenhum cinza:

```
red, blue, green, yellow, purple, orange, pink, cyan
```

Verificado no binário (`~/.local/share/claude/versions/…`), não deduzido: a lista está literal no
código e a validação é um `includes` — valor fora dela é descartado sem erro. `gray` e `grey` até
aparecem no binário, mas na tabela de cores de terminal, que é outra coisa; foi provavelmente daí
que veio a confiança de que serviriam. `versionador` foi para `cyan` e `zelador` para `yellow`.

**Não entra no `CHANGELOG.md`, e isso é decisão, não esquecimento.** A regra da casa é que o
changelog registra efeito observável para quem usa o Yu-book, e cor de subagente é ferramenta de
desenvolvimento. Há precedente em sentido contrário — a 0.3.0 cita o nascimento do agente `mcp` e o
passo novo no checklist do `revisor` —, mas os dois mudam o que o método de trabalho **faz**:
quem é dono de qual pacote, o que a revisão passa a pegar. Cor não muda nada; muda só o que se vê.
A linha fica aí: agente entra no changelog quando altera capacidade ou responsabilidade, não quando
altera aparência. Nenhum contrato mudou, nenhum pacote foi afetado, nenhuma versão foi bumpada.

**Dívida aceita: três verdes e dois azuis.** São nove agentes para oito cores, então uma colisão é
inevitável — três não são, e `pink` e `purple` seguem livres. As repetições também não seguem
critério: o verde cobre `backend`, `curador` e `revisor`, que não têm afinidade entre si. O operador
foi avisado e decidiu deixar como está por ora, já que o custo de confundir dois agentes no
transcript é baixo. Pendência de baixa prioridade: se atrapalhar na prática, gastar as duas cores
livres nos dois verdes sobrando, em vez de inventar um critério de agrupamento que hoje não existe.

---

## 2026-08-24 — MCP, Etapas 2 e 4: o agente `mcp` e o portão que estava vermelho

Fechadas as três primitivas do protocolo em `apps/mcp`. Requisitos em
[`old/prd-mcp-resources-e-prompts.md`](old/prd-mcp-resources-e-prompts.md).

**Nasceu o agente `mcp` por causa de um risco que nenhum portão pega.** `apps/mcp` era o único
pacote sem dono, mas não foi a lacuna organizacional que decidiu: foi o modo de falha. Campo novo
no domínio, entidade nova, filtro novo — nada disso **quebra** o servidor MCP. `pnpm typecheck`
passa, a suíte da API passa, e o servidor simplesmente continua expondo o mundo de ontem. O
precedente estava à mão: `updatedAt` existia na tabela `card` desde a Fase 2 e só chegou à face do
card agora, quando um prompt precisou dele. Uma falha silenciosa só se pega por procedimento, então
o agente ganhou um modo B — verificar propagação depois que o domínio muda — com a obrigação de
**declarar quando nada precisa mudar**, porque silêncio é indistinguível de esquecimento. E o
`revisor` passou a apontar a mesma verificação quando o diff toca `packages/shared/src`, para o caso
de ninguém chamar o agente.

**A skill do MCP foi escrita, não baixada.** Existe skill genérica de servidor MCP disponível, e ela
seria pior que nada aqui. Skill é prescritiva, e quase toda decisão nossa é o oposto do padrão que
uma skill genérica ensina: o servidor é cliente da API e não do banco, a resposta é texto compacto e
não JSON, `search_notes` não devolve corpo de nota, a identidade é uuid e não título, o esquema fica
em português. Uma skill genérica não teria dito nada disso e teria contradito parte. O que se
importa de fora é conhecimento do protocolo — que o SDK já traz na tipagem.

**Propriedade nova sem migration.** `CardSummary.updatedAt` e o `NoteTitle` com workspace saíram de
colunas que já existiam: o que faltava era a API expô-las. Virou regra do PRD (RF-25) — se uma
propriedade da superfície do MCP exigir coluna nova, ela não entra nessa etapa e vira pedido
separado. O servidor MCP não é motivo suficiente para mexer no modelo de dados.

**Estimativa não medida vira requisito.** O comentário de `titulos()` dizia "~40 bytes por nota".
Ninguém mediu, e o número é impossível: o uuid sozinho tem 36 caracteres. A medição real deu ~98 B.
O problema não foi o comentário errado — foi ele ter sido copiado para um RNF antes de alguém
conferir. O teto do catálogo passou a ser por **quantidade** de itens (200), que é o que se
consegue garantir sem medir de novo a cada mudança de campo.

**O único portão automático do projeto estava vermelho havia semanas.** A suíte de integração da API
acusou 15 falhas. Antes de atribuí-las ao trabalho da sessão, o trabalho foi guardado e a suíte
rodou contra o código original: **as mesmas 15 falhas**. A causa era `public.link` não existir no
banco local — as migrations de duas fases nunca tinham sido aplicadas ali. Depois de `db:deploy`,
47 de 47. Duas lições: rodar a suíte contra o código original antes de culpar o diff, e que um
portão que ninguém roda não é portão. Fica a pendência de rodar a suíte no começo da sessão, não no
fim, já que não existe CI para fazê-lo.

**`docs/` é documentação técnica do Yu-book.** O dossiê de casos foi para `docs/temp/`: é
matéria-prima para outro projeto gerar conteúdo, e material que descreve o projeto de fora não deve
concorrer com PRD e histórico na busca de quem procura como o Yu-book funciona.

---

## 2026-08-22 — Servidor MCP, Etapa 1, e o agente `publicador`

Primeira etapa do servidor MCP do Yu-book em `apps/mcp`: quatro tools de leitura sobre stdio.
Guia em [`temp/proposta- mcp-inicial.md`](temp/proposta-%20mcp-inicial.md).

**TypeScript em vez do Python das aulas.** O curso ensina com o SDK Python, mas em TS o servidor
importa `@yu-book/shared` e os schemas Zod das tools **são** os que a API já valida. Em Python
seriam reescritos em Pydantic — exatamente a segunda fonte de verdade que o projeto evita. O
Inspector da aula 04 existe em TS, então nada do material se perde.

**O servidor é cliente da API, não do banco.** Custa uma requisição a mais e herda de graça o
escopo por `userId`, a posse por cadeia e os códigos de erro estáveis. Importar o Prisma exigiria
reimplementar esse escopo fora dos services, e erro ali vaza dado entre contextos. Efeito colateral
bem-vindo: trocar entre local e produção virou trocar uma variável de ambiente.

**`search_notes` não devolve corpo de nota.** É o mesmo problema que `GET /notes` teve — o corpo de
50 notas custava 4,2 MB por página até truncarem no banco. Numa tool, quem paga a conta é a janela
de contexto do modelo. Ficou o par: `search_notes` acha, `get_note` lê. E a resposta é texto
compacto, não JSON: vinte resultados em JSON gastam um terço dos tokens em chaves repetidas.

**Login por credencial no `.env`, não fluxo de autorização.** O `fetch` do Node não guarda cookie e
o refresh token vive num cookie `httpOnly`; em vez de um cookie jar, o servidor entra de novo quando
o token de 15 min expira. É o primeiro item a mudar quando entrarem transporte HTTP e autenticação.

**O domínio de produção da API foi descoberto pelo bundle do front.** `VITE_API_URL` é substituído
em tempo de build, então o endereço da API fica dentro do JavaScript publicado. O domínio que
parecia ser o da API (`yu-bookweb-production`) era o do SPA — o `/health` dele devolve HTML.

**Novo agente `publicador`, e o PRD foi para a v0.2.** A separação em relação ao `versionador` é de
risco, não de assunto: um edita markdown, o outro publica em produção. Aqui `git push` para `master`
é deploy sem etapa de aprovação, e isso merece um agente com guarda própria — nunca dá push sem
pedido explícito no turno, e autorização para commitar não vale como autorização para publicar.

**Dívida descoberta e ainda aberta:** instalar `apps/mcp` somou 80 pacotes ao `pnpm-lock.yaml`, que
está nas Watch Paths da API **e** do web. Um push passa a reconstruir os dois serviços por causa de
um pacote que nenhum deles usa, e o `pnpm install` da raiz leva o SDK do MCP para dentro do build de
produção. Conserto candidato: filtrar o install no `buildCommand` do `apps/api/railway.json`.

---

## 2026-08-22 — Estrutura de agentes, skills e memória

Criada a estrutura `.claude/` do projeto: sete agentes, seis skills, memória persistente por agente
e `CLAUDE.md`. Requisitos em [`old/prd-agentes-e-skills.md`](old/prd-agentes-e-skills.md).

**Por que agentes especialistas e não um prompt genérico.** O repositório acumulou decisões que
parecem erro para quem não as conhece — 404 no lugar de 403 no kanban, o termo repetido inline em
`porSimilaridade`, a cirurgia de cache do autosave. Sem contexto, cada sessão arriscava "corrigir"
uma dessas. O custo não aparece como erro: aparece como regressão silenciosa de desempenho ou de
comportamento.

**A doutrina de curadoria foi a decisão central.** Quatro destinos mutuamente exclusivos, com um
teste cada: skill para o que é prescritivo e estável, memória para o que é descoberto e volátil,
`CLAUDE.md` para o mínimo sempre carregado, comentário no código para o porquê que pertence à linha.
Registro em dois destinos é duplicação, resolvida removendo do mais fraco. E memória contradita pelo
código é **removida**, não corrigida — assim nenhum registro carrega uma correção sem data.

**Limites duros em vez de bom senso.** Memória com 2 KB e 60 linhas, skill com 300 linhas,
`CLAUDE.md` com 60. Estourar obriga promover ou descartar; o limite não sobe. Era o risco mais
concreto do desenho — memória que vira depósito custa contexto em toda sessão e devolve pouco.

**O zelador foi redefinido.** Como faxineiro ele não teria trabalho: a varredura encontrou zero
`console.log` e zero `TODO`/`FIXME` no código-fonte. O trabalho real é outro — dívida declarada,
entidade modelada sem uso, constante duplicada. E veio com uma lista de exclusão do que **parece**
morto e não é, porque o risco de um agente de limpeza neste repositório não é deixar lixo, é remover
carga útil.

**Alternativa descartada: um agente de segurança dedicado.** SSRF, cadeia de tokens e escopo por
usuário já estão catalogados como invariantes e são cobrados pelo revisor, e existe o
`/code-review` nativo. Um oitavo agente dividiria a responsabilidade sem cobrir nada novo.

**Alternativa descartada: skill de migrations como agente próprio.** O SQL fora do Prisma é sutil —
`immutable_unaccent`, a configuração `pt_unaccent`, o trigger de `search_vector`, o índice único
parcial —, mas é território do backend e não tem contexto próprio suficiente. Virou skill.

**Achado durante o levantamento:** `Ctrl+K` tem duplo vínculo. O handler do editor
(`apps/web/src/components/Editor.tsx`) chama `preventDefault()` mas não `stopPropagation()`, e o
handler global está em `window` (`apps/web/src/components/Aplicacao.tsx:189`) — dentro do editor a
tecla insere `[](url)` **e** abre a paleta. `Atalhos.tsx` documenta `Ctrl+K` como sendo do editor,
então a intenção é clara. Não corrigido nesta sessão: está no relatório de dívida do zelador.

**Pendências que sobraram:** o que fazer com a tabela `company`, morta desde a migration inicial
(já era decisão pendente em `PROPOSTA.md`); se o zelador deve varrer `docs/` atrás de documentação
desatualizada — o `README.md` afirma cinco migrations e existem seis.

---

## 2026-08-20 — Redesenho da navegação

A coluna de navegação ganhou ícones próprios, seções recolhíveis e um cartão para as tags.

**Ícones desenhados à mão em vez de biblioteca.** São poucos, e um pacote traria centenas para usar
nove, com estilo que não é o da casa. Ficaram num arquivo só, grade 16×16, traço único e
`currentColor` para seguirem tema e estado do item sem condicional.

**A invariante da seção recolhível.** Uma seção fechada precisa continuar mostrando o que está
escondido: o filtro de tipo ativo aparece como ícone e rótulo no resumo, e o cartão de tags mostra
a contagem de tags selecionadas. Esconder o controle nunca pode esconder que o filtro continua
valendo — senão o usuário vê uma lista filtrada sem entender por quê.

Nenhum token de cor mudou. O redesenho ficou contido em quatro arquivos.

---

## 2026-08-14 — Fases 0 a 4

Entregues em sequência, sem release intermediário — daí a versão única `0.1.0` no changelog.
As decisões de escopo estão em [`old/PROPOSTA-inicial.md`](old/PROPOSTA-inicial.md) e os requisitos nos PRDs de fase.

**A decisão que sustenta o resto: uma entidade forte, não sete.** Uma `Note` com um campo `kind`, em
vez de tabelas separadas para aula, projeto, trilha e trabalho. É o que faz uma busca só atravessar
todos os contextos, e o que torna um tipo novo de nota uma linha no enum em vez de um CRUD novo.

**A agenda foi empurrada para o Google Calendar.** Construir uma segunda visão de calendário para
competir com uma que já fica aberta o dia inteiro seria trabalho puro-perda. O Yu-book cria o evento
lá e sai da frente. Com condição de corte declarada: se a integração custar mais de meio dia, a
Fase 5 inteira sai do escopo e `event` é removida do schema — não se constrói calendário próprio
como consolo.

**Sem favicon na gaveta de links, de propósito.** Guardar a imagem exigiria storage de objetos, e
buscá-la de um serviço de terceiros entregaria a ele a lista de tudo que se salva. A identidade
virou um bloco de cor derivada do domínio.

**O debounce do autosave continuou em 800 ms** mesmo durante a otimização de desempenho. O problema
nunca foi a frequência do salvamento, e sim o que cada salvamento arrastava junto — seis requisições
viraram uma sem tocar no intervalo. É requisito de PRD com critério de aceitação próprio (RF-14).

**O `PATCH` continuou devolvendo o corpo da nota.** Em nota muito grande isso dobra o tráfego do
autosave, mas a resposta completa é o que garante que o cache do front não divirja do banco. Dívida
consciente, reavaliável se as notas passarem de centenas de KB.

**Dívidas assumidas e ainda abertas:** a lixeira nunca expurga, embora a Fase 1 tenha prometido 30
dias; a tabela `company` segue morta no schema; não existe script de `pg_dump` nem export — o backup
da Railway protege contra *perder* os dados, não contra *querer sair*.
