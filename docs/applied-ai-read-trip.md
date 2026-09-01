# Applied AI Read Trip

**Roteiro da trilha de IA aplicada ao Yu-book.** Onde estamos, para onde vamos, e qual é o destino.

Este documento existe para uma coisa só: **não perder o objetivo final de vista** enquanto as fases
intermediárias acontecem. Ele é curto de propósito na parte já feita e detalhado na parte planejada.

Cada fase, quando for executada, gera o **seu próprio plano** — este roteiro diz o que e o porquê,
nunca o como.

---

## O princípio que atravessa tudo

**Expor o domínio e deixar o ecossistema compor.**

Não construir integração ponto a ponto entre os sistemas que são meus. Cada sistema abre a própria
superfície, e a conexão entre eles é protocolo, não código de cola. É o que evita acoplamento e é o
que faz cada peça continuar valendo sozinha.

Toda decisão de arquitetura deste roteiro se justifica por essa frase. Quando uma decisão futura
parecer difícil, é a ela que se volta.

---

## Onde estamos

### O produto

O **Yu-book** é um segundo cérebro pessoal em produção: notas, kanban por workspace, gaveta de
links e dashboard. **Fases de produto 0 a 5 entregues** — a 5 foi refino do que já existia: tags de
card, precisão do arraste e o editor Markdown ao vivo. A **Fase 6 de produto** — agenda no Google
Calendar — segue pendente desde o início e não é urgente.

### A infraestrutura de trabalho

O conhecimento tácito do repositório virou **estrutura**: nove agentes especialistas, sete skills e
memória persistente por agente, com uma doutrina de curadoria que decide o que vira skill, o que
vira memória, o que vira contexto mínimo e o que vira comentário no código.

O que isso entregou, na prática: cada área tem dono, o conhecimento sobrevive à sessão, e existe
separação por **risco** — quem escreve documentação não é quem publica em produção.

### O servidor MCP

O Yu-book foi virado do lado de fora. Ele expõe hoje **as três primitivas do protocolo**:

- **Tools** — o que o modelo decide chamar.
- **Resources** — o que o usuário anexa antes de perguntar.
- **Prompts** — os fluxos de trabalho que o usuário invoca.

Duas decisões definem esse servidor e valem para tudo que vier: ele é **cliente da própria API**,
não do banco, o que faz herdar toda a autorização em vez de reimplementá-la; e ele trata o
**orçamento de contexto** como problema de primeira ordem — buscar é barato, ler é caro e explícito.

**Estado atual: lê e escreve, sobre dois transportes.** A escrita entrou com a Fase 2 **deste
roteiro** — a Etapa 3 das cinco da proposta de MCP — e nasce desligada fora de host local. O
transporte HTTP com identidade própria entrou com a Fase 3, em 2026-09-01: sobre HTTP quem decide a
escrita é o escopo do token, e cada requisição age como quem o apresentou.

---

## Para onde vamos

**Os números abaixo são deste roteiro e só dele.** Não são as fases de produto (0 a 5, fechadas)
nem as etapas do servidor MCP (cinco, a 4 entregue). Nenhuma das três numerações se converte na
outra.

As fases abaixo correm **em paralelo aos cursos**, e a ordem dos cursos foi escolhida para destravar
cada uma na hora certa.

| Curso | O que destrava |
|---|---|
| Cursos curtos de inglês | nada — janela livre para trabalho de produto |
| MCP: Advanced Topics — **concluído em 2026-08-26**, as 11 lições | transporte HTTP e autenticação de verdade; virou a Fase 3 deste roteiro, entregue em 2026-09-01 |
| Work with API | a mesa de trabalho |

A Parte I do curso já rendeu duas decisões que **não** viram código, e por isso ficam aqui: a
**amostragem (*sampling*) não será usada** — quem chega pelo MCP já tem um modelo do outro lado, e a
direção oposta, a IA dentro do Yu-book, roda em modelo local por privacidade; e as **raízes
(*roots*) não se aplicam** ao `apps/mcp`, que não abre arquivo — a lição vale para a mesa de
trabalho, que precisa de cópia em disco de vários repositórios. Os argumentos completos estão em
[`../apps/mcp/README.md`](../apps/mcp/README.md) e na entrada de 2026-08-26 de
[`historico.md`](historico.md).

Com a Fase 2 deste roteiro entregue, duas frentes já correm **em paralelo**: a IA dentro do Yu-book
(dia de semana) e a mesa de trabalho (fim de semana). Elas não dependem uma da outra.

### Fase 1 — Produto, enquanto a janela está livre — entregue

Saiu como a **Fase 5 de produto**, em três etapas: tags de card (Grupo A), precisão do arraste
(Grupo B), e o botão de copiar mais o editor ao vivo (Grupo C). O conflito do Grupo C foi resolvido
sem virar WYSIWYG — o documento continua sendo Markdown, e o modo ao vivo apenas esconde a marcação
fora da linha do cursor. As três etapas fecharam **sem conferência de interface à mão**; a dívida
está em [`historico.md`](historico.md).

O que o plano dizia, e continua valendo como registro do porquê:

Durante os cursos de inglês, o trabalho é de produto: não depende de nada que ainda não sabemos.

São cinco funcionalidades, agrupadas por afinidade e por custo:

**Grupo A — tags.** Tags nos cards do quadro, para agrupar assuntos relacionados para além do
estágio; e um campo de busca acima do cartão de tags na navegação, filtrando conforme se digita.
Um tema só, mas atravessa a pilha inteira.

**Grupo B — polimento de interação.** Arrasto de card mais fluido e preciso até encontrar a coluna,
e um botão para copiar a nota inteira com um clique. Só front, independentes entre si, baratos.

**Grupo C — o editor.** Unificar edição e visualização do Markdown, no espírito do campo de
descrição do Asana: digitar `# titulo` e ver o título formatado, sem o `#` aparecendo.

> **O Grupo C conflita com uma decisão registrada.** A proposta original do projeto listou "editor
> WYSIWYG" entre o que **não** seria feito, com o argumento de que Markdown é portátil e mais rápido
> de digitar. Revisitar é legítimo — mas exige decisão explícita e motivo escrito, não pode entrar
> por inércia. É o maior e o mais arriscado dos três grupos.

**Consequência que não pode ser esquecida:** tag em card muda o domínio. Muda o contrato
compartilhado, provavelmente puxa migration, e **a superfície do MCP precisa acompanhar**. Não é
opcional e não é automático — mudança de domínio não quebra o servidor MCP, deixa-o desatualizado em
silêncio.

### Fase 2 — MCP: escrita — entregue em 2026-08-26

O servidor deixou de ser consulta e virou ferramenta. São **quatro tools, não três**: `create_card`,
`move_card`, `trash_note` e `restore_note`.

As duas decisões que esta fase previa foram tomadas assim:

**Granularidade: estreita.** Uma escrita por chamada, com o menor schema que resolve o caso. O
schema de uma tool não é assinatura de função — é **contrato de conversa com o modelo**, e cada
campo a mais é uma liberdade a mais para ele inventar combinação inválida. O preço, um `tools/list`
mais caro em todo turno, foi medido e aceito.

**Ambiente: local e próprio.** O servidor deixou de apontar para produção. Ganhou banco
`yubook_mcp`, API na 3334 e seed recriável — mais uma **trava que desliga as tools de escrita fora
de host local**. Enquanto ele só lia, apontar para produção era inofensivo; com escrita, um pedido
mal interpretado cria dado de verdade e não existe desfazer deste lado.

**"Arquivar nota" não existe no domínio.** Este roteiro pedia a terceira tool com esse nome. Nota vai
para a **lixeira**, card é que se **arquiva** — são dois estados diferentes, com nomes diferentes de
propósito. Daí o par `trash_note` / `restore_note`: o desfazer é uma tool, e não uma promessa no
texto.

Os argumentos completos estão em [`../apps/mcp/README.md`](../apps/mcp/README.md) e na entrada de
2026-08-26 de [`historico.md`](historico.md).

### Fase 3 — MCP: transporte e identidade — entregue em 2026-09-01

É o conteúdo do Advanced Topics, **concluído em 2026-08-26**, e é o degrau que muda tudo. Saiu como
a **Etapa 4 das cinco da proposta de MCP**.

Até aqui o transporte era **stdio**: um processo por usuário, na própria máquina, com a identidade
no ambiente local. Por isso a autenticação pôde ser simples — e ali continua correta assim.

Com transporte **HTTP**, um servidor atende muitos clientes, e a premissa quebra: **o servidor deixa
de saber quem está perguntando.** Credencial em arquivo passa a agir como uma identidade só para
todo mundo. A resposta foi um servidor de autorização OAuth 2.1 próprio, sem estado durável, com a
identidade viajando cifrada dentro do token e sendo aberta a cada requisição. O que ele custou e o
que ficou em aberto está na entrada de 2026-09-01 de [`historico.md`](historico.md).

É por isso que transporte e autenticação são a mesma lição: **mudar o transporte é o que cria o
problema de identidade.**

Esta fase é pré-requisito de tudo que envolva mais de uma pessoa — inclusive de qualquer versão do
Yu-book, ou de outro sistema, exposta para um time.

### Fase 4 — Composição

Com o Yu-book como servidor e conectores externos ativos, pedidos que atravessam sistemas passam a
funcionar sem que nenhuma ponte tenha sido construída. Ler as issues de um repositório e criar cards
no quadro de backlog é o exemplo canônico — e a parte do repositório **já existe**, feita por outra
pessoa.

É a demonstração do princípio no topo deste documento. Se a integração tivesse sido feita ponto a
ponto, o resultado seria acoplamento e nenhuma reutilização.

### Fase 5 — IA dentro do Yu-book

A direção oposta à do MCP: aqui o Yu-book deixa de ser só servidor e passa a ser **cliente** de um
modelo. Resolve o caso que o MCP não alcança e nunca vai alcançar — quem está com o Yu-book aberto
no navegador não tem um cliente MCP por perto.

Quatro fases próprias: o provedor (Ollama local e OpenRouter, roteando por tarefa), o botão de
formatar nota, o chat ancorado em notas e quadros anexados, e a busca semântica — que resgata a
Fase 6 da proposta original.

O que a distingue de tudo o mais neste roteiro: **privacidade**. Tarefa sobre conteúdo de nota roda
em modelo local, e a nota não sai da máquina.

Detalhada em [`prd-ia-no-yu-book.md`](prd-ia-no-yu-book.md). Dependia da Fase 2 deste roteiro, já
entregue: pode começar, **em paralelo à mesa de trabalho** — a mesa é trabalho de fim de semana,
esta frente é de dia de semana.

### Fase 6 — Produto, o que ficou pendente

É também a **Fase 6 de produto**. Os dois seis coincidem por acaso e não significam que as
numerações se convertam.

A agenda no Google Calendar, com a condição de corte que a proposta original já registrou: se a
integração custar mais que meio dia, a funcionalidade inteira sai do escopo. Não se constrói
calendário próprio como consolo.

---

## O destino — a mesa de trabalho

Depois do curso de **Work with API**, o alvo é uma aplicação própria: uma **mesa de trabalho**.

Este roteiro **não descreve o que será construído nela** — isso é assunto de um documento próprio,
quando chegar a hora. O que se registra aqui é **o que se espera dela**, para que o objetivo não se
perca no caminho.

### O que se espera

Um lugar só para trabalhar em vários repositórios, de várias empresas e de projetos pessoais, com a
estrutura de verificação, revisão e publicação integrada — e capaz de executar e agendar atividades
sozinha.

### O que ela reaproveita

Ela roda sobre o **Agent SDK**, a mesma base do Claude Code. Isso significa que os agentes e as
skills que vivem em cada repositório **funcionam nela sem adaptação**. O trabalho feito na
infraestrutura do Yu-book não é jogado fora: é a primeira instância do que ela vai orquestrar.

Uma consequência prática que decorre disso: agente e skill são **arquivos**. A mesa precisa de uma
cópia de trabalho em disco de cada repositório — não basta falar com a API do repositório remoto.

### O que ela não é

**Ela não absorve o Yu-book.** São aplicações distintas, e a separação é por natureza:

| | Yu-book | Mesa de trabalho |
|---|---|---|
| Metáfora | o caderno | a oficina |
| Trabalho assíncrono | nenhum, por decisão | sempre há algo em execução |
| Usuários | um, por decisão | vários contextos e credenciais |
| Risco de uma falha | perde uma anotação | publica no repositório errado |
| Entidades | nota, card, link | repositório, execução, agendamento |

A relação certa entre os dois é a que o protocolo já permite: **a oficina faz o trabalho, o caderno
lembra do trabalho.** A mesa não contém o Yu-book — conversa com ele.

E a definição dos agentes continua **ao lado do código** que eles conhecem. O valor de um agente
especialista vem de conhecer *um* sistema a fundo; um agente genérico não vale quase nada. A mesa é
o painel que cataloga, dispara e mostra o resultado — não o armário que guarda tudo.

---

## Como este roteiro é usado

- Ele diz **o que** e **por quê**. O **como** é o plano específico de cada fase, gerado no momento
  da execução.
- Fase concluída vira registro em `CHANGELOG.md` e decisão em `docs/historico.md`.
- Decisão que contraria algo já registrado — como o editor do Grupo C — exige motivo escrito. Decisão
  sem motivo é decisão que alguém reabre em seis meses.
