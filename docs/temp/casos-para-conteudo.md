# Dossiê de casos — matéria-prima para conteúdo

**Origem:** projeto Yu-book (segundo cérebro pessoal) · **Período:** agosto de 2026
**Destino:** agentes de marketing e LinkedIn de outro projeto, que transformarão estes casos em posts.

> **Como usar este documento.** Cada caso é autocontido: contexto, tensão, o que foi feito, números
> verificados, a lição transferível e os ângulos possíveis. **Nada aqui é post pronto** — é a
> matéria-prima para construí-lo. A seção "O que não afirmar" de cada caso existe para evitar
> exagero: o material é forte o bastante sem inflar.

---

## Contexto do projeto (comum a todos os casos)

**Yu-book** é um segundo cérebro pessoal single-user: notas de aula, projetos e trabalho, com kanban
por workspace, gaveta de links e dashboard. Monorepo pnpm com três pacotes — API (Fastify 5 +
Prisma 6 + Postgres 16), web (React 19 + Vite 6 + Tailwind v4) e um pacote compartilhado de schemas
Zod. Está em produção na Railway. Autor solo.

Em agosto de 2026 o autor cursava a trilha de MCP (Model Context Protocol) da Claude Academy e
decidiu aplicar o aprendizado ao próprio projeto, em vez de fazer o exercício genérico do curso.

**Dois trabalhos aconteceram em sequência:**

1. **Estrutura de agentes e skills** — transformar o conhecimento tácito do repositório em
   infraestrutura de trabalho para agentes de IA (8 agentes, 6 skills, memória persistente curada).
2. **Servidor MCP** — transformar o Yu-book em um servidor MCP, expondo as três primitivas do
   protocolo. Duas etapas entregues e verificadas contra produção.

**Números do estado atual, todos verificados:**

| Métrica | Valor |
|---|---|
| Agentes especialistas | 8 |
| Skills de projeto | 6 |
| Servidor MCP | 999 linhas de TypeScript, 5 tools, 4 resources diretos, 2 resource templates, 2 prompts |
| Suíte de testes | 47 casos de integração, 5 suítes, 100% passando |
| Acervo real usado nos testes | 16 notas ativas, 3 na lixeira |
| Linters no projeto | zero — decisão deliberada |
| CI | não existe |

---

# TEMA A — Model Context Protocol

## Caso A1 — As três primitivas do MCP, e a pergunta que as separa

**Assunto:** fundamentos de MCP · **Público:** devs aprendendo MCP, arquitetos de IA
**Gancho candidato:** "A maioria dos tutoriais de MCP ensina uma das três primitivas — e é a fácil."

### O contexto
O protocolo MCP tem três primitivas: tools, resources e prompts. Praticamente todo tutorial cobre
tools e para por aí. O resultado é uma geração de devs que sabe escrever tool e não sabe explicar
por que resource existe.

### A tensão
A pergunta errada é "qual a diferença técnica entre tool e resource?" — as duas devolvem dados. A
pergunta certa é **quem aciona**.

| Primitiva | Quem aciona | Superfície no cliente |
|---|---|---|
| **Tool** | O modelo decide, no meio da resposta | invisível ao usuário |
| **Resource** | O usuário anexa, antes de perguntar | o menu do `@` |
| **Prompt** | O usuário invoca | o menu do `/` |

### A consequência prática
Uma tool gasta um turno do modelo buscando um dado que o usuário **já sabia** que queria. Perguntar
"o que tem na minha nota sobre JWT?" custa: o modelo decide, chama, espera, recebe, responde. Como
resource, o conteúdo entra no contexto **antes** da pergunta — e a resposta é imediata.

Não é otimização. É reconhecer que **quem já sabe o que quer não precisa que o modelo adivinhe**.

### A analogia que fecha o conceito de prompt
Prompt não é "instrução para o modelo". É um fluxo de trabalho pré-montado que o **usuário** dispara.
É o `/comando`.

O insight que destravou o entendimento no projeto: **prompt está para MCP como skill está para o
Claude Code**. Conhecimento de domínio empacotado em comando. Quem construiu skills já construiu a
ideia sem saber o nome.

### Por que um prompt se paga
O usuário consegue pedir "revise minha semana" sozinho — e recebe algo mediano, porque o modelo não
sabe que naquele app "prazo vencido" é a única coisa com urgência real, nem que a fila de links não
expira de propósito, nem em que ordem isso importa. Um prompt escrito e testado por quem conhece o
domínio embute esse recorte.

### A lição transferível
Ao desenhar qualquer integração de IA, a pergunta de partida não é "que dados eu exponho", é **"quem
inicia essa interação"**. A resposta muda a forma da API.

### O que não afirmar
- Não dizer que resource "substitui" tool. Eles cobrem casos diferentes e coexistem no projeto.
- Não dizer que o `@` e o `/` são obrigatórios do protocolo. São a apresentação que o cliente
  escolhe; o protocolo define as primitivas, não a UI.

---

## Caso A2 — "Listar não é listar conteúdo": o orçamento de contexto

**Assunto:** design de API para consumo por IA · **Público:** backend, arquitetos, devs de IA
**Gancho candidato:** "Meu endpoint de listagem já tinha resolvido esse problema. Eu só não tinha
percebido que era o mesmo problema."

### O contexto
Ao expor notas por MCP, a primeira tool foi `search_notes`. A pergunta imediata: o que ela devolve?

### A tensão
Devolver o corpo inteiro de 15 notas estoura a janela de contexto do modelo. Mas o projeto **já
tinha vivido isso** — numa camada diferente.

Meses antes, o endpoint REST `GET /notes` trazia o corpo inteiro de 50 notas para montar trechos de
160 caracteres. A correção foi truncar **no banco**, em 600 caracteres.

### Os números (verificados, documentados no README do projeto)
| | Antes | Depois |
|---|---|---|
| `GET /notes`, página de 50 notas de 100 KB | **4,2 MB** | **24 KB** |
| Autosave: requisições por pausa de digitação | 6 | 1 |
| Bundle inicial do front | 600 KB (185 KB gzip) | 525 KB (164 KB gzip) |

### O que foi feito no MCP
O mesmo princípio, com um degrau a mais:
- `search_notes` devolve **só trechos** — nunca corpo.
- `get_note` é a válvula de escape: devolve o corpo inteiro, de uma nota, **de propósito**.

**Buscar é barato. Ler é caro e explícito.**

Depois, ao expor notas como *resource*, o mesmo princípio virou regra de endereçamento:
- Resource **direto** (`yubook://notas`) devolve o catálogo: id, título, tipo. **Zero conteúdo.**
- Resource **template** (`yubook://nota/{id}`) devolve o corpo.

### A frase que sintetiza
**Listar não é listar conteúdo.** Um catálogo de 500 títulos custa ~20 KB. Quinhentos corpos custam
megabytes. A decisão difícil em design de resources não é *listar ou não* — é **listar o quê**.

### Detalhe técnico para credibilidade
A resposta das tools é **texto compacto, não JSON**. JSON de vinte resultados gasta cerca de um terço
dos tokens em chaves e aspas repetidas, sem dizer nada ao modelo.

### A lição transferível
Uma API consumida por IA tem o mesmo problema de orçamento que uma API consumida por rede — mas o
custo muda de dono. Na rede, quem paga é a banda. Com IA, **quem paga é a janela de contexto**, e ela
é muito menor e muito mais cara.

### O que não afirmar
- Os 4,2 MB → 24 KB são de uma otimização REST anterior ao MCP, não um resultado do MCP. Usar como
  precedente e analogia, nunca como resultado desta entrega.

---

## Caso A3 — O servidor MCP é cliente da própria API, não do banco

**Assunto:** arquitetura de integração · **Público:** arquitetos, tech leads
**Gancho candidato:** "A decisão mais importante do meu servidor MCP foi o que ele NÃO acessa."

### O contexto
Um servidor MCP precisa dos dados. Havia três caminhos: importar o Prisma direto, importar os
services da API, ou falar HTTP com a API já existente.

### A tensão
Importar o Prisma é mais rápido e tem menos peças. O problema é o que fica de fora.

A API do Yu-book carrega invariantes de segurança que não estão no banco:
- **Escopo por usuário** — nenhuma query aceita id de usuário vindo de fora; ele vem só do token.
- **Posse por cadeia** — as tabelas `card` e `board_column` **não têm coluna `user_id`**. A posse é
  resolvida na própria query, pela cadeia `card → coluna → quadro → dono`.
- **Id alheio devolve 404, não 403** — a existência de recurso de outra conta não é revelada.
- **Códigos de erro estáveis**, dos quais os clientes ramificam.

Acessar o Prisma direto significaria **reimplementar tudo isso** fora dos services. E erro nesse tipo
de código não dá exceção — vaza dado entre contextos, em silêncio.

### A decisão
O servidor MCP fala **HTTPS com a API**, como qualquer outro cliente. Custa uma requisição a mais e
herda todas as invariantes de graça.

### O efeito colateral que ninguém previu
Trocar entre ambiente local e produção virou **trocar uma variável de ambiente**. Nenhuma linha de
código. Quando o banco local estava vazio, apontar para produção foi uma edição de `.env`.

### A lição transferível
Ao expor um sistema para IA, a tentação é ir direto na fonte de dados, porque parece mais simples.
Mas **a camada de aplicação é onde moram as regras que protegem o dado**. Pular essa camada é
reescrever as regras — e reescrevê-las é onde os vazamentos acontecem.

Esta é a decisão que se transporta para qualquer outro projeto: o servidor MCP como *cliente da sua
própria API*, herdando autorização em vez de reimplementá-la.

### O que não afirmar
- Não dizer que acessar o banco direto é sempre errado. Para um sistema sem camada de autorização
  significativa, a conta pode dar diferente. O argumento é sobre **onde moram as regras**.

---

## Caso A4 — O schema é um contrato de conversa, não uma assinatura de função

**Assunto:** design de tools para IA · **Público:** devs de IA, product engineers
**Gancho candidato:** "Chamei minha tool com um id inválido. Meu código nunca rodou — e isso foi a
melhor coisa que aconteceu."

### O contexto
Ao testar o servidor MCP falando JSON-RPC direto no stdin, uma chamada de `get_note` recebeu
`"nao-e-uuid"` como argumento.

### O que aconteceu
O SDK **rejeitou antes do handler rodar**:
```
MCP error -32602: Input validation error: Invalid arguments for tool get_note: Invalid uuid at id
```

O código da tool nunca viu esse valor. O schema Zod foi a primeira — e única — linha de defesa
necessária.

### A lição imediata
Uma tool com schema frouxo empurra a validação para dentro da lógica de negócio, onde ela vira
tratamento de erro e mensagem confusa. Uma tool com schema apertado nunca deixa o valor ruim chegar.

### A lição maior: granularidade
O schema de uma tool **não é a assinatura de uma função**. É um **contrato de conversa com o modelo**,
e você está decidindo quanta corda dar:

- `move_card(id, coluna)` — clara, o modelo quase não erra, faz uma coisa só.
- `update_card(id, {qualquer campo})` — flexível, e o modelo erra mais, porque tem mais liberdade
  para inventar combinação inválida.

**Não há resposta certa.** É uma decisão de projeto que se paga ou se cobra em produção, e quase
nenhum tutorial força o dev a tomá-la.

### Detalhe técnico
Escrever o servidor em TypeScript (e não em Python, como o curso ensinava) permitiu que os schemas
Zod das tools fossem **os mesmos** que a API já usa para validar. Em Python seriam reescritos em
Pydantic — criando uma segunda fonte de verdade que divergiria silenciosamente.

### A lição transferível
Toda vez que você expõe uma função para um modelo, está desenhando quanto ele pode errar. O schema é
onde essa decisão é tomada.

### O que não afirmar
- Não apresentar "schema apertado é sempre melhor". O trade-off é real: tool granular demais exige
  mais chamadas encadeadas, e cada chamada é um turno.

---

## Caso A5 — Em stdio, o stdout é o protocolo

**Assunto:** armadilha prática de MCP · **Público:** devs implementando MCP
**Gancho candidato:** "Um `console.log` esquecido derruba seu servidor MCP com um erro que não parece
ter nada a ver com log."

### O contexto
O transporte mais comum de MCP é stdio: o cliente inicia o servidor como processo e conversa por
entrada e saída padrão.

### A armadilha
**O stdout É o canal do protocolo.** Um `console.log` esquecido injeta texto no meio de uma mensagem
JSON-RPC. O cliente desconecta com erro de parsing — e o dev vai procurar o bug em qualquer lugar
menos no log que ele mesmo deixou.

### O que foi feito
Todo diagnóstico do servidor vai para **stderr**, sem exceção. A regra virou comentário no topo do
arquivo principal.

Verificação automatizada: buscar `console.log` no código-fonte do pacote. **A única ocorrência é
dentro do comentário que proíbe usá-lo.** E o stdout do processo foi validado linha a linha — toda
linha é JSON-RPC válido.

### O detalhe que fecha a história
O projeto Yu-book já tinha **zero `console.log`** em todo o código-fonte antes disso, por convenção.
A disciplina que parecia preciosismo virou pré-requisito de um protocolo.

### A lição transferível
Convenções que parecem estéticas às vezes são infraestrutura esperando um caso de uso. Vale para
`console.log` como vale para naming, para tipagem estrita e para qualquer disciplina que "não faz
diferença hoje".

### O que não afirmar
- Isso vale para o transporte **stdio**. Em transporte HTTP o problema não existe. Não generalizar
  para "MCP não pode ter log".

---

## Caso A6 — O domínio da API estava dentro do bundle do front

**Assunto:** build-time vs runtime · **Público:** devs frontend, devops
**Gancho candidato:** "Precisava do domínio da minha API. Estava publicado no JavaScript do meu
próprio site — e isso não é vazamento, é como Vite funciona."

### O contexto
Era preciso apontar o servidor MCP para a API em produção. O domínio informado (`...web-production...`)
respondia — mas devolvia **HTML** no `/health`, não JSON.

### O diagnóstico
Aquele era o serviço do **front**, não o da API. São dois serviços separados na Railway, com domínios
diferentes. O `vite preview` serve o `index.html` para qualquer caminho, inclusive `/health` — daí a
resposta que parecia funcionar e não era.

### A solução
`VITE_API_URL` é substituída **em tempo de build**, não lida em runtime. Ou seja: o endereço da API
fica **dentro do JavaScript publicado**. Bastou baixar o bundle e procurar por `railway.app`.

Domínio da API encontrado em segundos. `/health` e `/health/db` confirmaram: `ok` e `up`.

### A lição dupla
1. **Toda variável `VITE_*` está no bundle.** Não é vazamento — é a definição de build-time. Mas
   significa que **nada secreto pode ter esse prefixo**, nunca.
2. **É o mesmo motivo** pelo qual trocar `VITE_API_URL` sem redeploy não muda nada — um erro comum e
   frustrante de diagnosticar.

### A lição transferível
Variável de build e variável de runtime são coisas diferentes com a mesma cara. Saber de qual tipo é
cada uma evita tanto um vazamento quanto uma tarde perdida.

### O que não afirmar
- Não sugerir que houve exposição indevida de segredo. Uma URL pública de API não é segredo, e o
  comportamento é o esperado do Vite.

---

## Caso A7 — A API em produção era mais velha que o contrato

**Assunto:** desacoplamento e ciclos de deploy · **Público:** arquitetos, tech leads
**Gancho candidato:** "Meu servidor MCP pediu um campo que meu próprio código já tinha. Não veio — e
a explicação é a melhor parte."

### O contexto
Para melhorar o catálogo de notas, foram adicionadas duas propriedades ao contrato compartilhado.
Tudo compilou. Os testes passaram. O catálogo continuou vindo sem os campos novos.

### O diagnóstico
O servidor MCP roda **localmente** e fala com a **API em produção**. A alteração do contrato existia
só na máquina do dev. Produção rodava o código anterior.

Não é bug. É **desacoplamento cobrando o preço** — e o preço é justo.

### O que foi feito
Em vez de tratar como transitório, virou requisito permanente do servidor: **tolerar uma API mais
velha que o contrato compilado**. Campo ausente na resposta é omitido, não emitido como `undefined`.

### A lição transferível
Quando dois componentes têm ciclos de deploy independentes, o contrato entre eles não é um acordo —
é uma **negociação contínua**. O consumidor precisa funcionar com a versão que encontrar, não com a
versão que espera.

Isso vale para: microserviços, apps móveis contra API (o usuário não atualiza), extensões de
navegador, SDKs distribuídos — e servidores MCP, que rodam na máquina do usuário e podem estar meses
atrás.

### O que não afirmar
- Não apresentar como falha de planejamento. É consequência estrutural de deploy independente, e
  reconhecê-la cedo é o resultado positivo do caso.

---

## Caso A8 — Como distribuir um servidor MCP, e por que transporte e autenticação são a mesma aula

**Assunto:** arquitetura e distribuição de MCP · **Público:** arquitetos, fundadores técnicos
**Gancho candidato:** "Meu servidor MCP funciona perfeitamente. Para outra pessoa usar, quase tudo
muda — e não é o código."

### O contexto
Pergunta natural depois que o servidor funciona: como outra pessoa usa isso?

### A premissa escondida do stdio
Em stdio, o cliente inicia **um processo por usuário**, na máquina dele. Isso tem uma consequência
que quase ninguém enuncia: **o processo já sabe quem é o usuário**. A identidade está no ambiente
local. Por isso a autenticação pôde ser uma credencial em arquivo — e ficou correta.

### Os três degraus da distribuição

| Degrau | O que resolve | O que não resolve |
|---|---|---|
| **Empacotar em npm** (`npx meu-servidor`) | Conveniência: ninguém clona repositório | Continua um processo por usuário, cada um com as próprias credenciais |
| **Servidor remoto por HTTP** | Um servidor, muitos clientes | **A identidade quebra**: o servidor não sabe mais quem está perguntando |
| **HTTP + autorização por usuário** | Multiusuário de verdade | — |

### O insight central
Com muitos usuários numa conexão, credencial em arquivo **deixa de funcionar** — o servidor agiria
como uma identidade só para todo mundo, e cada pessoa veria os dados de quem configurou o servidor.

**É por isso que transporte HTTP e autenticação são ensinados juntos.** Não é coincidência de
currículo: **mudar o transporte é o que cria o problema de identidade.**

### A aplicação prática
Para um produto multiusuário, você **nasce no terceiro degrau**. A decisão simples de credencial
local não se transporta. O que se transporta é a arquitetura — o servidor MCP como cliente da própria
API, herdando autorização (ver Caso A3).

### A lição transferível
Antes de escolher transporte, pergunte quantas identidades vão passar por ele. A resposta determina
o modelo de autenticação, e o modelo de autenticação é a parte cara.

---

# TEMA B — Agentes de IA e gestão de conhecimento

## Caso B1 — A doutrina de curadoria: quatro destinos, e só um por conhecimento

**Assunto:** gestão de conhecimento para agentes · **Público:** tech leads, devs usando IA
**Gancho candidato:** "Todo mundo fala em dar memória para agentes. Quase ninguém fala no que
acontece quando essa memória cresce."

### O contexto
Um repositório maduro carrega decisões que parecem erro para quem não as conhece. Exemplos reais do
projeto:
- Um id de outro usuário devolve **404, não 403** — de propósito.
- Uma função de busca **repete um termo inline**, porque movê-lo para um CTE faz o planner do
  Postgres perder o índice.
- Uma normalização de título no pacote compartilhado precisa **espelhar exatamente** a expressão de
  um índice do banco — e divergir não gera erro, gera link quebrado em silêncio.

Sem esse contexto, cada sessão de trabalho arrisca "corrigir" uma dessas.

### A tensão
A solução óbvia — dar memória persistente ao agente — cria o problema oposto: memória que cresce sem
controle custa contexto em toda sessão e passa a **contradizer o código**. E registro obsoleto é pior
que registro nenhum, porque é seguido com confiança.

### A doutrina construída
Todo conhecimento tem **um** destino, escolhido nesta ordem, com um teste cada:

| Destino | Natureza | Teste de decisão |
|---|---|---|
| **Skill** | Prescritivo e estável — *"como se faz aqui"* | Vale para qualquer tarefa futura desta área? |
| **Memória** | Descoberto e volátil — *"o que aprendemos, onde fica"* | Foi custoso descobrir e pode ser contradito amanhã? |
| **Contexto sempre carregado** | O mínimo indispensável | Um agente que ignore isso quebra o projeto na primeira ação? |
| **Comentário no código** | O porquê que pertence à linha | Some junto com o código se ele for removido? |

**Registro em dois destinos é duplicação**, e se resolve removendo do destino mais fraco.

### A regra mais contraintuitiva
**Expurgo, não correção.** Memória que o código já contradiz é **removida**, não corrigida. Se o fato
novo merece registro, entra como registro novo.

O motivo: assim a memória nunca carrega uma correção que ninguém consegue datar.

### A lição transferível
Memória de agente não é banco de dados — é **contexto que você paga em toda requisição**. Sem
política de expurgo, ela vira dívida que se cobra sozinha, todo dia.

---

## Caso B2 — Limites duros vencem bom senso

**Assunto:** design de sistemas de conhecimento · **Público:** tech leads
**Gancho candidato:** "Coloquei um teto de 2 KB na memória do meu agente. A regra mais importante não
é o número — é que o número não sobe."

### O contexto
Definida a doutrina de curadoria (Caso B1), faltava o mecanismo que a faz valer.

### A decisão
Limites numéricos e verificáveis:

| Artefato | Limite |
|---|---|
| Memória por agente | **2 KB e 60 linhas** |
| Skill | **300 linhas** |
| Contexto sempre carregado | **60 linhas** |

E a regra que dá dente aos números: **estourar o limite obriga a promover ou descartar. O limite não
sobe para acomodar conteúdo.**

### O detalhe que prova o mecanismo funcionando
Ao adicionar o oitavo agente, o arquivo de contexto sempre carregado foi para **exatamente 60 de 60
linhas**. Não estourou — mas chegou ao teto. E o teto sendo teto significa que a próxima linha que
entrar ali **obriga uma decisão**, não uma expansão.

O sistema avisou sozinho.

### A lição transferível
Todo sistema que cresce sem limite explícito cresce até doer. Um número arbitrário e respeitado vale
mais que bom senso ilimitado — porque bom senso não dispara alerta.

Vale para memória de agente, para arquivo de configuração, para README e para qualquer documento que
"todo mundo lê".

---

## Caso B3 — Dívida técnica não é lixo (e o agente de limpeza que quase não teve trabalho)

**Assunto:** dívida técnica, agentes de manutenção · **Público:** tech leads, devs
**Gancho candidato:** "Criei um agente para achar código morto. Ele encontrou zero. E aí ficou
interessante."

### O contexto
Na lista inicial de agentes havia um "faxineiro": varrer `console.log` esquecido, import morto,
componente sem uso, arquivo temporário.

### A descoberta
A varredura encontrou **zero `console.log` e zero TODO/FIXME** em todo o código-fonte. Como
faxineiro, o agente não tinha trabalho.

### A redefinição
O trabalho real era outro. Existia, sim, mas de natureza diferente:
- Duas entidades modeladas no banco e **nunca usadas** (uma delas é a próxima fase do projeto).
- Uma promessa de PRD não cumprida: a lixeira que deveria expurgar em 30 dias e nunca expurga.
- Uma constante duplicada em três arquivos.
- Um conflito latente de atalho de teclado, encontrado durante a exploração.

Nada disso é lixo. **Tudo isso tem dono e decisão pendente.**

### A parte mais importante: a lista de exclusão
O risco de um agente de limpeza num repositório maduro **não é deixar lixo — é remover carga útil.**
O agente carrega uma lista explícita de *código que parece morto e não é*:

- Entidades planejadas para a próxima fase.
- Um parâmetro que existe **só para os testes injetarem uma dependência**.
- Comentários que documentam decisões de planner do banco — remover o código que eles descrevem
  quebra desempenho em silêncio.
- Um termo repetido numa query que **não é duplicação**, é o que mantém o índice sendo usado.

E a regra de desempate: **na dúvida entre resquício e dívida, classifique como dívida** e deixe a
decisão com o humano.

### A lição transferível
Automação de limpeza precisa saber o que **não** tocar antes de saber o que tocar. E "código que
parece morto" num sistema maduro é, quase sempre, código que alguém não entendeu ainda.

---

## Caso B4 — Convenções invisíveis: o código bilíngue

**Assunto:** convenções de código, onboarding · **Público:** devs, tech leads
**Gancho candidato:** "Meu código é bilíngue de propósito. É a primeira coisa que qualquer IA
'consertaria'."

### O contexto
No Yu-book, o **domínio é nomeado em português** e a **fronteira da API em inglês**. As duas
convivem dentro da mesma função.

| Em português | Em inglês |
|---|---|
| Funções de domínio: `criar`, `mover`, `renumerarCards` | Campos de payload: `title`, `contentMd`, `dueDate` |
| Componentes: `ListaNotas`, `ColunaQuadro`, `GavetaLinks` | Caminhos de rota: `/notes`, `/boards` |
| Todo comentário e mensagem ao usuário | Infraestrutura: `buildApp`, `authenticate` |

Existe uma função chamada `paraResumo` que converte um `NoteDetail` num `NoteSummary` usando campos
em inglês. **Está certo assim.**

### A tensão
Isso não estava documentado em lugar nenhum. Era conhecimento que vivia só na cabeça do autor — e a
primeira coisa que um assistente "prestativo" faria é padronizar tudo para inglês, num commit que
parece limpeza.

### A regra que resolveu
A pergunta de desempate cabe numa linha: **isso atravessa a fronteira HTTP?** Se sim, inglês. Se não,
português.

E uma regra de precedência mais geral: **diante de conflito entre o padrão do mercado e o padrão
observável no repositório, vale o do repositório.**

### A lição transferível
As convenções mais perigosas de um projeto são as que ninguém escreveu, porque "todo mundo sabe".
Quando entra alguém novo — humano ou não — elas são invisíveis, e violá-las parece melhoria.

Escrever a convenção **e o motivo** custa dez minutos e evita o commit que ninguém quer revisar.

---

## Caso B5 — Separar agentes por risco, não por assunto

**Assunto:** design de sistemas multiagente · **Público:** tech leads, devs usando IA
**Gancho candidato:** "Meu agente que escreve changelog e meu agente que faz deploy são separados. O
assunto é o mesmo. O risco não é."

### O contexto
Já existia um agente responsável por documentação: changelog, histórico de decisões, versionamento
semver. Ele **propõe** mensagem de commit, mas não commita.

Surgiu a necessidade de um agente que efetivamente commitasse e publicasse.

### A tensão
Parecia natural estender o agente existente — mesmo assunto, mesmo momento do fluxo, mesmos arquivos.

### A decisão e o motivo
Foram separados. **A divisão é de risco, não de assunto:** um edita markdown, o outro publica em
produção.

Naquele projeto, `git push` para a branch principal **é um deploy em produção sem etapa de
aprovação**. Isso merece um agente com guarda própria:

- **Nunca faz push sem pedido explícito no turno.** Autorização para commitar **não é** autorização
  para publicar, e autorização de um turno não vale para o seguinte.
- Nunca reescreve histórico publicado.
- Recusa-se a commitar se qualquer arquivo de ambiente aparecer no diff.
- **É somente leitura em arquivo** — mexe em git e em rede, não em código.

### O conhecimento que ele carrega (o que só se aprende apanhando)
- Que alterar o pacote compartilhado ou o lockfile reconstrói **os dois** serviços.
- Que as migrations rodam no boot de produção — migration nova vai ao ar no deploy, sem confirmação.
- Que uma variável do front é lida em tempo de build, então trocá-la não muda nada sem redeploy.
- Que **rollback de código não desfaz migration aplicada**.

### A lição transferível
Ao dividir responsabilidades entre agentes (ou entre pessoas), a pergunta útil não é "de que assunto
isso trata", é **"o que acontece se der errado"**. Ações irreversíveis merecem fronteira própria,
mesmo quando o assunto é o mesmo.

---

# TEMA C — Rigor de engenharia

## Caso C1 — 15 testes falhando, e nenhum deles era do meu código

**Assunto:** rigor de diagnóstico · **Público:** devs de todos os níveis
**Gancho candidato:** "Mudei um contrato. 15 testes quebraram. A resposta certa não era consertar o
código."

### O contexto
Depois de adicionar uma propriedade a um contrato compartilhado, a suíte de integração acusou **15
falhas em 47 testes**, em 2 das 5 suítes.

### O reflexo errado
O reflexo é assumir culpa e sair consertando — o que teria produzido mudanças desnecessárias
perseguindo um problema que não existia.

### O que foi feito
**Atribuir antes de consertar.** As alterações foram guardadas temporariamente e a suíte rodou contra
o código original.

Resultado: **15 falhas antes também.** Idênticas.

### A causa real
A mensagem de erro dizia: `The table public.link does not exist in the current database`.

As migrations de duas fases do projeto **nunca tinham sido aplicadas no banco local**. O portão de
teste estava vermelho havia semanas, por ambiente desatualizado.

### O desfecho
Migrations aplicadas no banco local. Suíte: **47 de 47 passando.**

E só então a mudança de contrato pôde ser validada de verdade.

### A consequência maior
Este era o **único portão automático do projeto** — não há CI. Com ele vermelho havia semanas,
qualquer regressão real passaria despercebida, porque "falha" tinha virado o normal.

### As lições transferíveis
1. **Atribua antes de consertar.** Trinta segundos guardando o trabalho e rodando o baseline evitam
   horas perseguindo o bug errado.
2. **Teste vermelho crônico é pior que teste nenhum**, porque produz falsa sensação de cobertura e
   treina a equipe a ignorar o sinal.

---

## Caso C2 — Os erros que eu cometi, e o que eles ensinam

**Assunto:** transparência técnica, aprendizado · **Público:** devs, especialmente pleno/sênior
**Gancho candidato:** "Escrevi um requisito impossível no meu próprio documento. Só descobri quando
fui medir."

### Erro 1 — O requisito que não tinha como ser cumprido

No documento de requisitos, ficou escrito que o catálogo de notas custaria no máximo **40 bytes por
nota**.

Na medição real: **98 bytes por nota**.

O requisito era **impossível desde o início**: o identificador único sozinho tem 36 caracteres. Com
título e tipo, o mínimo realista passa de 70 bytes.

**A correção teve duas partes:**
1. O número virou 110 bytes por nota — baseado em medição, não em otimismo.
2. Um teto **por quantidade** (200 itens) foi adicionado, com o total real declarado quando corta.

**A lição:** requisito não-funcional escrito sem medir é chute com aparência de rigor. E se você não
volta para medir, ele vira um número que todo mundo cita e ninguém cumpre.

**A lição secundária, que virou regra:** cap silencioso é pior que cap. Se o sistema corta a lista, ele
tem que **dizer** que cortou — senão o consumidor conclui que aquilo é tudo o que existe.

### Erro 2 — Inventei o mesmo tipo duas vezes

Ao integrar com o SDK, foi criada uma interface própria para o formato de retorno. O compilador
recusou: o SDK exige uma assinatura de índice que um tipo caseiro não tem.

Correção: usar o tipo exportado pelo próprio SDK.

**Semanas depois, o mesmo erro se repetiu** — outra estrutura, mesmo reflexo de escrever o tipo à mão
em vez de importar o existente.

**A lição:** quando um erro se repete, o problema não é o erro — é a ausência de registro. Este virou
candidato explícito à memória do agente, exatamente para não haver uma terceira vez.

### Por que isto vale um post
Conteúdo técnico que só mostra acerto não ensina nada e não convence ninguém. **O erro medido, com o
número real ao lado, é a prova de que houve verificação.**

---

## Caso C3 — Verificar contra o protocolo, não contra a ferramenta

**Assunto:** metodologia de teste · **Público:** devs
**Gancho candidato:** "Testei meu servidor MCP sem instalar cliente nenhum. Três linhas de JSON no
stdin."

### O contexto
Existe um inspetor gráfico oficial para testar servidores MCP. É a ferramenta recomendada, e funciona.

### A escolha
A verificação foi feita **falando JSON-RPC direto no stdin do processo** — um arquivo com as
mensagens e um redirecionamento de shell.

### O que isso permitiu que a ferramenta não permitiria
- **Medir** o tamanho exato da resposta em bytes, para validar o orçamento de contexto.
- **Comparar caractere a caractere** a saída de uma tool e de um resource que expõem o mesmo dado —
  provando que compartilham uma implementação e não divergiram.
- **Validar que toda linha do stdout é JSON-RPC**, o que é uma invariante do transporte.
- Rodar tudo de novo em segundos, a cada mudança, sem interface.

### O resultado concreto
A comparação entre tool e resource deu **5080 bytes idênticos**. Não "parecem iguais" — são.

### A lição transferível
Ferramenta de inspeção é ótima para explorar e péssima para **provar**. Quando você precisa de uma
afirmação verificável — um número, uma igualdade, uma invariante — fale com o protocolo direto.

Vale para MCP, para APIs REST, para filas e para qualquer coisa com um contrato de fio.

---

## Caso C4 — Aplicar o aprendizado ao projeto real, não ao exercício do curso

**Assunto:** método de estudo · **Público:** devs em formação, gestores de time
**Gancho candidato:** "O curso mandava construir um servidor de documentos de exemplo. Construí em
cima do meu projeto de verdade — e as decisões difíceis apareceram sozinhas."

### O contexto
O curso de MCP ensina construindo um servidor de gerenciamento de documentos, com os dados num
dicionário em memória.

### A escolha
Aplicar cada aula ao projeto real, em produção, com dados reais.

### O que apareceu por causa dessa escolha
Decisões que o exercício do curso **nunca forçaria**:

- **Orçamento de contexto** — com dicionário em memória, devolver tudo funciona. Com um acervo real,
  não.
- **Escopo por usuário** — o exemplo não tem autenticação. O projeto real tem, e isso determinou toda
  a arquitetura de acesso (Caso A3).
- **Listável ou template** — com seis documentos fixos, listar todos é óbvio. A pergunta só existe
  quando o acervo cresce.
- **Ciclos de deploy independentes** — o exemplo roda inteiro numa máquina (Caso A7).
- **Contrato compartilhado** — o exemplo não tem um front consumindo os mesmos tipos.

### A escolha que ampliou o aprendizado
O curso ensinava em Python. O projeto foi escrito em **TypeScript** — de propósito, porque assim os
schemas de validação das tools são **os mesmos** que a API já usa, em vez de uma segunda cópia que
divergiria.

Custou traduzir cada conceito de uma linguagem para outra. Isso **é** o aprendizado: quem só repete o
código da aula não sabe o que era essencial e o que era detalhe do SDK.

### A lição transferível
Exercício de curso é projetado para não ter atrito, e o atrito é onde mora o aprendizado. Aplicar ao
sistema real custa mais e ensina o que o tutorial não tem como ensinar.

---

# Guardrails factuais (ler antes de escrever qualquer post)

Para não haver exagero em nenhuma peça:

| Verdadeiro | Não afirmar |
|---|---|
| O servidor MCP expõe as três primitivas e foi verificado contra produção | Que está "em produção" — ele roda **local**, na máquina do autor, e não é deployado |
| Tem 5 tools, 4 resources diretos, 2 templates, 2 prompts | Que faz escrita. **É somente leitura.** Criar ou mover card não existe ainda |
| 47 testes de integração passando | Que há cobertura completa. `auth` e `organizacao` não têm suíte; não há teste de frontend |
| 16 notas ativas no acervo real | Que foi validado em escala. Os limites para 500 notas são **projeção**, não medição |
| A separação de agentes por risco está implementada | Que impede tecnicamente o push. A guarda é **textual**, uma instrução no agente |
| Os ganhos de 4,2 MB → 24 KB e 6 → 1 requisição são reais | Que vieram do MCP. São de otimização REST **anterior**, usada como precedente |
| Nenhuma migration foi criada nesta entrega | Que o banco mudou. As colunas expostas **já existiam** |
| É um projeto pessoal, single-user, de um autor solo | Sugerir escala de time ou de produto |

**Tom sugerido:** técnico, específico e sem superlativo. O material tem números reais, erros
assumidos e decisões justificadas — é isso que o torna crível. Superlativo só subtrai.

**O que funciona melhor como post:** os casos com um número medido (A2, C1, C2, C3) e os com uma
inversão de expectativa (B3 — "o agente de limpeza não achou nada"; C1 — "os testes não eram meus";
A6 — "estava publicado no meu próprio site"). Os conceituais (A1, A8, B1) funcionam melhor como
carrossel ou post longo.
