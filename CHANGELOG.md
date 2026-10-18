# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[semver](https://semver.org/lang/pt-BR/). Os identificadores `RF-xx`, `RN-xx` e `RNF-xx` resolvem
para os PRDs de cada fase, e as decisões e os porquês ficam num histórico de decisões. Os dois são
documentação interna e, desde a `[0.25.1]`, ficam fora do repositório.

`CHANGELOG.md` diz **o quê**. Os links para `docs/` nas entradas até a `[0.25.0]` ficam como
registro: no ramo atual não resolvem, mas abrem no commit de cada entrada.

**Heading e pacotes têm números diferentes.** O heading é a versão do conjunto; cada pacote tem o
seu no `package.json`, e o corpo de cada entrada diz para onde eles foram.

## [Não lançado]

_Nada pendente._

---

## [0.37.0] — 2026-10-18

**Hábitos, no servidor (frente Ritmo, Ritmo 1).** Abre a frente Ritmo, que tem numeração própria
(Ritmo 1 a 7) e não se confunde com as fases de produto, a frente de agenda nem R1–R3. Um hábito
tem uma meta semanal em pontos, os dias-alvo da semana e atividades pontuadas. Os pontos vêm de
três gestos: concluir uma tarefa ligada a uma atividade, fazer check-in numa ocorrência de evento
ligado a uma, ou registrar fora do plano. A semana é **ponderada**: cada dia conta no máximo
`ceil(meta / dias-alvo)` para a meta, e o resto fica à parte, para que um dia só não pague a semana
inteira. Tudo se calcula na leitura, sem tabela de agregado nem relógio novo. **Esta entrega não
tem tela**: hábitos se criam e se configuram pelo MCP, e o chat lê e registra. A área Ritmo do
celular é a Ritmo 2.

**Os seis pacotes se movem**, porque o contrato de tarefa e de evento mudou em `packages/shared`
(`habitActivityId` na entrada, `habitActivity` na resposta), e as descrições de `create_task` e de
`create_event`, que o chat e o MCP dividem, também. `packages/shared` vai de `0.22.0` para
`0.23.0`, `apps/api` e `apps/mcp` de `0.23.0` para `0.24.0`, `apps/web` de `0.30.0` para `0.31.0`,
e `apps/movel` e `packages/cliente` de `0.7.0` para `0.8.0`. No web, o que se vê é o editor de
agente, com as duas ferramentas novas, e o rótulo delas no chat. No móvel, só o rótulo no chat.

**Migration `20261018180000_ritmo_habitos`, só aditiva**, aplicada pela API no boot: as tabelas
`habit`, `habit_activity` e `habit_entry`, o enum `HabitEntryOrigin` e a coluna
`habit_activity_id`, opcional, em `task`, `task_series` e `event`. Excluir um hábito leva as
atividades e os registros. Excluir uma atividade solta os vínculos e deixa os registros. Excluir
uma tarefa ou um evento não apaga o registro que eles renderam. Nenhuma linha existente muda.

**Na janela do deploy, a API precisa estar no ar antes do MCP.** Contra uma API anterior a esta,
as tools de hábito recusam com a frase "a API no ar ainda não tem hábitos". `create_task` e
`create_event` com `habitActivityId` são outro caso: a API velha descarta a chave e cria o item
**sem vínculo**, sem erro, e o MCP não confere. Quem nota é a falta da linha "hábito:" no texto
da resposta.

**O que o assistente paga a mais.** O chat passa de 13 para 15 ferramentas: `list_habits` (183
bytes de descrição) e `log_habit` (256). `create_task` e `create_event` ganharam o campo
`habitActivityId`, com 62 e 76 bytes de descrição. Isso vale para todo turno. Quando `log_habit`
está ligado, o system prompt ganha um bloco de duas linhas. No MCP, `tools/list` passa de 21 para
25 tools. O total do catálogo em bytes não foi medido.

Portões: `pnpm typecheck` limpo nos seis pacotes. O MCP passou com **110 testes** (eram 99). A API
passou com **681 de 682** (eram 647). A única falha é de ambiente, a mesma da entrada anterior: o
teste de DNS rebinding precisa do endereço `127.0.0.2`, que o macOS não tem por padrão. Nenhuma
conferência de interface à mão, porque não há tela nova. O rótulo do chat e o editor de agente do
web também não foram conferidos.

### Adicionado
- **Hábitos e atividades** (`/habits`, `/habit-activities`). Um hábito tem nome, cor, emblema,
  meta semanal (de 1 a 5000 pontos) e dias-alvo (de 1 a 7). Ele se cria já com as atividades,
  numa transação só, e se edita, arquiva, desarquiva, reordena e exclui. A atividade tem nome e
  pontos, de 1 a 500. O nome do hábito é único por usuário, o da atividade é único dentro do
  hábito, e nome repetido é 409 (RF-01 a RF-05, RN-01, RN-02).
- **A semana ponderada vem em cada hábito** (`week`). Ela vai de segunda a domingo, no fuso do
  usuário. Traz o teto diário, o que entrou e o que contou em cada dia, o progresso, o que passou
  do teto, os dias ativos e se a meta foi batida. A conta mora em `packages/shared`, para web e
  móvel contarem igual (RF-10).
- **Concluir uma tarefa ligada a uma atividade pontua.** O registro se grava na mesma transação da
  conclusão, com os pontos da atividade naquele momento e o dia de hoje do usuário. Concluir de
  novo não duplica, nem entre as duas instâncias da API. Reabrir a tarefa apaga o registro, também
  na mesma transação (RF-07, RN-04).
- **O vínculo `habitActivityId` em tarefa, série de tarefas e evento**, na criação e na edição. A
  série copia o vínculo para cada ocorrência que gera, e editar a série reescreve o vínculo das
  ocorrências abertas de hoje em diante. Converter evento em tarefa, ou o contrário, leva o vínculo
  junto. A resposta de tarefa e de evento ganhou `habitActivity`, com o nome da atividade, os
  pontos e o hábito (RF-06).
- **Check-in numa ocorrência de evento** (`POST /events/:id/check-in` com `{ day }`, e `DELETE
  /events/:id/check-in?day=`). O dia precisa ser uma ocorrência real do evento e não pode estar no
  futuro. Repetir o check-in não duplica, e o `DELETE` desfaz. Quando a ocorrência sai da série,
  por "esta" ou por "esta e as seguintes", o check-in vai junto para o evento novo, na mesma
  transação (RF-08, RN-13).
- **Registro fora do plano** (`POST /habits/:id/entries`). Com uma atividade, os pontos vêm dela,
  a menos que o pedido diga outro valor. Sem atividade, o pedido traz os pontos. O dia padrão é
  hoje, até 30 dias atrás. O registro avulso se exclui por `DELETE /habit-entries/:id`. O de tarefa
  ou de check-in se desfaz pela origem, a menos que ela tenha sido excluída (RF-09, RN-06, RN-10).
- **Histórico de registros por período** (`GET /habits/:id/entries?from&to`), até 400 dias por
  consulta, para a linha do tempo da Ritmo 2 (RF-11).
- **Hábitos no MCP.** `list_habits` mostra os hábitos, as atividades com id e a semana. Com a
  escrita liberada, `create_habit` cria o hábito com as atividades, `update_habit` muda o hábito e
  cria, edita ou arquiva atividades, e `log_habit` registra fora do plano. `create_task`,
  `update_task`, `create_event` e `update_event` aceitam `habitActivityId` (RF-12 a RF-14).
- **Hábitos no chat.** O assistente lê os hábitos e registra pontos fora do plano, quando
  pedido. Ele não cria nem configura hábito: isso fica só no MCP. As duas ferramentas aparecem no
  editor de agente e têm rótulo próprio na conversa, no web e no celular (RF-15).

### Alterado
- **O registro guarda os pontos do momento.** Mudar os pontos de uma atividade depois não
  reescreve os registros antigos (RN-03).
- **Hábito ou atividade arquivados não pontuam.** Registro avulso e check-in neles são recusados
  com 409. Concluir uma tarefa ligada a eles conclui a tarefa, mas não gera pontos. Uma atividade
  arquivada ainda se vincula a tarefa e evento (RN-07).
- **O registro feito pelo MCP ou pelo chat leva a marca de quem registrou**, gravada só pelo
  servidor, como a marca de conclusão da tarefa (RN-12).
- **Num 404 de edição ou criação na agenda, o MCP aponta também para `habitActivityId`.** Antes
  apontava só para o quadro. A atividade de outra conta é 404, como a inexistente (RN-11).

### Limitações conhecidas
- **Não há tela de hábitos.** Nem no web nem no celular: a área Ritmo do móvel é a Ritmo 2.
- **O check-in de evento só se faz pela rota.** Nenhuma tool do MCP nem do chat o faz. A
  descrição do vínculo nos eventos diz "check-in, feito no app", para o modelo não usar
  `log_habit` no lugar, o que escaparia da unicidade por ocorrência. A tool fica para a Ritmo 2.
- **A resposta do evento ainda não diz se uma ocorrência já teve check-in.** Isso entra com a
  tela, na Ritmo 2.
- **`update_habit` não é atômico.** O hábito e cada atividade são rotas próprias. Se uma escrita
  falha no meio, a tool devolve o que foi aplicado e o que falhou, em vez de desfazer.
- **Pelo MCP e pelo chat, hábito e atividade não se excluem.** Só se arquivam. Excluir se faz pela
  API, e o registro avulso também.
- **Ofensivas, XP, níveis e recordes ainda não existem.** São a Ritmo 3.

---

## [0.36.0] — 2026-10-18

**Tarefa recorrente.** Uma tarefa passa a poder se repetir toda semana, nos dias escolhidos, com um
último dia opcional: "mandar candidatura de segunda a sexta" é uma série só. Cada ocorrência é uma
tarefa de verdade, que se conclui sozinha, e a lista de abertas mostra só a de hoje de cada série.
Ela se cria pela folha do celular, pedindo ao assistente ou pelo MCP. No celular e no MCP, editar
ou excluir uma ocorrência pergunta o alcance: só esta ou a série. Um evento recorrente também pode
agora virar, inteiro, uma tarefa recorrente.

**Os seis pacotes se movem**, porque o contrato da tarefa mudou em `packages/shared` e a descrição
de `create_task`, que o chat e o MCP dividem, também. `packages/shared` vai de `0.21.0` para
`0.22.0`, `apps/api` e `apps/mcp` de `0.22.0` para `0.23.0`, `apps/web` de `0.29.0` para `0.30.0`,
e `apps/movel` e `packages/cliente` de `0.6.0` para `0.7.0`. O web só se move pelo contrato: nada
muda na tela dele.

**Migration `20261018120000_tarefas_recorrentes`, só aditiva**, aplicada pela API no boot: a tabela
`task_series`, a coluna `task.series_id` e o índice único `(series_id, date)`. Apagar a série solta
as tarefas dela (`SET NULL`), e apagar o usuário leva as séries junto. Toda tarefa que já existia
continua avulsa. A migration foi aplicada do zero num banco de rascunho, e o `migrate diff` contra
o `schema.prisma` saiu vazio.

**Na janela do deploy, a API precisa estar no ar antes do MCP e do móvel.** Uma API anterior a
esta não recusa `repeat`: ela descarta a chave e cria uma tarefa avulsa. O MCP percebe isso pela
resposta e avisa o modelo, sem tentar de novo. No celular, as rotas da série respondem 404 até a
API nova subir.

**O que o assistente paga a mais.** A descrição de `create_task` cresceu 145 bytes, e o campo
`repeat` entrou no schema dela. Isso vale para o catálogo do chat, em todo turno, e para o
`tools/list` do MCP. O total em bytes não foi medido nesta entrega. O número de tools não mudou, e
o system prompt também não.

Portões: `pnpm typecheck` limpo nos seis pacotes. O MCP passou com **99 testes** (eram 90; dois
deles são da correção da CSP, abaixo). A API passou com **646 de 647** (eram 632). A única falha é
de ambiente e não tem relação com a entrega: o teste de DNS rebinding precisa do endereço
`127.0.0.2`, que o macOS não tem por padrão. Os 15 casos novos da API estão em
`tests/tarefas-recorrentes.test.ts`.

**A folha do celular foi conferida num navegador, não num Android.** Nenhum portão cobre
`apps/movel`. À mão, no ambiente local, em viewport de celular, foram feitos quatro caminhos: criar
uma tarefa com repetição, editar a série toda (as ocorrências futuras mudaram), converter uma série
de evento inteira e encerrar uma série. Ninguém conferiu o relógio que estende o horizonte rodando
em produção.

### Adicionado
- **Tarefa recorrente** (`POST /tasks` com `repeat`). `repeat` leva os dias da semana e um último
  dia opcional, e `date` passa a ser obrigatório: é o primeiro dia da série. As ocorrências são
  geradas de hoje até 60 dias à frente.
- **O horizonte anda sozinho.** Um relógio da API estende as séries abertas na subida e depois de
  hora em hora. Ele roda nas duas instâncias do deploy, e o índice único `(series_id, date)` impede
  que um dia seja gerado duas vezes (INV-60).
- **A série tem rotas próprias.** `GET /task-series/:id` lê a série. `PATCH /task-series/:id` muda
  título, detalhes, hora, projeto ou dias, e refaz as ocorrências abertas de hoje em diante. As
  concluídas e as de antes de hoje ficam como estavam. `DELETE /task-series/:id` encerra a série de
  hoje em diante. As ocorrências já feitas ficam, como tarefas avulsas.
- **A tarefa mostra de que série veio.** A resposta da tarefa ganhou `series`, que é `null` na
  avulsa. No texto do MCP e do chat, a tarefa recorrente diz em que dias se repete.
- **Uma série de eventos vira tarefa recorrente.** Com `POST /events/:id/to-task?scope=todas`, a
  série vira uma tarefa que se repete nos mesmos dias, de hoje em diante. O evento termina ontem.
  Se a série ainda nem tinha começado, ele é apagado.
- **"Repetir" na folha da tarefa, no celular.** Ao criar, escolhem-se os dias. Numa ocorrência,
  editar pergunta o alcance (Só esta / Toda a série), e excluir também (Excluir só esta / Encerrar
  a série). Converter uma série de evento em tarefa oferece Só esta / Toda a série.
- **Tarefa recorrente no MCP e no chat.** `create_task` aceita `repeat`, nas duas superfícies. No
  MCP, `update_task` e `delete_task` ganharam `scope` (`esta` ou `serie`), e
  `convert_event_to_task` ganhou `scope: todas`. O chat continua sem editar, excluir e converter.

### Alterado
- **Concluir, editar e excluir uma ocorrência valem só para ela.** Concluir marca aquele dia.
  Editar, excluir ou converter uma ocorrência a solta da série, e o dia dela não é gerado de novo.
- **Ocorrência de série nunca fica atrasada.** Um dia que passou sem ser feito não se acumula na
  lista. Só a tarefa avulsa atrasa.
- **Converter uma série de eventos exige dizer o alcance.** Em `POST /events/:id/to-task`, um
  evento recorrente sem `scope` passou a ser recusado com 400. Não há padrão: `esta`, com
  `occurrenceDate`, converte uma ocorrência; `todas` converte a série inteira.
- **Numa tarefa recorrente, o MCP não presume o alcance.** `update_task` e `delete_task` sem
  `scope` leem a tarefa antes e recusam se ela vem de uma série, como já faziam as tools de evento.

### Corrigido
- **O login OAuth do MCP voltava ao cliente de aplicativo.** Para uma `redirect_uri` de esquema
  próprio, como `claude://…`, `URL.origin` é a string `"null"`. Por isso a página de login saía com
  `form-action 'self' null`, e o navegador bloqueava o retorno ao cliente depois da senha. Agora o
  esquema entra na CSP como fonte (`claude:`). `javascript:`, `data:`, `blob:`, `file:`, `about:`
  e `filesystem:` continuam recusados. **Esta correção já está em produção**, publicada antes desta
  entrada e conferida lá.

### Limitações conhecidas
- **A repetição da tarefa é só semanal**, como a do evento.
- **Uma tarefa avulsa não passa a se repetir.** Para isso, cria-se a tarefa de novo, com `repeat`.
- **Converter uma série de tarefas em evento não existe.** Converte-se uma ocorrência por vez.
- **O chat do aplicativo cria a série, mas não a edita nem a encerra.** Isso se faz no celular e
  no MCP.

---

## [0.35.0] — 2026-10-18

**Controle da agenda: converter e, pelo MCP, editar e excluir.** Um evento pode virar tarefa, e uma
tarefa pode virar evento, sem apagar um e recriar o outro à mão. No celular, isso se faz na folha de
editar. Pela API, são duas rotas novas. Pelo MCP, a agenda passa a se editar, excluir e converter
por seis tools novas. O chat do aplicativo não ganha nenhuma delas: ele continua criando evento e
tarefa e concluindo tarefa (RN-03).

**Os seis pacotes se movem**, porque `packages/shared` ganhou os corpos das conversões e as seis
definições de tool. `packages/shared` vai de `0.20.0` para `0.21.0`, `apps/api` e `apps/mcp` de
`0.21.0` para `0.22.0`, `apps/web` de `0.28.0` para `0.29.0`, e `apps/movel` e `packages/cliente`
de `0.5.0` para `0.6.0`. O web só se move pelo contrato: nada muda na tela dele. **Sem migration.**

**Na janela do deploy, a API precisa estar no ar antes do MCP e do móvel.** Uma API anterior a
esta não tem as rotas de conversão e responde 404. O MCP lê esse 404 como item que não existe e diz
ao modelo que nada foi alterado, e no celular a conversão falha com erro. Editar e excluir pelo MCP
usam rotas que já existiam.

**O que o MCP publica a mais.** O `tools/list` com a escrita liberada vai de 15 para 21 tools, e as
seis novas somam 8.278 bytes ao JSON das tools (de 15.025 para 23.303, medidos nesta entrega, com o
mesmo método nos dois números). A sessão só de leitura não muda. **O chat não paga nada a mais**:
as seis ficam fora do catálogo dele, e o system prompt não mudou.

Portões: `pnpm typecheck` limpo nos seis pacotes. O MCP passou com **90 testes** (eram 74). A API
passou com **631 de 632** (eram 619). A única falha é de ambiente e não tem relação com a entrega: o
teste de DNS rebinding precisa do endereço `127.0.0.2`, que o macOS não tem por padrão. Os 13 casos
novos da API cobrem as duas conversões, a ocorrência de uma série, a marca de IA copiada, a posse e a
recusa da tarefa concluída. Os 16 do MCP cobrem as seis tools e a trava da série.

**A folha do celular foi conferida num navegador, não num Android.** Nenhum portão cobre
`apps/movel`; a conversão foi feita à mão no ambiente local, em viewport de celular, nas duas
direções (evento com hora virou tarefa às 23:30; tarefa sem hora virou evento de dia inteiro) e
numa ocorrência de série, que saiu sozinha enquanto as outras ficaram.

### Adicionado
- **Evento vira tarefa** (`POST /events/:id/to-task`). A tarefa leva o título, a descrição, o dia,
  a hora de início e o projeto do evento. Um evento de dia inteiro vira tarefa sem hora. O local e
  o link não têm campo na tarefa e vão para o fim da descrição, como "Local: …" e "Link: …". A
  duração se perde. O corpo, opcional, troca o que vem do evento. **Numa série, só uma ocorrência
  converte**, com `?scope=esta&occurrenceDate=…`: ela sai da série como num "excluir só esta", e as
  outras ficam. Qualquer outro alcance numa série é recusado com 400.
- **Tarefa vira evento** (`POST /tasks/:id/to-event`). O evento leva o título, os detalhes, o dia e
  o projeto da tarefa. Com hora, ele começa nela e dura uma hora. Sem hora, é de dia inteiro. O
  corpo, opcional, troca qualquer campo e aceita até a repetição semanal. Uma tarefa sem data exige
  `date`, e **uma tarefa concluída é recusada**: o evento não guarda a conclusão, e convertê-la
  apagaria o registro de que foi feita.
- **Converter na folha de editar do celular.** Ao editar, a alternância Evento/Tarefa reaparece.
  Trocar o tipo converte o item ao salvar: a folha passa a se chamar "Converter em …", diz o que vai
  acontecer e esconde Excluir e Concluir. O horário passa de uma forma para a outra: o início do
  evento vira a hora da tarefa, e a hora da tarefa vira o início do evento. Numa série, só a
  ocorrência aberta vira tarefa, e a folha diz qual dia. Uma tarefa concluída não mostra a
  alternância.
- **Seis tools de controle da agenda no MCP**, com a escrita liberada: `update_event`,
  `delete_event`, `update_task`, `delete_task`, `convert_event_to_task` e `convert_task_to_event`.
  Nenhuma manda `origin`: editar, excluir e converter não geram conteúdo.

### Alterado
- **Excluir na agenda passou a ser tool do MCP.** Até aqui, o critério do servidor deixava fora
  toda operação irreversível, que só se fazia no aplicativo, com alguém confirmando. A agenda é a
  exceção declarada, a pedido do operador, para reorganizar o que já estava marcado. `delete_event`
  e `delete_task` são anunciadas com `destructiveHint`, e a descrição manda conferir o título em
  `list_agenda` antes. Excluir card e excluir nota em definitivo continuam fora.
- **Numa série, o MCP não presume o alcance.** `update_event` e `delete_event` sem `scope` leem o
  evento antes e recusam se ele se repete. A API trata o alcance ausente como "todas", e um modelo
  que esquecesse o campo mudaria ou apagaria a série inteira sem perceber.
- O prompt de revisão do MCP, com a escrita liberada, passa a listar alterar, converter e excluir
  eventos e tarefas entre as ações que só se fazem a pedido.

### Segurança
- **A marca de IA passa ao item convertido** (INV-58). O evento que nasce de uma tarefa gerada por
  IA, ou a tarefa que nasce de um evento gerado por IA, levam a mesma marca, revisão inclusive. A
  conversão não cria marca nem a apaga, e os corpos das duas rotas não aceitam `origin`.
- **A conversão acontece numa transação, condicionada à versão lida.** Se o original foi editado
  ou apagado no meio, a API responde 404 e não grava o novo com os dados velhos (INV-04). Um
  projeto que sumiu no meio também é recusado.

### Limitações conhecidas
- **Converter uma série inteira não existe.** Tarefa não se repete, então se converte uma ocorrência
  por vez.
- **A duração do evento se perde ao virar tarefa.** De volta a evento, ele dura uma hora, a menos
  que o corpo diga outra.
- **O chat do aplicativo não edita, não exclui e não converte.** Para isso há o celular e o MCP.
- **O desktop continua só lendo a agenda.**

---

## [0.34.0] — 2026-10-09

> **Publicada em produção em 2026-10-09.** Os quatro serviços de app (API, web, MCP e móvel) foram
> redeployados, e a API aplicou a migration `20261010120000_eventos_recorrentes` no boot. Conferido
> por fora: saúde da API e do MCP, os bundles do web e do móvel com o código novo e a rota com
> escopo respondendo. Ninguém criou uma série com a conta real nem usou num Android ainda.

**Eventos recorrentes.** Um evento passa a poder se repetir toda semana, nos dias escolhidos, com
um último dia opcional. "Aula de inglês segunda, quarta e sexta das 8 às 9" é um compromisso só,
que aparece em cada um desses dias. Ele se cria pela folha do celular, pedindo ao assistente ou
pelo MCP. Editar ou excluir uma ocorrência pergunta o alcance: só esta, esta e as seguintes, ou
todas. A repetição é só semanal. Mensal e anual ficaram fora.

**Os seis pacotes se movem**, porque o contrato do evento mudou em `packages/shared`.
`packages/shared` vai de `0.19.0` para `0.20.0`, `apps/api` e `apps/mcp` de `0.20.0` para
`0.21.0`, `apps/web` de `0.27.0` para `0.28.0`, e `apps/movel` e `packages/cliente` de `0.4.0`
para `0.5.0`. A migration `20261010120000_eventos_recorrentes` é só aditiva: três colunas em
`event` e um índice parcial, `event_serie_idx`. Todo evento que já existia continua simples.

**Na janela do deploy, a API precisa estar no ar antes do MCP.** Uma API anterior a esta não
recusa a repetição: ela a descarta e cria um evento avulso. O MCP percebe isso pela resposta e
avisa o modelo, sem tentar de novo.

**O que o assistente paga a mais.** A descrição de `create_event` cresceu 525 bytes no catálogo do
chat, e a regra da série ficou só ali. A linha equivalente que ia no system prompt foi tirada, o
que devolve 148 bytes por turno. O `tools/list` do MCP foi de 14.544 para 15.069 bytes. O número
de tools não mudou.

Portões: `pnpm typecheck` limpo nos seis pacotes. A API passou com **619 testes** (eram 543) e o
MCP com **74** (eram 72). Os casos novos da API cobrem horário de verão, fim da série, ocorrências
canceladas, os três alcances, posse e escritas concorrentes com a ordem fixada.

**A interface foi conferida em navegador headless, não à mão.** O pedido que motivou a frente foi
reproduzido de ponta a ponta com um dublê do provedor: "aula de inglês seg/qua/sex 8–9 e ter/qui
17–18" virou as duas séries certas. O calendário, a lista do dia, o cartão "Criado" e a folha da
série foram conferidos em captura, e os três alcances, por roteiro. Ninguém usou a repetição num
celular de verdade.

### Adicionado
- **Repetição semanal de evento**: dias da semana escolhidos, toda semana, até um último dia
  opcional, inclusive. Os sete dias valem "todo dia". O evento que se repete dura até 24 horas,
  podendo atravessar a meia-noite, ou é de dia inteiro, de um dia só.
- **A hora da série acompanha o relógio do usuário.** As ocorrências se calculam no fuso dele, e
  uma aula às 8:00 continua às 8:00 depois da virada do horário de verão.
- **Editar ou excluir com alcance** (`PATCH` e `DELETE /events/:id`, com
  `?scope=esta|seguintes|todas` e `occurrenceDate`). "Só esta" tira aquela ocorrência da série
  e, ao editar, a grava como evento avulso. "Esta e as seguintes" encerra a série na véspera e
  começa uma nova dali. "Todas" muda ou apaga a série inteira. Sem `scope`, vale "todas", que é o
  que as rotas faziam antes.
- **"Repetir" na folha do celular**: os dias da semana, "Todo dia" e o último dia, com o resumo
  por extenso ("Toda seg, qua e sex, até 18 de dez"). Ao salvar ou excluir uma ocorrência, a folha
  pergunta o alcance, com o foco em "só esta".
- **O assistente e o MCP criam a série numa chamada só**: `create_event` aceita `repeat`, com os
  dias em siglas (`"seg"`, `"qua"`, `"sex"`) e um último dia opcional. Horários diferentes em dias
  diferentes são uma série por horário. O Desfazer do chat apaga a série inteira.
- **"repete …" em toda parte onde o evento aparece**: nos itens da agenda do celular, no
  bloco "Hoje" do web e no texto que o assistente e o MCP leem ("repete seg, qua, sex até
  2026-12-18"). No cartão "Criado" do chat, no web e no celular, a repetição tem uma linha
  própria. Um ícone novo marca a série. O sábado se mostra "sáb", com acento, e se pede `"sab"`.

### Alterado
- **`GET /agenda` e `GET /events` expandem as séries**: cada ocorrência vem no seu dia, com o `id`
  da série, `occurrenceDate` (o dia daquela ocorrência) e `recurrence` (os dias e o último dia).
  O evento simples traz `recurrence: null`.
- **`GET /events/:id` de uma série devolve a primeira ocorrência que ainda existe.** Se a primeira
  foi excluída, vem a seguinte.
- **No projeto, no celular, cada série aparece uma vez**, pela próxima ocorrência, com "repete …".
  A contagem de eventos do projeto conta a série como um.
- **Duas escritas ao mesmo tempo na mesma série não se apagam.** Uma exclusão de ocorrência
  gravada no meio de uma edição não some. A edição da série inteira que esbarra noutra escrita é
  refeita uma vez sobre o estado novo, e, se a disputa se repetir, a API responde 409. A série
  que fica sem nenhuma ocorrência é apagada.

### Limitações conhecidas
- **Os dias da semana são os do fuso em que a série foi gravada.** Uma troca de fuso que leva a
  hora para o outro lado da meia-noite faz a série andar um dia.
- **A folha do celular não cria evento de 24 horas com "Até…".** A API e o assistente aceitam.
- **Só semanal.** Repetição mensal ou anual e série de vários dias ficaram fora.
- **O chat não edita evento.** Ele cria a série e a desfaz inteira. Mudar uma ocorrência é pelo
  celular.
- **O desktop continua só lendo a agenda.** A série aparece no bloco "Hoje", mas se cria e se edita
  pelo celular ou pelo assistente.

---

## [0.33.0] — 2026-10-09

> **Publicada em produção em 2026-10-09, junto com a `[0.28.0]` a `[0.32.0]`.** Nenhuma das seis
> tinha ido ao ar. A frente subiu inteira, num push só. API, web e MCP foram redeployados, e a API
> aplicou a migration `20261009120000_agenda_eventos_tarefas` no boot. **O app móvel passou a estar
> publicado**, num serviço próprio na Railway, e a origem dele entrou em `CORS_ORIGIN` da API. O que
> esta entrada diz abaixo sobre ele não estar publicado deixou de valer. Serviço novo na Railway não
> aceita mais `railway.json`, então o do móvel foi configurado no painel com os mesmos comandos, e
> `apps/movel/railway.json` não é lido por ela. Os watch paths do web passaram a incluir
> `packages/cliente/**`, `packages/shared/**` e `pnpm-lock.yaml`, e os da API, `pnpm-lock.yaml`.
> **O MCP hospedado roda com a escrita ligada** (`MCP_ESCRITA_HABILITADA=1`): o `tools/list`
> publica as tools de escrita, inclusive `create_event`, `create_task` e `complete_task`. O
> cadastro segue fechado. **Conferido só por fora:** os health checks responderam, e o móvel, num
> navegador headless, abriu o login sem erro de CORS. Ninguém entrou com a conta real no móvel
> publicado, nem o instalou como PWA, nem o usou num Android ou com microfone.

**Frente de agenda, tarefas e o Yu-book no celular, Fase 6: o dia no Início do desktop, e o
fechamento da frente.** O Início do web ganha o bloco "Hoje", com as tarefas atrasadas e os
eventos e as tarefas do dia. A tarefa se conclui ali com um clique. O resto continua só leitura no
desktop: evento e tarefa se criam e se editam pelo celular ou pedindo ao assistente, e o próprio
bloco diz isso. A agenda e as tarefas passam a ser relidas quando a aba volta ao foco, e o que foi
feito no celular aparece no desktop sem recarregar a página.

**É a última das seis fases da frente.** Com a `[0.28.0]` a `[0.33.0]`, o Yu-book tem agenda e
tarefas próprias, ligadas a quadros como projetos. O chat e o MCP leem a agenda, marcam evento,
anotam tarefa e concluem tarefa. O app móvel tem Início, Agenda, Tarefas, Projetos e o Assistente,
com ditado por voz, e o Início do web mostra o dia. **O app móvel ainda não está publicado:** ele
tem build e `apps/movel/railway.json`, mas nenhum serviço na Railway.

**Três pacotes se movem.** `apps/web` vai de `0.26.0` para `0.27.0`, `apps/movel` de `0.3.0` para
`0.4.0` e `packages/cliente` de `0.3.0` para `0.4.0`. O móvel se move pela agenda e pelas tarefas
relidas ao voltar ao app. O resto do que mudou nele é código que subiu para o pacote, sem efeito na
tela. `packages/shared` fica em `0.19.0`, e `apps/api` e `apps/mcp` em `0.20.0`. Nenhuma rota nova,
nenhuma migration e nenhum contrato alterado.

**O que o web e o móvel repetiam foi para `packages/cliente`.** Subiram o concluir tarefa
otimista, a janela da agenda que se corrige pelo `today` da resposta, a ordem dos itens no dia, a
saudação, os dias da semana, o plural, a pergunta do dia, as chaves de cache da IA e a regra que
diz por que o chat não pode enviar. A duração padrão do evento novo, no móvel, passou a vir de
`packages/shared`, a mesma que o servidor aplica ao evento sem fim. O valor continua sendo 60
minutos.

Portões: `pnpm typecheck` limpo nos seis pacotes, e os builds do web e do móvel passaram. A API
passou com **543 testes** e o MCP com **72**, rodados na revisão final da frente, nesta árvore,
antes do último lote de ajustes. Esse lote não tocou `apps/api`, `apps/mcp` nem `packages/shared`.
O chunk inicial do web foi de 631.187 para 632.623 bytes. O bloco "Hoje" vai num chunk à parte, de
9,12 kB, que só o Início carrega. O móvel ficou em 430.306 bytes.

**A interface foi conferida em navegador headless, não à mão.** Os roteiros do último lote passaram
31 de 31. O bloco "Hoje" e a releitura ao voltar à aba estão **implementados e não verificados à
mão**. Ninguém usou o app num celular de verdade nem falou num microfone real, e o leitor de tela
não foi usado. Nenhuma fase da frente teve a interface conferida à mão.

### Adicionado
- **Bloco "Hoje" no Início do web**, ao lado de Prazos. Mostra as tarefas atrasadas (até cinco, e
  "e mais N" depois disso), os eventos do dia, com hora e projeto, e as tarefas do dia. Cada tarefa
  tem uma caixa de concluir: ela marca na hora e volta se a API recusar. O dia é o do usuário,
  dito pela API, e não o do relógio do computador. Prazo de card fica só em Prazos.
- **Resumo de amanhã** no bloco quando hoje está vazio ("Amanhã: 2 eventos, 1 tarefa"), e "Dia
  livre" quando também não há nada atrasado.
- **"Tentar de novo"** quando a agenda não carrega no bloco.
- **"de todos os workspaces"** no cabeçalho do bloco quando há workspace ativo. Evento e tarefa não
  pertencem a workspace, e o resto do Início é recortado por ele.
- **Rodapé do bloco** dizendo que se cria e edita pelo celular ou pelo assistente, com um botão
  "O que tenho hoje?". O botão abre o painel do assistente numa conversa nova, com a pergunta no
  campo, sem enviar.
- **Comando "O que tenho hoje?" na paleta**, com o mesmo efeito do botão.

### Alterado
- **A agenda e as tarefas são relidas quando a aba, ou o app, volta ao foco**, no web e no
  móvel. A tarefa concluída no celular, o evento marcado pelo MCP e a virada do dia aparecem sem
  recarregar. As outras consultas continuam sem releitura ao focar.
- **No Início do web, "Onde você parou" desceu para baixo de Prazos**, na mesma coluna. A coluna da
  direita passou a ser do bloco "Hoje".
- **O bloco "Hoje" se atualiza depois das escritas que mudam o que ele mostra.** São elas: o chat
  marcar evento ou anotar ou concluir tarefa, e, no web, renomear ou excluir um quadro ou excluir um
  workspace. Evento e tarefa mostram o nome do projeto.
- **O bloco "Hoje" não remonta quando os dados do Início chegam nem quando o workspace troca.** Um
  aviso de falha e o foco na caixa de uma tarefa continuam onde estavam.

### Limitações conhecidas
- **O desktop não cria nem edita evento e tarefa.** Ele lê a agenda e conclui tarefa.
- **O app móvel não está publicado.** Falta o serviço na Railway e a origem dele em `CORS_ORIGIN`
  da API. _(Resolvido na publicação, no mesmo dia: ver a nota no topo desta entrada.)_
- **Sem notificações nem lembretes.** O evento e a tarefa aparecem onde se olha, mas nada avisa.

---

## [0.32.0] — 2026-10-09

**Frente de agenda, tarefas e o Yu-book no celular, Fase 5: o chat redesenhado, voz e o chat no
celular.** O Assistente do app móvel, que a `[0.30.0]` deixou "em breve", passa a existir: lista de
conversas e conversa em tela cheia, com agentes, com o "Criado nesta resposta" e com ditado por
voz. O chat do web ganha o mesmo desenho e o mesmo microfone, sem mudar o que faz. Marcar evento e
anotar tarefa pela conversa já existiam desde a `[0.29.0]`; agora também dá para fazer isso falando
e pelo celular.

**Três pacotes se movem.** `apps/web` vai de `0.25.0` para `0.26.0`, `apps/movel` de `0.2.0` para
`0.3.0` e `packages/cliente` de `0.2.0` para `0.3.0`, com o núcleo do chat. `packages/shared` fica
em `0.19.0`, e `apps/api` e `apps/mcp` em `0.20.0`. A API não mudou: nenhuma rota, nenhum evento
novo do chat e nenhuma migration.

**O que os dois chats dividem foi para `packages/cliente`.** São o transporte do chat, as consultas
e mutações de conversa, o Markdown e os componentes visuais da conversa. Cada app só monta a tela e
cuida dos próprios efeitos. `marked`, `DOMPurify` e `highlight.js` saíram das dependências do web e
passaram para as do pacote. No móvel, a conversa fica num chunk próprio, para o Markdown e o realce
de código não pesarem no Início.

**O áudio do ditado não passa pelo Yu-book.** O ditado usa o reconhecimento de fala do navegador.
No Chrome, o áudio vai ao serviço do Google, e a dica do botão de microfone avisa isso. No Firefox,
que não tem a API, o botão não aparece. O texto ditado nunca é enviado sozinho: ele cai no campo, e
o usuário revê antes de mandar.

Portões, rodados no fechamento: `pnpm typecheck` limpo nos seis pacotes, e os builds do web e do
móvel passaram. As suítes da API e do MCP não foram rodadas, porque a fase não tocou `apps/api` nem
`apps/mcp`. Os totais da `[0.29.0]` continuam valendo: 543 testes na API e 72 no MCP. O chunk
inicial do web foi de 630.115 para 631.187 bytes. O do móvel foi de 418,7 kB para 430,2 kB (de
126,6 kB para 130,6 kB com gzip), e a conversa ficou num chunk à parte, de 160,3 kB (55,1 kB com
gzip).

**A interface foi conferida em navegador headless, não à mão.** Os roteiros mandaram mensagens de
verdade, no web e no móvel, a uma API local ligada a um provedor simulado. "Marca reunião com a Ana
amanhã às 15h" virou evento, com o status "agendando…", a resposta chegando aos pedaços, o cartão,
a folha de edição aberta pelo cartão no móvel e o Desfazer. Os roteiros cobriram também tarefa,
Markdown, a voz com um reconhecedor simulado e o teclado do celular simulado. Houve capturas antes e
depois, nos dois temas. Ninguém falou num microfone real nem usou o app num celular de verdade, e
o leitor de tela não foi usado.

### Adicionado
- **Assistente no app móvel.** A lista de conversas tem "Nova conversa" e deixa renomear e
  excluir. A conversa abre em tela cheia, sem a barra inferior, com voltar no cabeçalho, e o campo
  de mensagem fica preso acima do teclado. No desktop, a conversa fica numa coluna central e o
  trilho lateral continua.
- **Conversa nova no móvel** com boas-vindas pelo nome, sugestões que preenchem o campo sem enviar
  e a escolha de agente, que só é possível enquanto a conversa está vazia.
- **"Criado nesta resposta" no móvel.** O evento e a tarefa criados pelo chat abrem a folha de
  edição do app e podem ser desfeitos. Nota e card mostram só o título: o móvel não tem tela para
  eles, e quem quiser desfazê-los usa o web.
- **A agenda e os projetos do móvel se atualizam sozinhos** quando o chat cria evento, tarefa ou
  card, ou quando conclui tarefa ou card, já que o prazo do card também aparece na agenda.
- **Copiar a resposta**, no móvel.
- **Aviso no móvel quando falta modelo ou provedor**, dizendo que isso se configura nos ajustes do
  web.
- **Ditado por voz no chat**, no web e no móvel. Cada toque no microfone ouve uma fala, em
  português, e o texto aparece no campo enquanto é dito. A mensagem não é enviada sozinha. Durante
  o ditado, `Enter` encerra a fala e mantém o texto, e `Esc` descarta a fala em curso sem fechar o
  painel. Enviar no meio do ditado manda o que está à vista no campo. Uma recusa de permissão vira
  aviso. Em navegador sem reconhecimento de fala, o botão não aparece.

### Alterado
- **Chat do web redesenhado**, no painel e na tela cheia, sem mudar o que ele faz. A resposta do
  assistente fica sem caixa, com tipografia de leitura, e a pergunta num balão tingido da cor de
  destaque. O "Criado nesta resposta" virou cartões. O campo de mensagem flutua, arredondado, com
  microfone e enviar/parar em ícone. A conversa vazia saúda pelo nome e traz sugestões, inclusive
  de agenda, que preenchem o campo sem enviar.
- **O status da resposta diz a ação em curso** com rótulo e ícone ("agendando…", por exemplo), e o
  "pensando" vira três pontos animados, parados quando o sistema pede menos movimento.

### Corrigido
- **O primeiro `Ctrl+Shift+Y` depois de abrir a página não focava o campo** do assistente no web.
- **Fechar o painel do assistente perdia o foco** no web quando o painel tinha sido aberto sem nada
  focado na página. Agora o foco vai para o botão do painel.
- **A pergunta aparecia duas vezes** numa conversa nova, enquanto a resposta chegava.

### Limitações conhecidas
- **No móvel, ao reabrir uma conversa, o cartão de algo já desfeito volta a oferecer Desfazer.** O
  clique responde que o item já tinha sido excluído, e nada é apagado duas vezes. O que foi desfeito
  só fica guardado enquanto a conversa está aberta. No web, o mesmo acontece depois de recarregar a
  página, como já acontecia antes.

---

## [0.31.0] — 2026-10-09

**Frente de agenda, tarefas e o Yu-book no celular, Fase 4: a agenda e as tarefas no app móvel.**
As telas que a `[0.30.0]` deixou "em breve" ganham conteúdo. O Início passa a mostrar números
reais e o dia do usuário, a Agenda ganha calendário mensal e lista do dia, e Tarefas, Projetos e o
detalhe de cada projeto passam a existir. Uma folha única cria e edita evento e tarefa, de qualquer
tela. O Assistente do celular continua "em breve" e chega na próxima fase.

**Três pacotes se movem.** `apps/movel` vai de `0.1.0` para `0.2.0` e `packages/cliente` de `0.1.0`
para `0.2.0`, com o módulo novo de agenda. `packages/shared` vai de `0.18.0` para `0.19.0` por um
export aditivo, `minutosEntre`, a aritmética de duração entre dois horários civis que o servidor já
usava para conferir o evento. Nenhum schema nem tipo mudou, e por isso `apps/api` e `apps/mcp`
ficam em `0.20.0`. `apps/web` fica em `0.25.0`. Nenhuma migration, nenhuma rota nova.

**O web não mudou, e isso foi medido.** Os hooks de evento e tarefa, que nasceram no web para o
chat, subiram para `packages/cliente` e passaram a servir os dois fronts. O web só trocou imports, e
o chunk inicial dele saiu idêntico byte a byte (630.115 bytes, conferido por `cmp`). O
`@tanstack/react-query` virou `peerDependency` do pacote e entrou no `resolve.dedupe` dos dois
`vite.config`: duas cópias dele no bundle seriam dois contextos, e o hook do pacote não acharia o
cliente de cache do app.

**O cliente continua sem converter fuso.** O dia de hoje vem da resposta da API, no fuso do
usuário. O relógio do aparelho só escolhe qual janela pedir primeiro, e quando ele discorda da API
uma segunda consulta, já na janela certa, toma o lugar da primeira.

Portões, rodados no fechamento: `pnpm typecheck` limpo nos seis pacotes, e os builds do web e do
móvel passaram. As suítes da API e do MCP não foram rodadas: a fase não tocou `apps/api` nem
`apps/mcp`. O móvel continua num chunk só, que foi de 342 kB para 418,7 kB (de 104 kB para
126,6 kB com gzip).

**A interface foi conferida em navegador headless, contra a API local, e não à mão.** Os roteiros
cobriram: criar evento pelos atalhos, editar, concluir tarefa com a caixa marcando na hora e
voltando quando a API respondeu 500, erro 422 aparecendo no campo, excluir, Voltar fechando a folha,
"Descartar alterações?", o foco quando o item some, o filtro de Tarefas, o detalhe de projeto e o
projeto inexistente. As contagens do Início foram conferidas contra a API. Houve capturas em
390×844 e 1280×800, nos dois temas. Ninguém usou o app num celular de verdade, o Voltar foi o do
histórico do navegador e não o botão do Android, e o leitor de tela não foi usado.

### Adicionado
- **Início com números reais** no app móvel. Os quatro cartões contam o que há hoje (eventos e
  tarefas do dia), os eventos dos próximos 7 dias, os projetos com algo aberto e as tarefas abertas,
  com as atrasadas em destaque. Abaixo vêm "O seu dia", com as atrasadas no topo, e "Próximos dias".
  O tipo de cada item vai escrito (Evento, Tarefa, Prazo), e a tarefa se conclui com um toque.
- **Agenda** no app móvel: calendário mensal, com a semana começando no domingo, navegação de mês e
  "Hoje", e a lista do dia escolhido. No calendário, o tipo vem pela forma e pela cor: o evento é um
  ponto, a tarefa um anel e o prazo de card um losango, e uma legenda fica sob a grade. A grade
  anda pelo teclado (setas, Home/End, PageUp/PageDown) e muda de mês pelo deslize. O dia escolhido
  fica na URL, e recarregar volta a ele. A partir de 1024px, calendário e lista ficam lado a lado.
- **Tarefas** no app móvel: abas Abertas e Concluídas, com as abertas em grupos (Atrasadas, Hoje,
  Amanhã, Próximos 7 dias, Depois, Sem data), cada um com a contagem. O filtro por projeto vem em
  pílulas e fica na URL. A tarefa se conclui com um toque.
- **Projetos** no app móvel: os quadros, com a contagem de tarefas abertas e o próximo evento de
  cada um. O detalhe do projeto lista as tarefas abertas e os eventos dos próximos 30 dias, e o "+"
  dele já cria ligado ao projeto. Projeto apagado ou de outra conta mostra "não encontrado".
- **Folha de criar e editar evento e tarefa**, a mesma em todo o app, aberta pelo "+" da barra,
  pelo "+" do dia na Agenda ou pelo toque num item. Tem atalhos de dia (Hoje, Amanhã, o sábado
  seguinte, escolher, e "Sem data" na tarefa), de hora (dia inteiro ou sem hora, horários
  sugeridos, escolher) e de duração (30 min, 1 h, 2 h), além de projeto, local e descrição. O erro
  de validação da API aparece no campo a que se refere. Na edição há Excluir, com confirmação, e,
  na tarefa, Concluir ou Reabrir; com campos alterados, o botão vira "Salvar e concluir".
- **Fechar a folha com alteração pergunta antes** ("Descartar alterações?"), seja pelo botão, pelo
  `Esc`, pelo toque fora ou pelo Voltar.
- **O Voltar do Android fecha a folha** em vez de sair da tela que está atrás dela.
- **Falha de carregamento com "Tentar de novo"** em todas as telas novas, e um aviso quando a
  conclusão de uma tarefa é recusada e a caixa volta ao que era.

### Alterado
- **O "+" da barra do app móvel cria de verdade.** Abre como evento na Agenda e como tarefa em
  Tarefas; nas outras telas, abre no último tipo criado. A tarefa criada pela barra nasce sem data,
  e o evento nasce hoje, na próxima hora cheia.
- **Concluir uma tarefa marca na hora**, em todas as listas que a mostram, e volta se a API recusar.
  Ela sai da lista de abertas só quando a lista é recarregada, depois que a caixa marcada já
  apareceu.

---

## [0.30.0] — 2026-10-09

**Frente de agenda, tarefas e o Yu-book no celular, Fase 3: a fundação do app móvel.** Nasce
`apps/movel`, um PWA para o celular com login, casca de navegação e um Início ainda sem números.
Agenda, Tarefas, Projetos e Assistente existem como rotas "em breve" e são preenchidas nas
próximas fases. Para os dois fronts não copiarem um ao outro, o cliente HTTP, a sessão, os
primitivos de interface, os ícones e os tokens de tema saíram de `apps/web` para um pacote novo,
`packages/cliente`. O web passou a importar de lá sem mudar nada visível.

**Dois pacotes nascem e um se move.** `apps/movel` (`@yu-book/movel`) e `packages/cliente`
(`@yu-book/cliente`) nascem em `0.1.0`. `apps/web` vai de `0.24.0` para `0.25.0`.
`packages/shared` fica em `0.18.0`, `apps/api` em `0.20.0` e `apps/mcp` em `0.20.0`: o MCP só
teve um comentário corrigido para o caminho novo do cliente HTTP. Nenhuma migration, nenhuma rota
nova, nenhum contrato alterado.

**`packages/cliente` é fonte, não build.** O `exports` aponta para `src/`, e é o Vite de cada app
que compila o TypeScript dele. O pacote tem `typecheck` próprio, que entrou em `pnpm typecheck`, e
React como `peerDependency`. Ele não lê `import.meta.env`: cada app chama
`configurarApi({ baseUrl })` no `main.tsx`, e a primeira requisição feita sem isso falha e escreve
no console o que faltou.

**O web não mudou na tela, e isso foi medido.** O CSS de produção saiu idêntico byte a byte depois
da troca de imports, antes de os primitivos ganharem variantes. Capturas do Início e do Assistente
nos dois temas saíram idênticas pixel a pixel antes e depois da fase. O chunk inicial foi de
629.544 para 630.115 bytes (+571), pela `configurarApi`, pela guarda dela e pelas variantes novas
dos primitivos. O CSS foi de 77.106 para 77.801 bytes.

**O app móvel ainda não está no ar.** Para publicá-lo é preciso criar o serviço na Railway com
`apps/movel/railway.json` e `VITE_API_URL`, e acrescentar o domínio dele em `CORS_ORIGIN` da API,
que aceita origens separadas por vírgula. Os watch paths do web e do móvel precisam incluir
`packages/cliente/**`: sem isso, uma mudança só no pacote não redeploya nenhum dos dois. A sessão
entre domínios funciona no Chrome do Android. O Safari do iPhone recusaria o cookie, porque
`*.up.railway.app` está na Public Suffix List, e isso fica fora do escopo da frente.

Portões, rodados no fechamento: `pnpm typecheck` limpo nos seis pacotes e
`pnpm --filter @yu-book/mcp test` com **72 testes**. A suíte da API não foi rodada nesta fase, que
não tocou `apps/api`. Os builds do web e do móvel passaram. O móvel sai num chunk só, de 342 kB
(104 kB com gzip).

**A interface foi conferida em captura, não à mão.** O móvel foi aberto em navegador headless, com
login real contra a API local, em 390×844 e em 1280×800, nos dois temas, e a ordem de Tab foi
percorrida. Ninguém abriu o app num celular de verdade nem o instalou como PWA, e o leitor de tela
não foi usado.

### Adicionado
- **App móvel (`apps/movel`)**, um PWA instalável, porta 5174 em desenvolvimento. Login com a mesma
  sessão do web. Barra inferior flutuante com Início, Agenda, "+" central, Tarefas e Assistente,
  que vira trilho lateral a partir de 1024px. Cabeçalho com saudação e uma folha de conta com o
  tema (claro, escuro ou sistema) e o sair. Início com os quatro cartões de resumo (Hoje, Agenda,
  Projetos, Tarefas), ainda sem contagem. Agenda, Tarefas, Projetos e Assistente em estado "em
  breve". A folha do "+" mostra as opções de criar, desabilitadas.
- **Manifest e ícones do PWA:** 192, 512, `maskable` e `apple-touch-icon`, abertura em tela cheia e
  em retrato. Não há service worker, e o app não funciona offline.
- **`packages/cliente`**, com o cliente HTTP, a sessão, o foco, os ícones, os primitivos de
  interface e `tema.css`, os tokens e a base de estilo dos dois fronts.
- **Variantes novas nos primitivos:** `Dialogo` com `posicao="folha"`, que abre como folha presa à
  base da tela, e `Botao` com `tamanho="g"`. Ícone novo, `IconeHoje`.

### Alterado
- **O web passou a usar `packages/cliente`** para o cliente HTTP, a sessão, os primitivos, os
  ícones e os tokens de tema, sem diferença visível. `IndicadorSalvamento` ficou no web, porque só
  ele o usa.
- **`pnpm build` constrói também o móvel.**

---

## [0.29.0] — 2026-10-09

**Frente de agenda, tarefas e o Yu-book no celular, Fase 2: a IA e o MCP usam a agenda.** O chat e
os clientes MCP passam a ler a agenda, marcar compromissos, anotar tarefas e concluí-las, sobre a
API da `[0.28.0]`. Ainda não há tela de agenda. O único ponto da interface que a mostra é o bloco
"Criado nesta resposta" do chat.

**O modelo agora sabe que dia é.** Até aqui o prompt do assistente não dizia a data, e "amanhã às
15h" era resolvido pela data do treino do modelo. O prompt de sistema passou a terminar com
"Hoje: <dia da semana>, <data> (<fuso>)." no fuso do usuário. A hora vai como "(Agora são HH:MM.)"
no fim da última mensagem do usuário, só na requisição ao provedor: não é gravada nem aparece na
conversa. A divisão existe para não invalidar, a cada minuto, o cache de prefixo do provedor sobre
as instruções e o histórico. Vale para o chat, com ou sem agente, para a prévia do agente e para os
passos de rotina.

**Os quatro pacotes se movem**, porque `packages/shared` alterou contrato. `ChatCreated.kind`
ganhou `event` e `task`, e com eles os campos opcionais `date` e `time`. `AgendaRange` ganhou
`undatedTasks`, obrigatório no tipo. Entraram as quatro ferramentas em `FERRAMENTAS_DO_ACERVO`, o
modelo de agente "Agenda", os formatadores `formatarAgenda`, `formatarEvento` e `formatarTarefa`,
`periodoDeListAgenda`, `MAX_DIAS_DE_LIST_AGENDA` (31), `LIMITE_TAREFAS_SEM_DATA` (50) e
`novoDiaCivilSchema`. Versões: `packages/shared` de `0.17.0` para `0.18.0`, `apps/api` de `0.19.0`
para `0.20.0`, `apps/web` de `0.23.0` para `0.24.0` e `apps/mcp` de `0.19.0` para `0.20.0`, no
`package.json` **e** no construtor do `McpServer`. Nenhuma migration.

**O chat sem agente ficou mais caro por turno.** As quatro ferramentas entram no catálogo que o
chat sem agente envia ao provedor em toda mensagem: ele foi de 8 para 12 ferramentas, de 6.003
para 9.358 bytes. É um custo aceito, porque marcar compromisso e anotar tarefa são pedidos de
conversa comum. Agente criado do zero não ganha nenhuma delas, nem a de leitura. No MCP, o
`tools/list` com escrita ligada foi de 11 para 15 tools e de 10.482 para 14.544 bytes. O
`prompts/list` foi de 757 para 766 bytes.

**Ordem de deploy:** API antes do MCP. As rotas que o MCP chama já existem desde a `[0.28.0]`, e o
formatador tolera a API mais velha, que não manda `undatedTasks`: nesse caso só a lista de tarefas
sem data falta.

Portões, rodados no fechamento: `pnpm typecheck` limpo, `pnpm --filter @yu-book/api test` com
**543 testes** (eram 518) e `pnpm --filter @yu-book/mcp test` com **72 testes** (eram 60). Os
novos da API estão em `agenda-chat.test.ts` e em acréscimos a `agentes.test.ts`, `marca-ia.test.ts`
e `rotinas.test.ts`. Eles rodam com o provedor falso e cobrem a marca de IA de evento e tarefa
criados pelo chat, concluir e reabrir tarefa, `list_agenda`, a recusa de data inválida sem gravar
nada, a lista do agente como única concessão, a rotina que só lê, a linha "Hoje" e a hora no fim do
turno, e uma guarda contra `$ref` no JSON Schema das ferramentas. Os do MCP estão em
`agenda.test.ts` e `prompts.test.ts`.

**A interface foi conferida em parte.** Uma captura em navegador headless mostrou o bloco "Criado
nesta resposta" com um evento e uma tarefa, e o Desfazer apagando o evento. Ninguém conferiu o
Desfazer da tarefa, os rótulos de ação durante a resposta, o texto de `complete_task` no editor de
agente, o modelo "Agenda" no quadro de modelos nem os dois temas. Nenhum teste conversa com um
modelo de verdade: que um modelo real resolve "quinta que vem" pela linha "Hoje" e pergunta a hora
ambígua ainda não foi observado.

### Adicionado
- **`list_agenda`**, no chat e no MCP: a agenda de um período de até 31 dias, dia a dia, com
  eventos, tarefas, cards com prazo e tarefas atrasadas. No fim vêm as tarefas abertas sem data.
  Dias e horas saem no fuso do usuário. Período invertido ou longo demais é recusado com uma frase
  que o modelo consegue corrigir, e no MCP isso acontece antes de chamar a API.
- **`create_event`** e **`create_task`**, no chat e no MCP: criam compromisso e tarefa com dia e
  hora locais do usuário, convertidos pela API. O quadro faz as vezes de projeto. Os dois nascem com
  a marca de conteúdo gerado por IA, como card e nota.
- **`complete_task`**, no chat e no MCP: conclui ou reabre uma tarefa, sem criar nem apagar nada.
  A conclusão fica marcada como feita por IA, como a do card.
- **As quatro estão no chat sem agente** e disponíveis para qualquer agente. Rotinas recebem só
  `list_agenda`, porque os passos de rotina só leem.
- **Modelo de agente "Agenda"**, uma secretária que marca compromissos, anota tarefas e diz o que
  vem pela frente. Ele confere a agenda antes de marcar, avisa conflito e pergunta o projeto quando
  nenhum quadro bate.
- **Regras de agenda nas instruções do assistente:** datas relativas se resolvem pela linha
  "Hoje". Dia e hora são os do usuário, sem conversão de fuso. Hora ausente, vaga ou ambígua num
  compromisso leva a uma pergunta, nunca a uma hora inventada. O que é do dia todo vai sem hora, e
  na tarefa a hora é opcional. Um horário só é dado como livre depois de consultar `list_agenda`.
- **`GET /agenda` traz `undatedTasks`:** as 50 tarefas abertas sem data mais recentes, em toda
  consulta, independentemente do período.
- **Evento e tarefa no bloco "Criado nesta resposta" do chat**, com ícones próprios (calendário e
  caixa de marcar), o dia e a hora locais ao lado do título e o Desfazer, que exclui o item. Não há
  "abrir": evento e tarefa ainda não têm tela no desktop.
- **Rótulos de ação no chat** para as quatro ferramentas: "consultando a agenda", "agendando",
  "criando tarefa" e "concluindo tarefa".

### Alterado
- **O prompt de sistema termina com o dia de hoje** no fuso do usuário, e a última mensagem do
  usuário enviada ao provedor termina com a hora. Isso vale para o chat, a prévia do agente e os
  passos de rotina.
- **A regra "crie só a pedido" cita só o que a lista de ferramentas cria.** Um agente que só anota
  tarefa não lê mais "crie nota ou card". A frase "só conclui ou reabre" passou a citar card e
  tarefa conforme a lista.
- **O prompt `revisao_semanal` do MCP lê também `list_agenda`** da semana. Tarefa atrasada passou a
  abrir a resposta junto do prazo vencido. A regra de escrita depende da sessão: com a escrita
  liberada, o prompt diz que pode propor criar evento, criar tarefa e concluir tarefa; numa sessão
  só de leitura, ele diz que a sessão só lê e não oferece tool de escrita nenhuma.
- **Agente novo não vem com `list_agenda` ligada**, embora ela seja de leitura. Quem quer agenda
  liga a ferramenta ou parte do modelo "Agenda".

---

## [0.28.0] — 2026-10-09

**Frente de agenda, tarefas e o Yu-book no celular, Fase 1: o domínio.** O Yu-book passa a ter
agenda e lista de tarefas próprias, por enquanto só na API. Evento é compromisso com dia e,
opcionalmente, hora. Tarefa é o to-do solto, que não é card: não tem coluna nem posição. Os dois
podem pertencer a um quadro, que faz as vezes de projeto. Nenhuma tela, nenhuma ferramenta do chat e
nenhuma tool do MCP enxergam isso ainda: as próximas fases da frente trazem a IA e o MCP, e depois um
app próprio para o celular.

**O cliente não converte fuso.** Evento e tarefa entram e saem em dia (`AAAA-MM-DD`) e hora
(`HH:MM`) locais do usuário. O servidor converte pelo fuso salvo em `/ajustes`, nunca pelo do
navegador nem pelo do processo. O evento devolve também os instantes (`startsAt`, `endsAt`), para
ordenar. A data da tarefa é civil: "para 12/10" é do dia 12 em qualquer fuso, e o fuso só decide o
que é hoje, e com isso se a tarefa está atrasada.

**Só `packages/shared` e `apps/api` se movem.** O contrato cresceu sem alterar nada que já existia:
entraram os módulos `eventos.ts` e `tarefas.ts`, `horaLocal` em `agenda.ts` e `BoardRef` em
`kanban.ts`. `apps/web` e `apps/mcp` não importam nada disso nem mudaram uma linha, e se movem nas
fases em que passarem a consumir o contrato novo. Versões: `packages/shared` de `0.16.0` para
`0.17.0` e `apps/api` de `0.18.0` para `0.19.0`. `apps/web` fica em `0.23.0` e `apps/mcp` em
`0.19.0`.

**Uma migration aditiva**, `20261009120000_agenda_eventos_tarefas`. A tabela `event`, que existia
desde a migration inicial sem nenhuma rota que gravasse nela, ganha `board_id` e as oito colunas da
marca de IA de card e nota. Nasce a tabela `task`, com data civil (`DATE`), hora opcional, conclusão
com marca de quem concluiu e a mesma marca de IA. Excluir o quadro solta o evento e a tarefa, sem
apagá-los. Nenhum dado existente muda.

Portões, rodados no fechamento: `pnpm typecheck` limpo e `pnpm --filter @yu-book/api test` com
**518 testes** (eram 449). Os 69 novos estão em `eventos.test.ts` e `tarefas.test.ts` e cobrem
CRUD, validação de horário, fuso (a mesma data e hora em São Paulo e em Tóquio viram instantes
diferentes e voltam iguais), o fim que anda com o início no `PATCH`, a consulta por intervalo, a
agenda agregada, a marca de IA, a posse e a cascata. `apps/mcp` não mudou, e seus 60 testes não
foram rodados de novo.

### Adicionado
- **Eventos:** `GET /events?from&to`, `GET /events/:id`, `POST /events`, `PATCH /events/:id` e
  `DELETE /events/:id`. O evento tem dia inteiro de um ou vários dias, ou início e fim com hora. Sem
  hora de término, dura uma hora. Um fim anterior ao início, sem dia de término, atravessa a
  meia-noite ("das 22h à 1h"). A duração máxima é de 14 dias. Tem também local, endereço
  `http(s)`, descrição e quadro.
- **A consulta por período pega o evento que atravessa a borda:** `GET /events` devolve o que se
  sobrepõe à janela, não só o que começa nela. A janela vai até 62 dias, que é um mês com as semanas
  das bordas.
- **`PATCH` de evento que preserva a duração:** mudar só o início arrasta o fim junto, e mudar o dia
  de um evento de vários dias leva o vão inteiro. Trocar o título não recalcula os instantes.
- **Tarefas:** `GET /tasks?status&boardId` (abertas, concluídas ou todas, filtráveis por quadro),
  `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id` e `DELETE /tasks/:id`. A tarefa tem data e
  hora opcionais (hora só com data) e devolve `overdue` quando está aberta com data anterior a hoje.
- **`PATCH /tasks/:id/complete`** conclui e reabre a tarefa, como o card: a marca de quem concluiu,
  quando foi o assistente, segue o estado.
- **`GET /agenda?from&to`:** tudo o que um calendário desenha num período, numa requisição só. Traz
  os eventos que se sobrepõem a ele, as tarefas com data nele, as tarefas atrasadas de antes dele e
  os cards abertos e não arquivados com prazo no período. O dia do card é contado no fuso do
  usuário. A resposta leva o `timezone` e o dia de hoje nele, para o cliente não precisar do
  relógio do aparelho.
- **Marca de conteúdo gerado em evento e tarefa**, a mesma de card e nota: gravada só pelo servidor,
  na criação, e o `origin` do MCP aceito na criação e na conclusão. Ainda não há quem a grave. O
  chat e o MCP chegam na próxima fase.
- **Quadro como projeto:** `boardId` em evento e tarefa. Quadro de outra conta responde 404, como
  inexistente, e um quadro excluído no meio da escrita também.

---

## [0.27.0] — 2026-09-30

**Frente de cards, Parte 2: anexos de arquivo no card.** Um card passa a guardar imagens, PDFs,
textos, documentos do Office e zips. O banco guarda só o que se lista: nome, tipo e tamanho. O
arquivo mora num bucket compatível com S3, que em produção é um Railway Storage Bucket. Com isto
a frente de cards, de duas partes, fica fechada.

**Os anexos são opcionais no servidor.** Sem as variáveis do bucket, a API sobe igual e o resto do
card funciona. O painel do card diz que os anexos estão indisponíveis e por quê. É a mesma
degradação que a frente de IA garante sem a chave do provedor (RNF-03 do PRD de IA).

**A IA e o MCP só leem os anexos.** O quadro diz quantos anexos cada card tem, e o detalhe traz o
nome, o tipo e o tamanho de cada um, sem nunca trazer um endereço. Nenhuma ferramenta nova entrou:
o servidor MCP continua publicando onze tools, e nem o chat nem um cliente MCP anexa ou apaga
arquivo.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. Entrou o módulo de
anexos: os limites `MAX_BYTES_ARQUIVO` (25 MB), `MAX_ARQUIVOS_CARD` (20) e `MAX_NOME_ARQUIVO`, a
lista `TIPOS_DE_ARQUIVO`, `ACEITA_ARQUIVO`, `ehImagem`, `formatarBytes` e os tipos `CardFile`,
`CardFileWithUrl` e `CardFilesResponse`. `CardSummary` ganhou `fileCount` e `CardDetail` ganhou
`files`, os dois obrigatórios no tipo. `ERROR_CODES` ganhou `ARMAZENAMENTO_INDISPONIVEL`,
`ARQUIVO_GRANDE` e `TIPO_NAO_PERMITIDO`. A descrição de `get_board` em `FERRAMENTAS_DO_ACERVO` e os
formatadores de card mudaram, e com eles o texto que o MCP e o chat leem. Versões: `packages/shared`
de `0.15.0` para `0.16.0`, `apps/api` de `0.17.0` para `0.18.0`, `apps/web` de `0.22.0` para
`0.23.0` e `apps/mcp` de `0.18.0` para `0.19.0`, no `package.json` **e** no construtor do
`McpServer`.

**Duas dependências novas em `apps/api`.** `aws4fetch` assina os pedidos ao bucket (SigV4) sobre o
`fetch`, no lugar do SDK da AWS. `@fastify/multipart` recebe o arquivo e está registrado só nas
rotas de anexo. O resto da API continua aceitando só JSON.

**Uma migration aditiva**, `20260930180000_frente_cards_anexos`: tabela `card_file`, com chave
estrangeira para `card` em cascata e chave de objeto única. Nenhum dado existente muda.

**Ordem de deploy:** criar o bucket no projeto da Railway, referenciar as variáveis `S3_*` no
serviço da API e subir a API antes do MCP. O MCP formata o detalhe de card sem quebrar contra uma
API mais velha, mas só mostra anexos depois que ela sobe.

Portões, rodados no fechamento: `pnpm typecheck` limpo, `pnpm --filter @yu-book/api test` com
**449 testes** (eram 408) e `pnpm --filter @yu-book/mcp test` com **60 testes** (sem testes novos,
só o fixture de card acompanhou o tipo). Os 41 novos da API estão em `arquivos.test.ts` e rodam
contra um dublê local de S3, em `node:http`, na porta 39334.

**Nenhum teste chega a um bucket real.** Em produção o bucket usa o estilo virtual-hosted (bucket no
subdomínio), e a suíte usa o estilo de caminho, porque subdomínio de `127.0.0.1` não resolve. O
endereço virtual-hosted tem só teste de unidade da URL montada. A assinatura, o `Content-Disposition`
e a URL pré-assinada contra o Railway Storage Bucket de verdade ficam para o primeiro deploy.

**A interface foi implementada e não verificada.** Nenhum portão cobre `apps/web`, e ninguém abriu a
tela. Faltam conferir a seção de anexos no painel (Anexar, soltar arquivo, miniaturas, erro de tipo
e de tamanho), a imagem ampliada e o Esc que fecha só ela, baixar e excluir, o contador na face do
card nos dois temas, as confirmações de exclusão e a gaveta de links que não abre mais ao arrastar
um arquivo.

### Adicionado
- **Anexos no painel do card.** Uma seção "Anexos" com o botão "Anexar" e uma área onde se solta o
  arquivo. Imagens aparecem em miniatura e abrem ampliadas num diálogo, e os outros tipos aparecem
  pelo nome e pelo tamanho. Cada anexo se baixa e se exclui dali, e a imagem, pelo diálogo. O Esc
  fecha a imagem ampliada sem fechar o card.
- **Contador de anexos na face do card**, com um ícone próprio, ao lado do progresso do checklist.
  O leitor de tela ouve "N anexos".
- **Tipos aceitos:** imagens PNG, JPEG, WebP e GIF, PDF, texto (`.txt`, `.md`, `.csv`), Word,
  Excel e PowerPoint (`.docx`, `.xlsx`, `.pptx`) e zip. Até 25 MB por arquivo e 20 por card.
- Rotas `GET /cards/:id/files`, que lista os anexos com endereços de leitura válidos por uma hora,
  `POST /cards/:id/files`, que recebe um arquivo por vez em multipart, e
  `DELETE /cards/:id/files/:fileId`.
- **O texto que o MCP e o chat leem cita os anexos.** No quadro (`get_board`), "N anexo(s)" na face
  do card. No detalhe, uma linha com nome, tipo e tamanho de até dez anexos, e a contagem do resto.
  A descrição de `get_board` passou a dizer que o quadro traz quantos anexos cada card tem.
- Variáveis opcionais da API para o bucket: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` e `S3_REGION` (padrão `auto`), documentadas em `apps/api/.env.example`.
  `S3_PATH_STYLE` existe só para o dublê da suíte.

### Alterado
- **Excluir um card, uma coluna com os cards, um quadro ou um workspace apaga também os arquivos dos
  anexos no bucket**, depois que a exclusão se confirma no banco. Se o bucket falhar, a exclusão
  vale do mesmo jeito, e o arquivo que ficou para trás vai para o log do servidor (INV-64).
  Arquivar um card não apaga nada.
- As confirmações de exclusão de card, de coluna com cards, de quadro e de workspace dizem que os
  anexos vão junto.
- Arrastar um arquivo, ou uma imagem de outra página, não abre mais as zonas de soltura da gaveta de
  links: arquivo é anexo. Um link que é uma imagem, como a miniatura de um vídeo no Chrome, também
  deixa de abri-las, e se salva pela gaveta.

### Segurança
- **O tipo do anexo é decidido pelos bytes, e não pelo nome nem pelo que o navegador declarou.** A
  extensão só desempata onde os bytes não bastam: os formatos do Office, que são zip por dentro, e
  texto, que precisa ser UTF-8 válido e sem byte nulo. Executável, HTML e SVG são recusados, porque
  os dois últimos rodam script quando abertos no navegador.
- **O nome do arquivo não escolhe nada no bucket.** A chave do objeto é montada pelo servidor, e o
  nome original, higienizado e com a extensão ajustada ao tipo detectado, serve só para exibir e
  para o nome do download.
- O arquivo é gravado com o tipo detectado e com `Content-Disposition`: imagens abrem no navegador,
  e o resto sempre baixa.
- **Posse e teto são conferidos antes de ler o corpo.** Card de outra conta responde como o
  inexistente (INV-02, INV-03), e card cheio recusa sem receber os 25 MB. Upload limitado a 20 por
  minuto.
- Excluir anexo leva a posse no próprio `DELETE` (INV-04). Dois pedidos simultâneos não apagam duas
  vezes, e o segundo recebe 404.
- A leitura não passa pela API nem pelo token: o navegador lê do bucket por um endereço assinado
  que expira em uma hora. O MCP e o chat nunca recebem esse endereço.

---

## [0.26.0] — 2026-09-30

**Frente de cards, Parte 1: o estado de concluído.** Card ganha um estado de concluído que não
depende da coluna. **Concluir não move o card:** ele fica onde estava, esmaecido, sai dos prazos da
tela inicial e deixa de ser ideia elegível de rotina. Concluem o usuário, o chat e um cliente MCP.
Quando é a IA, o card guarda quem concluiu, numa marca separada da marca de geração.

**É uma numeração nova, e não se converte nas outras.** A frente de cards tem duas partes; a Parte
2, anexos de arquivo no card, vem depois. Não é fase de produto, nem etapa da frente de IA (A a G),
nem etapa do MCP, que segue na 4 de 5. Não tem PRD nem identificadores próprios: os `RN-xx` e
`RF-xx` citados abaixo são os do PRD de IA, de onde vêm as regras da marca.

**É a primeira escrita do chat que não é criação.** Até aqui o chat criava card e nota e mais nada.
Agora também conclui e reabre card, sempre a pedido. Continua sem mover, apagar e editar texto.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. Entraram
`cardCompleteSchema`, `CardCompleteInput` e `AiCompletion`. `CardSummary`, e com ele `CardDetail`,
ganhou `completedAt` e `aiCompletion`, os dois obrigatórios no tipo. `cardUpdateSchema` aceita
`completed`. `FERRAMENTAS_DO_ACERVO` ganhou `complete_card`, que entrou em `FERRAMENTAS_DO_CHAT` e
`FERRAMENTAS_SEM_AGENTE`. Versões: `packages/shared` de `0.14.0` para `0.15.0`, `apps/api` de
`0.16.0` para `0.17.0`, `apps/web` de `0.21.0` para `0.22.0` e `apps/mcp` de `0.17.0` para
`0.18.0`, no `package.json` **e** no construtor do `McpServer`.

**Uma migration aditiva**, `20260930120000_frente_cards_concluido`: quatro colunas anuláveis em
`card` (`completed_at`, `ai_completed_via`, `ai_completed_author` e `ai_completed_agent_name`).
Nenhum card existente fica concluído.

Portões, rodados no fechamento: `pnpm typecheck` limpo, `pnpm --filter @yu-book/api test` com
**408 testes** (eram 383) e `pnpm --filter @yu-book/mcp test` com **60 testes** (eram 57). Dos 25
novos da API, 14 estão em `marca-ia.test.ts`, 5 em `kanban.test.ts`, 3 em `agentes.test.ts`, 2 em
`rotinas.test.ts` e 1 em `dashboard.test.ts`. Os 3 do MCP estão em `marca.test.ts`.

**A interface foi implementada e não verificada.** Nenhum portão cobre `apps/web`, e ninguém abriu a
tela, nem à mão nem em navegador headless. Faltam conferir o check na face do card (mouse, Tab e
leitor de tela), o esmaecido nos dois temas, o botão Concluir/Reabrir e a linha de conclusão no
painel, o desfazer da face quando o servidor recusa, e o quadro e a home se atualizando depois que o
chat conclui. Fica para a conferência à mão do operador.

### Adicionado
- **Concluir e reabrir card, à mão.** Um check no canto da face do card aparece ao passar o mouse ou
  ao chegar pelo Tab, e fica aceso enquanto o card está concluído. O painel do card ganhou o botão
  "Concluir"/"Reabrir" no rodapé. O check não abre o painel nem começa arraste, e a face muda na
  hora, sem esperar o servidor. Se o servidor recusar, ela volta e um aviso explica.
- **Card concluído fica no quadro, esmaecido**, na mesma coluna e posição. O prazo continua
  visível, no tom neutro, e não aparece como vencido. O leitor de tela ouve "concluído" no nome do
  card.
- **O painel diz quando e por quem**: "Concluído em …" e, quando foi a IA, "por IA", o agente, se
  houver, e se veio do chat ou do MCP.
- **Marca de quem concluiu.** Quando o chat ou um cliente MCP conclui, o card guarda a via, o autor
  (o modelo que respondeu, ou o nome do cliente MCP) e o agente da conversa. Ao contrário da marca
  de geração, ela acompanha o estado: reabrir o card, ou concluí-lo à mão depois, a apaga.
- **Ferramenta `complete_card`**, que conclui um card, ou o reabre com `completed: false`, sem
  movê-lo. O servidor MCP passa a publicar onze tools, seis delas de escrita, e esta fica atrás da
  mesma trava das outras cinco. O chat sem agente a recebe. Um agente só a recebe se ela for
  marcada no editor, e os agentes existentes continuam sem ela. **Rotina não conclui:** a
  ferramenta sai da lista dos passos, que só leem.
- Rota `PATCH /cards/:id/complete`, com `{ completed, origin }`, que é a porta do servidor MCP.
  `PATCH /cards/:id` passou a aceitar `completed`, que é a porta do front e não grava marca.

### Alterado
- **Card concluído sai dos prazos da tela inicial**, de vencidos, de próximos e dos totais, como o
  arquivado (RF-11). Reaberto, volta.
- **Ideia concluída não é elegível para rotina por coluna.** Fica na coluna de entrada, porque
  concluir não move, e o "Rodar agora" e o agendamento a pulam.
- **O texto que o MCP e o chat leem diz que o card está concluído.** No quadro (`get_board`),
  "concluído" vem logo depois do título e antes do prazo, para que um prazo passado não seja lido
  como atraso. No detalhe do card, uma linha nova diz o dia da conclusão e, se foi a IA, por onde,
  o agente e quem. A descrição de `get_board` passou a dizer que o card concluído continua na
  coluna.
- As instruções do assistente trocaram "não move, não apaga nem edita nada" por "só conclui ou
  reabre card, e só a pedido", com um bloco próprio que diz que concluir não é mover para "Feito".
  Sem `complete_card` na lista do agente, o texto de antes fica inteiro.
- O prompt de revisão do MCP inclui concluir cards entre as ações que o modelo só propõe.
- Concluir e reabrir não são revisão do texto. A marca de geração de um card gerado por IA não vira
  "revisada" (RN-11), e card humano concluído pela IA continua humano.
- Card arquivado também se conclui, e volta ao quadro concluído ao ser desarquivado.
- **Concluir de novo não troca a data nem quem concluiu**, por nenhuma das portas. A condição sobre
  o estado vai no próprio `UPDATE` (INV-04). Dois pedidos simultâneos, como o clique no quadro e o
  chat, não sobrescrevem a primeira conclusão.

### Segurança
- **A marca de quem concluiu é gravada só pelo servidor.** `PATCH /cards/:id` recusa `origin`
  sozinho com 422 e o ignora junto de `completed`. `PATCH /cards/:id/complete` aceita só a origem
  `mcp`, e a origem de chat vinda no corpo dá 422. O chat grava a sua pela origem que o servidor
  monta a partir da conversa, nunca pelos argumentos do modelo.
- `PATCH /cards/:id/complete` confere a posse pela cadeia até o quadro (INV-03). Card de outra
  conta responde como o inexistente (INV-02), pela rota e pelo chat, e não muda.

---

## [0.25.1] — 2026-09-28

**Repositório público.** O `README.md` virou a vitrine do projeto, em inglês, e a documentação
interna saiu do repositório. Não há código de aplicação nesta entrega.

**Nenhum pacote se move.** Nada em `apps/` nem em `packages/` mudou, nem contrato nem comportamento.
Os quatro ficam onde a `[0.25.0]` os deixou: `packages/shared` em `0.14.0`, `apps/api` em `0.16.0`,
`apps/web` em `0.21.0` e `apps/mcp` em `0.17.0`. O heading sobe um patch só para marcar a entrega.

Sem portão a rodar: nenhum arquivo que o `pnpm typecheck` ou as suítes de teste leem mudou.

### Adicionado
- Capturas de tela da aplicação em `.github/assets/`, referenciadas pelo README: editor com o
  assistente, kanban, gaveta de links, editor e execução de rotina, editor de agente, painel de uso
  e o servidor MCP num cliente externo.

### Alterado
- O `README.md` foi reescrito em inglês para quem visita o repositório: funcionalidades,
  arquitetura, destaques de engenharia, como o projeto foi construído com agentes e skills do
  Claude Code, stack, como rodar, deploy e limitações conhecidas. O relato por etapa, em português,
  saiu inteiro; o que mudou em cada entrega continua neste arquivo.
- As instruções de projeto (`CLAUDE.md`), os agentes em `.claude/agents/` e a skill de changelog
  passaram a tratar `docs/` como local e o README como vitrine.

### Removido
- `docs/` saiu do repositório e entrou no `.gitignore`: PRDs de fase e da frente de IA, o
  histórico de decisões, planos e anotações. Os arquivos continuam existindo fora do git. Os
  commits anteriores a esta entrega ainda os contêm, e é por lá que os links das entradas antigas
  abrem.

---

## [0.25.0] — 2026-09-25

**AI usage dash (fase 2 de 2).** Uma seção nova em `/ajustes/uso` mostra o que **o Yu-book gravou**
em `ai_usage`: uma linha por chamada ao provedor, inclusive as que falharam, com tarefa, modelo,
custo, origem do custo e o vínculo com nota, conversa ou execução de rotina. É a segunda metade do
plano de 2026-09-25, e **com ela o plano de duas fases do painel de uso está fechado**. A primeira,
o Dashboard OpenRouter da `[0.24.0]`, mostra o que o provedor conta. As duas continuam separadas
pela origem do dado, e os números não precisam bater dia a dia.

Como a `[0.24.0]`, **não é etapa da frente de IA** (A a G), nem fase de produto, nem etapa do MCP,
que segue na 4 de 5. Não tem PRD nem identificadores próprios.

**Só leitura.** Não há migration nem coluna nova, e nada vai ao provedor. Por isso a rota não tem
limite próprio, e vale o global.

**A Fase 1 foi conferida com dado real.** O operador criou a chave de gerenciamento em 2026-09-25.
Saldo, histórico de 30 dias e métricas foram vistos com a resposta real do provedor. Os três ajustes
que isso revelou estão abaixo, em "Alterado" e "Corrigido".

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. Entraram em
`packages/shared/src/ia.ts` `PERIODOS_DE_USO`, `PeriodoDeUso`, `aiUsageQuerySchema`, `AiUsageQuery`
e os tipos da resposta: `AiUsageReport`, `AiUsageTotals`, `AiUsageDay`, `AiUsageByModel`,
`AiUsageByTask`, `AiUsageByCostSource`, `AiUsageError` e `AiUsageCall`. Em
`packages/shared/src/agenda.ts`, `somarDias` passou a ser exportada. A mudança é só aditiva.
Versões: `packages/shared` de `0.13.0` para `0.14.0`, `apps/api` de `0.15.0` para `0.16.0`,
`apps/web` de `0.20.0` para `0.21.0` e `apps/mcp` de `0.16.0` para `0.17.0`, no `package.json`
**e** no construtor do `McpServer`. **O MCP não mudou de comportamento:** em `apps/mcp/src` só mudou
a versão.

Portões, relatados pela sessão de implementação: `pnpm typecheck` limpo,
`pnpm --filter @yu-book/api test` com **383 testes** (eram 362), 19 deles na suíte nova
`uso-ia.test.ts` e 1 novo em `openrouter-painel.test.ts`, e `pnpm --filter @yu-book/mcp test` com
**57 testes**, como antes.

**A tela foi conferida em Chrome headless pela sessão, não à mão pelo operador.** `/ajustes/uso`
foi vista em 7, 30 e 90 dias nos dois temas, e os números bateram com uma consulta direta ao banco.
`/ajustes/openrouter` foi vista com a chave de gerenciamento real. O foco do seletor de período foi
conferido pelo teclado, com a resposta atrasada. **O botão "conversa" das últimas chamadas não foi
exercitado na tela**, e com ele a guarda do INV-56. As dívidas estão em
[`docs/historico.md`](docs/historico.md).

### Adicionado
- **Seção "AI usage dash"** em `/ajustes/uso`, depois de "Dashboard OpenRouter" no painel de
  Ajustes. Ela lê só `ai_usage`, o que o Yu-book gravou, e nada do que o provedor conta.
- **Período de 7, 30 ou 90 dias**, num seletor segmentado. O período fica na URL (`?dias=30`), e
  sobrevive ao recarregar. Trocar de período mantém o anterior na tela até o novo chegar.
- **Os dias são os do usuário**, no fuso de `/ajustes`, pelo dia local que cada chamada gravou
  (INV-50), e nunca pela hora de criação. É o mesmo dia do teto e do "Gasto de hoje" do cabeçalho.
  A janela termina hoje, inclusive, e a legenda diz o fuso.
- **Resumo:** gasto no período, com a variação contra o período anterior do mesmo tamanho, chamadas,
  falhas e a taxa, tokens de entrada e de saída e duração média.
- **Avisos sobre o número:** quanto do gasto é estimativa, porque o provedor não informou o custo,
  e quantas chamadas ficaram sem custo nenhum, gravadas com zero e fora do teto.
- **Gasto por dia**, em barras, com zero nos dias sem chamada.
- **Tabelas por modelo, por tarefa e por origem do custo.** O modelo é o que o provedor de fato
  serviu (`modelUsed`), e o pedido (`modelId`) só quando o provedor não disse qual serviu. Por
  tarefa, as três aparecem sempre, com zero. Por origem, provedor, estimado e desconhecido, cada uma
  com o que significa.
- **Erros mais comuns**, até cinco, por frequência. Só aparece quando houve falha.
- **Últimas 50 chamadas**, com quando, tarefa, modelo, tokens, custo, duração e status em texto
  (RNF-09). O custo estimado ou desconhecido leva etiqueta. Cada linha leva à origem: a nota, a
  execução de rotina ou a conversa, que abre no painel lateral. Com uma resposta chegando, a
  conversa em curso não é trocada (INV-56).
- **O painel se atualiza sozinho** depois de uma mensagem do chat, de uma execução de rotina e de
  um formatar nota, inclusive quando o formatar falha, porque a falha também grava. Trocar o fuso
  também o recarrega.
- Rota `GET /ai/usage?days=7|30|90`, autenticada. Sem `days`, vale 30. Outro valor dá 422.

### Alterado
- **Dashboard OpenRouter:** o saldo negativo ganhou a explicação "o uso já passou do crédito
  comprado". O provedor devolve `total_credits` 0 numa conta free tier que nunca comprou crédito, e
  o saldo é comprado menos usado.
- **Dashboard OpenRouter:** a métrica de cache passou a se chamar "Cache". Quando é negativa, que é
  o desconto do cache, aparece como "economia de US$ …".

### Corrigido
- **Dashboard OpenRouter:** o valor negativo de cache aparecia como "Gasto com cache: -US$ 0,0003",
  com o sinal fácil de perder na leitura.
- **Formatar nota que falhava não atualizava o "Gasto de hoje"** até passarem 30 s. A falha também
  grava custo, e o gasto do dia agora é recarregado ao fim da ação, com ou sem sucesso.

### Segurança
- `GET /ai/usage` filtra pelo usuário em todas as consultas (INV-01). Ao contrário das três rotas do
  Dashboard OpenRouter, que mostram a conta do provedor a qualquer conta autenticada, esta só mostra
  o que o próprio usuário gastou.

---

## [0.24.0] — 2026-09-25

**Dashboard OpenRouter (fase 1 de 2).** Uma seção nova em `/ajustes/openrouter` mostra o que **o
provedor** diz sobre a chave e a conta: gasto, teto, cota gratuita e, com uma chave de gerenciamento
opcional, saldo, histórico de 30 dias e métricas. Pedido do operador em 2026-09-25, num plano de
duas fases. A segunda, o painel de uso sobre `ai_usage`, que lê o que **o Yu-book** gravou, vem
depois e fica separada pela origem do dado.

**Não é etapa da frente de IA** (A a G), nem fase de produto, nem etapa do MCP, que segue na 4 de 5.
Não tem PRD nem identificadores próprios. O NO5 do PRD de IA, que proibia painel de gastos, está
revogado desde a `[0.10.0]`, e este painel continua aquela decisão.

**Só consulta.** Nada é gravado, não há migration, nenhuma chamada faz inferência, e nenhuma entra
no teto diário, porque o provedor não cobra por elas.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. Entraram em
`packages/shared/src/ia.ts` os tipos `OpenRouterKeyInfo`, `OpenRouterKeyReport`,
`OpenRouterAccount`, `OpenRouterDailyCost`, `OpenRouterModelActivity`,
`OpenRouterProviderActivity`, `OpenRouterMetric` e `OpenRouterMetrics`, e as constantes
`OPENROUTER_LIMIT_RESETS` e `OPENROUTER_METRIC_FORMATS`. A mudança é só aditiva. Versões:
`packages/shared` de `0.12.0` para `0.13.0`, `apps/api` de `0.14.0` para `0.15.0`, `apps/web` de
`0.19.0` para `0.20.0` e `apps/mcp` de `0.15.0` para `0.16.0`, no `package.json` **e** no
construtor do `McpServer`. **O MCP não mudou de comportamento:** em `apps/mcp/src` só mudou a
versão.

Portões, relatados pela sessão de implementação: `pnpm typecheck` limpo e
`pnpm --filter @yu-book/api test` com **362 testes** (eram 341), 21 deles na suíte nova
`openrouter-painel.test.ts`. A suíte do MCP não foi rodada, porque nada do que ela cobre mudou.

**A tela foi conferida em Chrome headless pela sessão, não à mão.** Os blocos da chave (gasto, teto
e cota gratuita) e o aviso de falta da chave de gerenciamento foram vistos com a chave real, nos dois
temas. **Os blocos de conta, histórico e métricas só foram vistos com respostas simuladas.** Ninguém
os viu com dado real, porque a chave de gerenciamento ainda não existe. As dívidas estão em
[`docs/historico.md`](docs/historico.md).

### Adicionado
- **Seção "Dashboard OpenRouter"** em `/ajustes/openrouter`, último item do painel de Ajustes, com
  o botão "Atualizar" e a hora da consulta.
- **Com a chave de inferência de sempre**, por `GET /key` no provedor:
  - o gasto da chave hoje, na semana, no mês e no total. Dia, semana e mês são **UTC**, e a tela diz
    isso, porque o "Gasto de hoje" do cabeçalho conta no fuso do usuário. O gasto com chave própria
    de provedor (BYOK) só aparece quando existe;
  - o teto da chave, com a barra do restante, a periodicidade da renovação e a expiração, ou a frase
    "Sem teto na chave";
  - a cota diária de requisições a modelos gratuitos, em UTC, e a etiqueta "free tier" quando o
    provedor classifica a conta assim.
- **Com a chave de gerenciamento**, na variável nova e opcional `OPENROUTER_MANAGEMENT_KEY`:
  - o saldo da conta, com o comprado e o usado (`/credits`);
  - os últimos 30 dias em barras por dia, com uma tabela por modelo (requisições, tokens de
    entrada, saída e raciocínio, custo) e outra por provedor (`/activity`). A janela termina ontem,
    porque o provedor só fecha dia completo;
  - as métricas dos 30 dias até agora, hoje incluído: requisições, gasto, tokens, taxa de acerto de
    cache, latência média, gasto com busca na web e com cache (`/analytics/meta` e
    `POST /analytics/query`). Aparecem só as que o provedor anuncia.
- **Sem a chave de gerenciamento**, um aviso diz o que falta, onde criá-la e em que variável da API
  defini-la. A chave de inferência continua mostrando os três primeiros blocos.
- Rotas `GET /ai/openrouter/key`, `GET /ai/openrouter/account` e `GET /ai/openrouter/metrics`,
  autenticadas e com limite de 10 por minuto. São três para que cada bloco carregue e falhe sozinho.

### Alterado
- Quando o provedor recusa a chave de gerenciamento (401 ou 403), a mensagem nomeia essa chave e
  sugere conferir se ela é mesmo uma management key, em vez de dizer "a chave configurada".

### Segurança
- **A chave de gerenciamento nunca chega ao navegador.** Nenhuma das duas chaves aparece nas
  respostas, e a tela decide o aviso por um booleano.
- **A chave de gerenciamento só lê.** No provedor, ela cria e apaga chaves. Aqui só vai a quatro
  caminhos fixos: `GET /credits`, `GET /activity`, `GET /analytics/meta` e
  `POST /analytics/query`, que é consulta. `/keys` fica de fora, e o compilador recusa outro
  caminho.
- Os identificadores de conta que `GET /key` devolve (`creator_user_id`, `organization_id`,
  `workspace_id`) não são copiados para a resposta. O rótulo `sk-…` da chave continua redigido pela
  mesma regra de `GET /ai/health`.
- **Risco declarado:** qualquer conta autenticada veria o saldo e o histórico da conta OpenRouter do
  operador. É seguro enquanto o Yu-book for single-user com `ALLOW_SIGNUP` fechado.

---

## [0.23.0] — 2026-09-25

**Etapa G da frente de IA: pesquisa externa.** O agente passa a olhar para fora do acervo, de dois
jeitos, ambos ligados agente a agente. A **busca na web** usa o plugin do OpenRouter, na primeira
chamada de cada mensagem ou passo de rotina. A ferramenta **"Abrir página"** lê status, título e
texto de uma página pública. O que veio da web aparece como fonte clicável no chat e na seção
"Fontes" da saída da rotina. Requisitos na seção 5.9 de
[`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md): RF-70 a RF-74, RN-24 a RN-26, RNF-12 e
CA-43 a CA-46.

É a quinta e última etapa do [plano de agentes de acervo](docs/plano-agentes-de-acervo.md) (C a G).
**Com ela a frente de agentes de acervo está entregue**, mas sem conferência à mão e sem publicação.
Por decisão do operador, três itens do plano ficaram fora: a gaveta de links como entrada de rotina,
a rotina "Garimpar ideias" e as fontes RSS. O porquê do plugin, do opt-in e da saída única está em
[`docs/historico.md`](docs/historico.md). Não é fase de produto nem etapa do MCP, que segue na 4
de 5.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. `ChatSource` virou
união com `{ kind: "web"; url; title }`. Entraram `chaveDaFonteDoChat`, `FERRAMENTAS_DA_WEB`,
`NomeDeFerramentaDaWeb`, `NomeDoAssistente`, `DEFINICOES_DO_ASSISTENTE` e `FERRAMENTAS_SEM_AGENTE`,
e `FERRAMENTAS_DO_CHAT` passou a `NomeDoAssistente[]`. Também entraram `webSearch` na entrada e no
resumo do agente, `webSearchMicros` na prévia, `MAX_RESULTADOS_DA_BUSCA`,
`CUSTO_ESTIMADO_BUSCA_MICROS` e `CHARS_ESTIMADOS_DA_BUSCA`, o evento `busca` em `ChatEvent`,
`agentWebSearch` no passo da rotina e `sources` no passo da execução. Versões: `packages/shared`
de `0.11.0` para `0.12.0`, `apps/api` de `0.13.0` para `0.14.0`, `apps/web` de `0.18.0` para
`0.19.0` e `apps/mcp` de `0.14.0` para `0.15.0`, no `package.json` **e** no construtor do
`McpServer`. Uma migration aditiva, `20260925180000_ia_etapa_g_web`, com `ai_agent.web_search` e
`ai_routine_run_step.sources`.

**O MCP não mudou de comportamento** (RF-74). Em `apps/mcp/src` só mudou a versão. `open_page` mora
num objeto separado de `FERRAMENTAS_DO_ACERVO` e não tem handler no MCP, e o plugin de busca é só
do assistente da API. Os tamanhos medidos batem com a `[0.22.0]`: `tools/list` com escrita em
9601 B.

Portões, relatados pela sessão de implementação: `pnpm typecheck` limpo nos quatro pacotes,
`pnpm --filter @yu-book/api test` com **341 testes** (eram 279) e `pnpm --filter @yu-book/mcp test`
com **57 testes**, como antes.

**Entregue sem conferência de interface à mão.** Nada do que é tela nesta entrada foi visto
funcionando. **O custo real da busca também não foi medido**: nenhuma chamada com o plugin saiu para
o provedor. O roteiro de cinco itens e o que medir em produção estão em
[`docs/historico.md`](docs/historico.md).

### Adicionado
- **Busca na web por agente** (RF-70, RN-25). O interruptor "Busca na web" vem desligado. Ligado,
  a primeira chamada ao provedor de cada mensagem do chat, e de cada passo de rotina, leva o plugin
  de busca do OpenRouter, com o motor Exa e até 5 resultados. As voltas do laço de ferramenta não
  buscam de novo. A busca parte do pedido, e o modelo não escolhe o termo.
- **"Abrir página"** (`open_page`, RF-71). A ferramenta lê status HTTP, título e texto de uma página
  pública. Aceita HTML, texto, JSON e XML, até 8 s e 1 MB, com o charset do cabeçalho. O texto sai
  sem script nem estilo, cortado em 20 000 caracteres, e entra no contexto cercado como dado. Falha
  vira explicação para o modelo, não erro. É opt-in: nem agente novo nem o Assistente sem agente a
  recebem. Num passo de rotina ela vale, por ser de leitura.
- **Fontes da web** (RF-72). As páginas abertas e as citações da busca aparecem como fontes com
  link externo no chat, ao vivo e no histórico. Cada passo da execução de rotina guarda e mostra as
  próprias fontes. O card ou a nota que a rotina gera ganha a seção `### Fontes`.
- **Custo da busca antes de salvar** (RF-73). O editor e a prévia do agente mostram quanto a busca
  soma à primeira chamada de cada mensagem: a tarifa mais os tokens estimados dos resultados. A
  estimativa da rotina também soma a busca.
- **Na interface:**
  - no editor de agente, o grupo **"Na web"**, com os interruptores "Busca na web" e "Abrir
    páginas", o custo e o aviso de que tratar a web como dado é instrução, não garantia;
  - um aviso de risco no editor quando o agente abre páginas e também lê o acervo;
  - o selo "busca na web" na galeria de agentes e na apresentação do agente;
  - "buscando na web…" e "abrindo página…" enquanto a resposta não chega;
  - no painel do passo da rotina, "Abrir uma página" e o selo "busca na web" entre as ferramentas,
    o aviso de que a busca manda o texto do passo ao motor de terceiro e um alerta quando o agente
    abre páginas e também lê o acervo;
  - o ícone de globo, desenhado à mão.

### Alterado
- O chat sem agente recebe uma lista explícita de ferramentas, sem as da web. O que ele oferece não
  mudou.
- A instrução de sistema do agente com acesso à web ganhou três regras (RN-24, RN-26). O que vem da
  web é dado e nunca instrução, LinkedIn nunca se abre, e nada que venha da web concede ferramenta.

### Segurança
- **Fechada uma brecha de DNS rebinding na leitura de título dos links** (RNF-12, CA-45). Antes, o
  IP era conferido com um `lookup` e o `fetch` resolvia o nome de novo. Um domínio que respondesse
  com um endereço público na conferência e com um privado na conexão chegava à rede interna. Agora
  a conexão vai ao IP conferido. A saída para URL de terceiro virou uma só, com os mesmos limites de
  antes para o título (2 s, 512 KB, só HTML).
- **A mesma saída serve o "Abrir página".** Só endereço público, IP literal conferido sem resolver,
  redirecionamento manual revalidado a cada salto, orçamento de tempo total e corte duro de bytes
  depois da descompressão (gzip, deflate e br).
- **LinkedIn nunca é lido** (RN-26, CA-46). `linkedin.com`, os subdomínios e `lnkd.in` são
  recusados antes de qualquer requisição sair.
- **A busca conta no teto antes de conectar** (RN-25). A estimativa com tarifa e resultados entra no
  teto diário, no teto por execução e na recusa (402) de "Rodar agora". Quando o provedor manda só
  tokens, a tarifa se soma ao custo registrado.
- **O que vem de terceiro não planta nada.** O título e a URL de uma fonte web entram na seção
  "Fontes" com `[`, `]`, `(` e `)` codificados, e nenhum deles cria `[[wikilink]]`. Os títulos
  perdem caracteres de controle e têm teto de 300 caracteres. No chat, o link só vale com `http` ou
  `https` e abre com `noopener noreferrer`.
- **Risco residual declarado.** A cerca "é dado" é forjável. Um agente com "Abrir página" e leitura
  do acervo pode ser induzido a mandar dado do acervo na query string de um endereço. A mitigação é
  o opt-in e o aviso, e não garantia. A busca na rotina manda o texto do passo ao motor de busca de
  terceiro.

---

## [0.22.0] — 2026-09-25

**Etapa F da frente de IA: agendamento de rotinas.** A rotina da Etapa E passa a rodar **sozinha**,
em dias da semana e horários escolhidos, no fuso de `/ajustes`, sem expressão cron à vista. Quem
dispara é um relógio dentro da própria API. Cada horário roda no máximo uma vez, mesmo com as duas
instâncias que convivem no deploy. Uma recusa no início tenta de novo, e uma execução que começou
nunca se repete. O Início mostra o que as rotinas fizeram desde a última visita. Requisitos na seção
5.8 de [`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md): RF-65 a RF-69, RN-20 a RN-23 e
CA-38 a CA-42.

É a quarta etapa do [plano de agentes de acervo](docs/plano-agentes-de-acervo.md) (C a G). A
próxima é a G, pesquisa externa. O trabalho de fundo já existia desde a E, e a F decidiu só **quem
dispara**. O porquê de um agendador interno, e não o cron da Railway, está em
[`docs/historico.md`](docs/historico.md). Não é fase de produto nem etapa do MCP, que segue na 4
de 5.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato. Entram o módulo novo
`agenda.ts` (`scheduleSchema`, `instanteLocal`, `proximosHorarios`, `horariosDevidos`,
`proximaTentativa`, `problemasDaAgenda`) e `schedule` na rotina, que é opcional na entrada e parcial
no PATCH. Entram também `schedule` e `nextRuns` em `RoutineSummary`, `trigger`, `scheduledFor` e
`attempts` em `RoutineRunSummary`, o status `pulada`, `routineRunsSeenSchema` e `rotinas` em
`Dashboard`. Versões: `packages/shared` de `0.10.0` para `0.11.0`, `apps/api` de `0.12.0` para
`0.13.0`, `apps/web` de `0.17.0` para `0.18.0` e `apps/mcp` de `0.13.0` para `0.14.0`, no
`package.json` **e** no construtor do `McpServer`. Uma migration aditiva,
`20260925150000_ia_etapa_f_agenda`. Ela não toca no índice parcial
`ai_routine_run_uma_em_andamento_idx`.

**O MCP não mudou de comportamento.** Em `apps/mcp/src` só mudou a versão. Rotinas e agendas ficam
fora do MCP (RF-62), e `formatarDashboard` ignora o bloco `rotinas`. Os tamanhos medidos batem com a
`[0.21.0]`: `tools/list` com escrita em 9601 B.

Portões, medidos no fechamento: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos
quatro pacotes e `pnpm --filter @yu-book/mcp test` com **57 testes**, como antes.
`pnpm --filter @yu-book/api test` com **279 testes** (eram 240), relatado pela sessão de
implementação. A suíte do agendador roda no banco real.

**Entregue sem conferência de interface à mão.** Nada do que é tela nesta entrada foi visto
funcionando. `apps/web` continua sem runner de teste. O roteiro de cinco itens está em
[`docs/historico.md`](docs/historico.md).

### Adicionado
- **Agenda da rotina** (RF-65). Dias da semana e até quatro horários `HH:MM`, sem repetir, no fuso
  do usuário. A agenda ligada exige pelo menos um dia e um horário. Hora que não existe por causa do
  horário de verão roda na primeira hora que existe depois dela, e hora repetida roda uma vez só.
- **Pausar e retomar** (RF-66) com um clique, sem perder dias e horários. O PATCH aceita só
  `{ schedule: { active } }`. Na tela, o botão grava só esse campo, mesmo com outras alterações não
  salvas no editor.
- **Próximas execuções** (RF-67): os três próximos horários em `nextRuns`, vazios quando a rotina
  está pausada ou inválida.
- **A execução diz quem a disparou** (RF-68): `manual` ou `agenda`, com o horário previsto e o
  número de tentativas.
- **Status `pulada`**: o horário cujo início foi recusado em todas as tentativas, com o motivo da
  última. Enquanto ainda há tentativa, a tela diz quando será a próxima.
- **Bloco Rotinas no Início** (RF-69), carregado sob demanda. "Desde a última visita" lista as
  execuções terminadas depois do marco, de qualquer gatilho, até 10, com o que geraram e o link para
  o card ou a nota. Falha e pulada aparecem em destaque. Também traz os próximos horários de todas as
  rotinas. Sem marco, entram as das últimas 24 horas. `POST /ai/runs/seen` grava o marco, **por
  conta** e não por navegador, e o marco só anda para frente.
- **Na interface:**
  - seção **Agenda** no editor de rotina: interruptor "Rodar sozinha", dias em pílulas com
    `aria-pressed`, horários e a prévia "Próximas" com o nome do fuso. A agenda faz parte do
    rascunho, com salvar explícito;
  - selo "Agendada · próxima …" ou "Pausada" no cabeçalho do editor, com Pausar/Retomar;
  - a galeria mostra a próxima execução ou "Pausada";
  - no painel contextual, um relógio marca a rotina agendada, e um alerta com ícone e texto marca a
    última execução `falhou`, `pulada` ou `interrompida`;
  - o histórico e a tela de execução mostram o gatilho e as tentativas. Uma `pulada` mostra só o
    resumo, com o motivo.

### Alterado
- `GET /dashboard` passa a trazer `rotinas` (`novas`, `proximas`, `vistoEm` e `ate`). O bloco não
  segue o workspace ativo, porque rotina não tem workspace.
- "Rodar agora" segue igual, com os mesmos códigos HTTP. Por dentro, o início da execução passou a
  receber o gatilho.

### Segurança
- **Um horário, no máximo uma execução** (RN-20, CA-38). A garantia vem do índice único
  `(routine_id, scheduled_for)` e de escritas condicionais, não da memória do processo (INV-60).
  Valem as duas instâncias do deploy.
- **Recusa tenta três vezes, execução nunca se repete** (RN-21, CA-39, CA-40). A recusa no início
  pode vir de outra execução em andamento, de falta de ideia, do teto do dia ou de rotina inválida.
  Nesses casos a rotina tenta de novo a cada 5 minutos, no máximo 3 vezes, e depois fica `pulada`.
  Recusa não chama o provedor. Uma execução agendada que começou e falhou não é repetida. Os tetos
  diário e por execução e a regra de uma execução por vez (RN-19) valem como no "Rodar agora".
- **Janela de recuperação de 15 minutos** (RN-22). Um horário perdido com a API fora por mais tempo
  que isso não roda. A janela também não alcança horário anterior à última gravação da rotina.
  Ligar a agenda, retomar ou editar não dispara o horário que acabou de passar.
- **Nada falha calado** (RN-23). Execução agendada que falha ou é pulada aparece no histórico, no
  painel do Assistente e no Início. Uma rotina com defeito não impede as outras de rodar.
- O relógio da agenda para no SIGTERM, e a API espera a volta em curso terminar antes de encerrar as
  execuções vivas. Assim nenhum horário começa uma execução nova durante o desligamento.

---

## [0.21.0] — 2026-09-25

**Etapa E da frente de IA: rotinas com "Rodar agora".** Uma rotina encadeia agentes numa sequência
fixa, orquestrada pelo código. Ela parte da próxima ideia de uma coluna **ou de um pedido** escrito
nela, passa por cada passo e deixa o resultado num card novo **ou numa nota nova**, sem publicar
nada fora do Yu-book. A execução **roda no servidor e não depende da aba**: "Rodar agora" responde
na hora, e a tela acompanha ao vivo e pode ser fechada e reaberta. Requisitos na seção 5.7 de [`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md):
RF-54 a RF-64, RN-16 a RN-19, RNF-11 e CA-29 a CA-37.

**A etapa foi entregue em 2026-09-24 e emendada em 2026-09-25**, antes de qualquer publicação,
depois da primeira conferência do operador no editor. A emenda trouxe a entrada por pedido (RF-63), a
saída em nota (RF-64) e o conserto do layout do editor. Ela move o mesmo conjunto de pacotes que a
entrega original, e por isso entra nesta versão em vez de abrir a `[0.22.0]`. O porquê está em
[`docs/historico.md`](docs/historico.md).

É a terceira etapa do [plano de agentes de acervo](docs/plano-agentes-de-acervo.md) (C a G). A
próxima é a F, agendamento. **A decisão de trabalho assíncrono, que o plano previa para a F, foi
tomada nesta etapa** e revoga "sem trabalho assíncrono, por decisão". O motivo e o preço estão em
[`docs/historico.md`](docs/historico.md). Não é fase de produto nem etapa do MCP, que segue na 4 de 5.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato (o módulo novo
`rotinas.ts`, `AiMark.routineName` e `AiMark.runId`, `rotina` em `AiTask` e em `AiVia`,
`TAREFAS_COM_MODELO`, `OrigemIA` como união discriminada por via e quatro códigos de erro; na
emenda, `inputKind`/`outputKind` na rotina e na execução, `outputNoteId`, o título `fixo`,
`MODELOS_DE_ROTINA` no lugar de `MODELO_DE_ROTINA`, `primeiraLinha` e `resumoDoPedido`):
`packages/shared` de `0.9.0` para `0.10.0`, `apps/api` de `0.11.0` para `0.12.0`, `apps/web` de
`0.16.0` para `0.17.0` e `apps/mcp` de `0.12.0` para `0.13.0`, no `package.json` **e** no
construtor do `McpServer`. A emenda não bumpa de novo. Quatro migrations aditivas:
`20260924215552_ia_etapa_e_rotinas`, `20260924224021_ia_etapa_e_pulso`,
`20260924233000_ia_etapa_e_uma_execucao` e, da emenda, `20260925133313_ia_etapa_e_pedido`. A
terceira cria o índice único parcial `ai_routine_run_uma_em_andamento_idx`, que vive fora do
`schema.prisma` e que a quarta não toca.

**O MCP não mudou de comportamento.** Em `apps/mcp/src` só mudou a versão. Rotinas ficam fora do
MCP (RF-62), e a única mudança que o MCP enxerga é a linha da marca "via rotina «nome»", que vem de
`packages/shared/src/formato.ts` e ganhou teste. Com a emenda, a nota de saída de rotina chega ao
MCP pela mesma linha. Os tamanhos medidos batem com a `[0.20.0]`: `tools/list` com escrita em
9601 B.

Portões: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos quatro pacotes e
`pnpm --filter @yu-book/mcp test` com **57 testes** (eram 56), medidos de novo no fechamento da
emenda. `pnpm --filter @yu-book/api test` com **240 testes** (eram 200; 229 na entrega original),
relatado pela sessão de implementação.

**Conferida só em parte.** O operador abriu o editor de rotina, e o que ele viu quebrado motivou a
emenda. O conserto **não foi visto na tela**, e nada do resto foi visto funcionando: a galeria, a
execução ao vivo, o histórico, a faixa "via rotina", o pedido e a nota. `apps/web` continua sem
runner de teste. O roteiro está em [`docs/historico.md`](docs/historico.md).

### Adicionado
- **Rotinas** (RF-54). Criar, editar e excluir, com nome único por conta, descrição, Entrada, de 1 a
  6 passos de agente (pelo menos um "reescreve") e Saída. Rotas `GET|POST /ai/routines` e
  `GET|PATCH|DELETE /ai/routines/:id`.
- **Entrada** (RF-55): uma coluna de quadro, e a ideia é o primeiro card ativo dela que esta rotina
  ainda não usou; ou um pedido.
- **Entrada por pedido** (RF-63). A rotina começa direto no agente, com um texto fixo de até 4 000
  caracteres, que é a tarefa de toda execução. O passo o recebe na seção `## Pedido`. Não há ideia a
  escolher nem a consumir, e cada execução é independente.
- **Passos em dois modos** (RF-56). "Reescreve" substitui o rascunho. "Revisa" registra observações
  sem tocar nele, e elas seguem para os passos seguintes. Cada passo tem agente e instrução próprios.
- **Saída** (RF-57). Um card novo no fim de uma coluna de qualquer quadro, ou uma nota nova, com o
  texto final, a seção "Observações" (opcional) e a origem. O título vem da ideia, da primeira linha
  do texto ou de um texto fixo. Com entrada por coluna, a ideia usada é **movida** para uma coluna
  do mesmo quadro, **arquivada** ou **mantida**, conforme a rotina.
- **Saída em nota** (RF-64), para os dois tipos de entrada, num workspace escolhido ou sem workspace.
  Título que já existe ganha ` · DD/MM/AAAA HH:MM` no fuso do usuário, em vez de falhar. Se ainda
  colidir, ganha também um trecho do id da execução. A nota nasce com a marca "via rotina" e leva à
  execução que a gerou.
- **"Rodar agora"** (RF-58). `POST /ai/routines/:id/runs` responde `202 { runId }`, e a execução
  segue no servidor. `GET /ai/runs/:runId/events` é um SSE que manda primeiro o retrato do que está
  gravado e depois os eventos ao vivo. Uma execução já terminada manda o retrato e `fim`.
- **Cancelar** (RF-59): `POST /ai/runs/:runId/cancel`, com confirmação na tela. A execução termina
  `cancelada`, os passos que faltavam ficam `pulado` e a ideia fica onde estava.
- **Histórico de execuções** (RF-60): passos, texto de cada um, modelo, tokens, custo, duração,
  status e erro. Rotas `GET /ai/routines/:id/runs`, paginada, e `GET /ai/runs/:runId`.
- **A marca diz qual rotina escreveu** (RF-61). O card de saída leva a rotina e o agente na faixa,
  com o botão **"Ver execução"**. A linha "gerada por IA", que o chat e o MCP leem, diz "via rotina
  «nome»".
- **Teto por execução** (RN-17), configurado na Saída. O padrão é US$ 0,50 e o máximo US$ 10.
- **Área de rotinas dentro de Assistente**, sem item novo no trilho:
  - galeria em `/assistente/rotinas`, com a miniatura do fluxo, a última execução e "Rodar agora";
  - estado vazio com dois modelos: "Post do LinkedIn" e "Pedido direto" (entrada por pedido, um
    passo com o agente Marketing, saída em nota);
  - editor de fluxo em `/assistente/rotinas/novo` e `/assistente/rotinas/:id`, e execução em
    `/assistente/execucoes/:runId`;
  - seção "Rotinas" no painel contextual;
  - os comandos "Rotinas" e "Nova rotina" na paleta.
- **Editor de fluxo em blocos ligados.**
  - Os conectores são SVG, com um "+" que insere passo ali. Os passos se reordenam por arraste com
    alça única, ou por teclado.
  - O painel lateral muda com o bloco selecionado, e a validação é listada por bloco, com ícone e
    texto. O tipo de entrada (coluna ou pedido) e o de saída (card ou nota) são escolhidos em
    cartões de rádio, e o grupo "A ideia usada" só aparece com entrada por coluna.
  - A miniatura da galeria marca a rotina por pedido e a saída em nota.
  - A estimativa "a partir de" mostra o custo por execução.
  - Salvar é explícito, com `Ctrl+S` e guarda de saída. "Rodar agora" fica desabilitado, com o
    motivo, enquanto houver alteração não salva.
- **Execução ao vivo.**
  - A linha do tempo repete o fluxo como estado: pendente, rodando, concluído, falhou ou pulado.
  - O texto do passo chega enquanto é escrito.
  - Mostra custo contra o teto, modelo, tokens e duração, e o texto de cada passo concluído.
  - `aria-live` anuncia a troca de passo, e "Abrir card" ou "Abrir nota" aparece no fim.
- `Parte` em `components/base/` e `SeletorColuna`, extraído do editor de agente.

### Alterado
- **O gasto de rotina entra no teto diário e no painel de gasto** com a tarefa `rotina`. Ele continua
  contando mesmo depois de a rotina ou a execução ser excluída. O quadro de modelos de `/ajustes` não
  ganhou coluna `rotina`: cada passo usa o modelo do agente, ou o da tarefa `chat`.
- No chat, uma falha do teto diário ou do registro de uso que não seja estouro do teto passa a
  chegar como evento `erro` do stream. Antes ela escapava do laço como exceção. O resto do chat não
  mudou: o passo com o provedor foi extraído para ser usado também pela rotina, e os testes do chat
  seguem verdes.
- O resultado da busca traz a marca inteira, com a rotina e a execução.

### Segurança
- **A rotina escreve pelo código, não pelo modelo** (RN-16, CA-34). Nos passos, o agente só recebe
  as ferramentas de **leitura** que já tinha, mesmo tendo `create_card`. O card de saída e o destino
  da ideia são obra do código, só no fim de uma execução bem-sucedida. Execução que falha, é
  cancelada ou é interrompida não cria card nem move a ideia.
- **Dois tetos antes de cada chamada ao provedor** (RN-17, CA-31). O gasto da execução mais a
  estimativa é conferido contra o teto da rotina, e o gasto do dia contra o diário. Estourar
  qualquer um encerra a execução com `falhou`, com o motivo (`TETO_DA_EXECUCAO` ou o do diário).
  Iniciar com o teto diário atingido dá 402.
- **Uma ideia, um post** (RN-18, CA-30). Com entrada por coluna, um card com execução concluída ou
  em andamento desta rotina não é escolhido de novo, qualquer que seja a ação de consumo. Sem ideia
  elegível, a resposta é 404 `SEM_IDEIA`. Com entrada por pedido não há o que consumir, e rodar de
  novo é rodar de novo.
- **Uma execução por vez** (RN-19). Uma segunda execução dá 409 `ROTINA_EM_ANDAMENTO`, garantido
  por índice único parcial no banco, e não só pelo código.
- **Posse pela cadeia** (RN-15). Rotina, agente, colunas e o workspace da nota de saída de outra
  conta dão o mesmo 404 de um id inexistente. Pedido vazio, título "da ideia" ou ação "mover" numa
  rotina por pedido dão 422 com o motivo (CA-37). A coluna de consumidas tem de ser do quadro da entrada. Uma rotina com agente
  excluído ou coluna sumida recusa rodar com 422 `ROTINA_INVALIDA`, dizendo o motivo.
- **Nenhuma execução fica "em andamento" para sempre** (RNF-11, CA-33).
  - A execução pulsa a cada 10 s.
  - Uma execução com pulso vencido há 45 s vira `interrompida`. A conferência roda no boot, a cada
    minuto e ao iniciar outra execução.
  - O SIGTERM marca as execuções vivas como `interrompida` antes de fechar a API.
  - O cancelamento e o SSE funcionam também quando a execução roda noutra instância, pelo banco.
  - Com o card ou a nota de saída já criados, a execução termina `concluida`. A varredura acha a
    nota também pela marca, inclusive na lixeira. Se o consumo da ideia falhar, ela vem com
    o aviso `CONSUMO_FALHOU` ou `FINALIZACAO_PARCIAL`, e nunca `falhou`.

---

## [0.20.0] — 2026-09-24

**Etapa D da frente de IA: agentes especialistas.** Um agente é uma conversa com premissas. Ele tem
instruções próprias, até 10 **notas-base** do acervo que entram inteiras em toda mensagem, até 5
**fontes vivas** (os cards de uma coluna de quadro, relidos a cada mensagem), modelo próprio e uma
lista de ferramentas. O agente é escolhido ao abrir a conversa e fica com ela. O editor mostra o que
o agente recebe e quanto custa **antes de salvar**. Requisitos na seção 5.6 de
[`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md): RF-43 a RF-53, RN-13 a RN-15, RNF-10 e
CA-23 a CA-28.

É a segunda etapa do [plano de agentes de acervo](docs/plano-agentes-de-acervo.md) (C a G). A
próxima é a E, rotinas. Não é fase de produto nem etapa do MCP, que segue na 4 de 5.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato (`AiMark.agentName`,
`Conversation.agent`, o evento `inicio` do stream, `conversationInputSchema.agentId` e o módulo novo
`agentes.ts`): `packages/shared` de `0.8.0` para `0.9.0`, `apps/api` de `0.10.0` para `0.11.0`,
`apps/web` de `0.15.0` para `0.16.0` e `apps/mcp` de `0.11.0` para `0.12.0`, no `package.json`
**e** no construtor do `McpServer`. Uma migration aditiva, `20260924204516_ia_etapa_d_agentes`.

**O MCP não mudou de comportamento.** Em `apps/mcp/src` só mudou a versão: agentes ficam fora do MCP
(RF-53), e o que o MCP cria nunca tem agente, então a linha da marca sai igual. O bump vem só do
contrato. Os tamanhos medidos batem com a `[0.19.0]`: `tools/list` com escrita em 9601 B.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos
quatro pacotes, `pnpm --filter @yu-book/api test` com **200 testes** (eram 164) e
`pnpm --filter @yu-book/mcp test` com **56 testes** (eram 55).

**Entregue sem conferência de interface à mão**, como a C. Nada do que é tela nesta entrada foi
visto funcionando: a galeria, o editor com a prévia, o seletor "Conversar com", a identidade do
agente na conversa e a exportação. `apps/web` continua sem runner de teste. O roteiro de nove itens
está em [`docs/historico.md`](docs/historico.md).

### Adicionado
- **Agentes especialistas** (RF-43). Criar, editar, duplicar, exportar e excluir, com nome único por
  conta, descrição, uma de seis cores e instruções em Markdown. Rotas `GET|POST /ai/agents` e
  `GET|PATCH|DELETE /ai/agents/:id`.
- **Notas-base** (RF-44). Até 10 notas do acervo, em ordem, entram inteiras no contexto de toda
  mensagem do agente. A premissa continua sendo editada no editor de notas de sempre. Nota na
  lixeira é pulada e avisada.
- **Fontes vivas** (RF-45). Até 5 colunas de quadro, com os títulos ou as faces dos cards até um
  limite de 1 a 50, relidas a cada mensagem. O contexto diz "10 de 42 cards" quando a coluna passa do
  limite.
- **Modelo e ferramentas por agente** (RF-46, RF-47). O modelo é um favorito de `/ajustes`, ou o
  da tarefa `chat` quando não há escolha. As ferramentas são um subconjunto das do chat. Sem
  nenhuma, a requisição ao provedor vai sem `tools`, e o modelo não precisa saber chamar
  ferramenta.
- **"O que o agente recebe"** no editor (RF-48, RNF-10). Coluna fixa com a barra de uso contra o
  limite de 40 000 caracteres, os tokens aproximados, o custo estimado por mensagem de 1 a 5 passos
  do laço e a lista de blocos: incluído, cortado, na lixeira ou indisponível. Mostra também o texto
  completo. Rota nova: `POST /ai/agents/preview`, que monta o contexto de um rascunho sem gravar.
- **Conversa com agente** (RF-49). Na conversa vazia, "Conversar com" escolhe o agente, no painel e
  em `/assistente`. Depois da primeira mensagem, o agente vira identidade fixa no cabeçalho, nas
  falas e na lista de conversas. O nome fica gravado na conversa e sobrevive à exclusão do agente
  (CA-27).
- **A marca diz qual agente escreveu** (RF-50). O que um agente cria leva o nome dele na etiqueta,
  na faixa e na linha "gerada por IA · «Agente» · …" que o chat e o MCP leem.
- **Três modelos prontos** (RF-51): Especialista em LinkedIn, Marketing e Revisor. Aparecem no estado
  vazio da galeria. "Usar este modelo" abre o editor preenchido e oferece criar vazias as notas-base
  que o modelo sugere.
- **Exportar agente em Markdown** (RF-52), com frontmatter (nome, descrição, modelo, ferramentas,
  títulos das notas-base e fontes) e as instruções no corpo. Rota nova: `GET /ai/agents/:id/export`.
- **Área de agentes dentro de Assistente**: galeria em `/assistente/agentes`, editor em
  `/assistente/agentes/novo` e `/assistente/agentes/:id`, seção "Agentes" no painel contextual e os
  comandos "Agentes" e "Novo agente" na paleta. Sem item novo no trilho.
- O editor tem guarda de saída: com alterações não salvas, sair pede confirmação, e fechar a aba
  também. Salva com `Ctrl+S`.
- Primitivo `Interruptor` em `components/base/`, `CampoMarkdown` (o campo do painel do card, agora
  compartilhado), `SeletorDeNota`, `AvatarAgente`, o ícone de agente e seis cores de agente nos dois
  temas.

### Alterado
- **O prompt de sistema do chat é montado por conversa.** As regras do Yu-book (citar a origem, não
  tocar em `[[…]]`, criar só a pedido) abrem o prompt e valem para todo agente, e as instruções dele
  vêm depois sem revogá-las (RN-13). As linhas sobre cada ferramenta só aparecem se a ferramenta
  está na lista.
- **Premissas que não cabem são declaradas.** O corte é por bloco inteiro, e o chat avisa quais
  ficaram de fora, pelo evento `inicio` (RNF-04, CA-26).
- O custo estimado de cada passo do laço passa a contar as premissas, que vão em todo passo.
- **Conversa de agente excluído fica legível e para de responder.** Mandar mensagem dá 422 com o
  motivo, em vez de seguir como o Assistente sem ninguém ter escolhido.
- **Agente cujo modelo saiu dos favoritos recusa a conversa** com 422 `MODELO_NAO_ESCOLHIDO`,
  apontando o editor do agente (CA-28). Não troca de modelo calado.
- Abrir uma conversa nova com agente de fora de `/assistente`, pela galeria ou pelo painel
  contextual, é aplicado ao chegar lá. Se houver resposta em curso, aparece um aviso.

### Segurança
- **Texto não concede ferramenta** (RN-14, CA-24). A lista do agente é conferida ao oferecer as
  ações ao provedor e de novo ao executar. Uma ação pedida fora dela é recusada, mesmo que as
  instruções a peçam. Ferramenta fora do catálogo do chat dá 422 ao gravar.
- **Premissa de outra conta não existe** (RN-15, CA-25). Nota-base, coluna de fonte viva e agente
  alheios dão o mesmo 404 de um id inexistente. A coluna é conferida pela cadeia coluna → quadro →
  usuário. A prévia transforma coluna que deixou de resolver em "indisponível", sem dizer se ela é
  alheia ou apagada. Agente excluído entre a conferência e a criação da conversa também dá 404, e
  não 500.

---

## [0.19.0] — 2026-09-24

**Etapa C da frente de IA: a marca de conteúdo gerado.** Nota e card passam a guardar no dado se
foram escritos por um modelo, por qual superfície (`chat` ou `mcp`), por quem, de que conversa e
quando foram revisados à mão. É o que o NO2 revisto exigia: **nota gerada por IA passa a ser
permitida porque passa a ser marcada**. Com a marca, **o chat passou a escrever**: cria card e nota
quando o usuário pede, mostra o que criou e oferece desfazer. Qualquer resposta dele também pode
**virar nota**. Requisitos na seção 5.5 de [`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md):
RF-35 a RF-42, RN-10 a RN-12, RNF-09 e CA-17 a CA-22. A RN-03 foi emendada e a Q-04 resolvida.

É a primeira etapa do [plano de agentes de acervo](docs/plano-agentes-de-acervo.md) (C a G), que
continua as letras da frente de IA. Não é fase de produto nem etapa do MCP, que segue na 4 de 5.

**Os quatro pacotes se movem**, porque `packages/shared` mudou de contrato: `packages/shared` de
`0.7.0` para `0.8.0`, `apps/api` de `0.9.1` para `0.10.0`, `apps/web` de `0.14.0` para `0.15.0` e
`apps/mcp` de `0.10.0` para `0.11.0`, no `package.json` **e** no construtor do `McpServer`. Uma
migration aditiva, `20260924190830_ia_etapa_c_marca`.

**O que o MCP publica mudou**: são **dez tools**, cinco de escrita, e o `tools/list` com escrita foi
de **8551 B para 9601 B**. A descrição de `create_note` vem de `packages/shared/src/ferramentas.ts`,
então o chat também paga esse texto em todo turno.

Portões: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos quatro pacotes,
`pnpm --filter @yu-book/api test` com **164 testes** (relatado pela sessão de implementação) e
`pnpm --filter @yu-book/mcp test` com **7 arquivos e 55 testes** (eram 6 e 49), estes medidos de
novo no fechamento.

**Entregue sem conferência de interface à mão.** Nada do que é tela nesta entrada foi visto
funcionando: a marca nas seis superfícies, o filtro, o diálogo "Virar nota", o bloco "Criado nesta
resposta" e o Desfazer. `apps/web` continua sem runner de teste. O roteiro de oito itens está em
[`docs/historico.md`](docs/historico.md).

### Adicionado
- **Marca de origem em nota e card** (RF-35, RN-10). Guarda quando foi gerado, a superfície (`chat`
  ou `mcp`), o autor, a conversa de origem e a última revisão humana. Quem grava é só o servidor.
  O chat passa a marca por parâmetro, e o front nunca a envia.
- **O chat cria card e nota a pedido** (RF-36), pelas ações `create_card` e a nova `create_note`.
  Mover card, mandar nota para a lixeira e restaurar continuam fora do chat (RN-12, CA-21).
- **Bloco "Criado nesta resposta"** abaixo das Fontes (RF-37). Cada item leva à nota ou ao card e tem
  **Desfazer**: a nota vai para a lixeira e o card é excluído. O item desfeito fica riscado. O que
  foi criado também aparece ao vivo, enquanto a resposta ainda corre, e continua no histórico da
  conversa.
- **"Virar nota"** em toda resposta do assistente (RF-38, CA-18). Um diálogo pede título, tipo e
  workspace, e um toast oferece "Abrir". O conteúdo e o modelo saem da mensagem gravada, não do
  navegador. Rota nova: `POST /ai/conversations/:id/messages/:messageId/note`.
- **Tool `create_note` no servidor MCP** (RF-39). Fica atrás da mesma trava de escrita das outras.
  O que ela e `create_card` criam nasce marcado `via mcp`, com o nome do cliente como autor: o
  `client_name` do cadastro OAuth, que é o nome lido na tela de consentimento, ou o `clientInfo` do
  `initialize`.
- **A marca na interface** (RF-40, RNF-09): etiqueta "IA" ou "IA · revisada" na lista de notas, no
  card do kanban, na paleta de busca e no Início. No editor e no painel do card, uma faixa com
  modelo, via, dia, revisão e o link "Abrir conversa". A etiqueta e a faixa se leem pelo ícone e pelo
  texto, sem depender de cor.
- **Filtro "Geradas por IA"** na barra lateral de notas (RF-41, CA-20), com contagem, chip removível,
  estado vazio próprio e `ia=1` na URL. `GET /notes` aceita `ai=true`, e `GET /notes/counts` devolve
  o balde `ai`.

### Alterado
- **O texto que o MCP e o chat leem traz a marca.** Nota e card lidos por inteiro ganham a linha
  "gerada por IA · autor · via · dia[ · revisada em dia]". Listas, resultados de busca e o Início
  ganham só o sufixo "· IA".
- **Editar à mão o título ou o corpo** de algo gerado muda a marca para "revisada", e a origem fica
  (RN-11, CA-19). Favoritar, mover, arquivar, etiquetar ou trocar de workspace não conta como
  revisão. O formatar com IA não marca a nota (RF-42), mas o autosave do texto formatado conta como
  revisão.
- **O prompt de sistema do chat mudou.** O assistente cria só quando o usuário pede, confirma pelo
  nome o que criou e não move, não apaga nem edita.
- **`get_note` e `yubook://nota/{id}` fazem uma requisição a mais** (`GET /ai/settings`), em
  paralelo, para datar a linha da marca no fuso do usuário. Em `packages/shared`, `formatarNota`
  passou a exigir o fuso, sem valor padrão.
- `CardSummary`, `NoteSummary`, `SearchResult` e `CardComPrazo` ganharam o campo `ai`, e
  `ChatMessage` ganhou `created`. O stream do chat tem um evento novo, `criado`.

### Segurança
- **Criar ou editar nota com o `workspaceId` de outra conta era aceito.** A resposta devolvia o nome
  daquele workspace, e o id inexistente caía numa violação de FK, distinguível do alheio. Agora os
  dois dão o mesmo 404 (INV-02), em `POST /notes` e `PATCH /notes/:id`. O defeito é anterior a esta
  etapa. Ficou mais exposto porque o `workspaceId` de `create_note` no chat é escrito pelo modelo.
- `origin` só aceita `via: "mcp"`. Um cliente HTTP qualquer não consegue se passar pelo assistente
  nem apontar a marca para uma conversa alheia. Nenhuma rota de atualização aceita `origin`.

---

## [0.18.0] — 2026-09-24

**Etapa 5 de 5 do redesenho de UI/UX, a última: polimento.** Os primitivos e os tokens da Etapa 1
chegam às telas que ainda não os usavam: dashboard, notas, kanban, card, boards, gaveta de links,
paleta, login e os seletores. O dashboard e a paleta ganham conteúdo novo. A gaveta e a paleta viram
diálogos com foco preso. **Com esta entrada o redesenho está concluído**, e o fechamento das cinco
etapas vem logo abaixo. Ela leva também um ajuste de ordem na seção Modelos, da Etapa 4, feito no
fechamento.

**Entrada separada da `[0.17.0]`**, pelo mesmo precedente das anteriores: cada etapa do redesenho
tem plano, revisão e dívida de conferência próprios. Só **`apps/web` vai de `0.13.0` para
`0.14.0`**; `apps/api` fica em `0.9.1`, `packages/shared` em `0.7.0`, `apps/mcp` em `0.10.0`. Nada
fora de `apps/web` foi tocado.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos
quatro pacotes e `vite build` ok. As suítes da API e do MCP não foram rodadas: nada do que elas
exercitam mudou. O revisor não achou invariante violada. Suas observações foram corrigidas antes
desta entrada.

**Entregue sem conferência de interface à mão, pela quinta etapa seguida, e conferida no
fechamento.** Nenhuma das cinco etapas foi vista na tela antes de ser dada como entregue. Depois da
Etapa 5, ainda em 2026-09-24, **o usuário fez a conferência à mão das cinco etapas, `[0.14.0]` a
`[0.18.0]`, e relatou que tudo funcionou**. Isso inclui as correções desta entrada: o arraste de
cards do kanban e de favoritos da gaveta pelo teclado, e as duas mensagens de
`MODELO_NAO_ESCOLHIDO`. O registro é o relato do usuário, não um checklist marcado item por item.
`apps/web` continua sem runner de teste: a conferência vale para esta árvore e não vigia a próxima.

**O redesenho inteiro**, de 2026-09-24, cinco etapas, `[0.14.0]` a `[0.18.0]`, com `apps/web` de
`0.9.0` a `0.14.0` e `apps/api` em `0.9.1`:

1. **Fundação visual** (`[0.14.0]`): fonte Inter, tokens, texto miúdo a 11 px e os primeiros
   primitivos em `components/base/`.
2. **Casca e navegação** (`[0.15.0]`): trilho de áreas, painel contextual recolhível e os filtros de
   notas na URL.
3. **Assistente** (`[0.16.0]`): painel lateral que empurra o conteúdo e rota `/assistente`, duas
   vistas da mesma conversa.
4. **Ajustes** (`[0.17.0]`): `/ajustes` em três seções e o quadro de modelos arrastável.
5. **Polimento** (esta entrada).

O que fica em aberto, somado: **a janela de concorrência do arraste do kanban** e **a ausência de
runner de teste em `apps/web`**. O `useMoverCard` tem a mesma janela de mutação otimista que o
quadro de modelos fechou na Etapa 4, e não foi mexido.

### Adicionado
- **Saudação no dashboard**, pelo período do dia e com o nome, mais a data por extenso e o
  workspace ativo.
- **Bloco "Pergunte ao seu acervo" no dashboard.** Ele abre o painel do assistente numa conversa
  nova, com o texto no campo e sem enviar.
- **Bloco Boards no dashboard**, e a tela passa a uma grade: Prazos ao lado de Onde você parou, Ver
  depois ao lado de Boards. O esqueleto de carregamento segue a mesma grade.
- **Prazos com ícone e etiqueta de prioridade.** O leitor de tela ouve "Vencido:" antes de um prazo
  vencido, e o card que vence hoje diz "vence hoje".
- **Comandos na paleta (`Ctrl+K`)**: ir para cada área, nova nota, salvar link, painel do
  assistente, alternar tema e lista de atalhos. Começar a busca com `>` mostra só os comandos.
- **"Perguntar ao assistente: «texto»"**, último item da paleta. Ele abre uma conversa nova com o
  texto digitado, sem enviar.
- **Barra de ações única no editor de nota**: os quatro modos num controle segmentado, Formatar,
  Copiar, Assistente, o indicador de salvamento, favoritar e fechar.
- Cinco ícones novos, desenhados à mão: relógio, check, clipe, chevron e recarregar.

### Alterado
- **A gaveta de links vira um diálogo lateral**, com o foco preso enquanto está aberta e devolvido
  a quem o tinha ao fechar. O "Desfazer" da remoção de um link aparece dentro da gaveta enquanto
  ela está aberta.
- **A paleta vira um diálogo no topo da tela.** O `Enter` espera os resultados da busca chegarem,
  para não executar um comando por engano. Em `/assistente`, o comando do painel não interrompe a
  resposta em curso, como o atalho.
- **O tema segue o sistema até a primeira troca manual.** Antes, a primeira carga já gravava o tema
  do sistema como escolha, e mudar o sistema depois não tinha mais efeito. Agora só a troca pelo
  usuário é gravada, como pedem o RF-20 e o RF-21 da Fase 4. O tema continua aplicado antes da
  primeira pintura, sem piscar.
- **Lista de notas**: itens arredondados, o ativo em superfície com uma barra, tags em etiqueta, e o
  esqueleto na medida nova.
- **Erros do editor em aviso, o desfazer em aviso informativo e foco visível no título.**
- **Kanban**: colunas e cards com os tokens novos, glifos trocados por ícones e foco visível nos
  campos. O arraste funciona como antes.
- **Em Ajustes → Modelos, o catálogo do provedor vem antes do quadro "Modelo de cada tarefa"**
  (ajuste da Etapa 4). Quem favorita primeiro e arrasta depois lê a página de cima para baixo. Os
  textos que apontam de um para o outro acompanham: "Favorite modelos no catálogo acima" no quadro
  sem favoritos, e "Tire-o da tarefa no quadro abaixo" no catálogo.
- O painel do card, a lista de boards e o board usam os botões, avisos, esqueletos e ícones da
  Etapa 1. As zonas de soltura, o seletor de workspace, o seletor de tags, o login e o popover do
  editor passam aos tokens e aos ícones.

### Corrigido
- **O arraste de cards do kanban pelo teclado nunca começava** (RF-25 da Fase 2). O `Espaço` não
  pegava o card. O defeito vinha desde a Fase 2, que deu o requisito como entregue. A mecânica do
  arraste não mudou.
- **Na gaveta de links, o arraste de favoritos pelo teclado nunca começava.** Agora começa com
  `Espaço`, e durante o gesto as setas movem o favorito em vez de trocar de aba.
- **O botão do assistente no card não mostrava a cor dele.**
- **Trocar o tema pela paleta deixava o botão do trilho com o ícone antigo**, e o clique seguinte
  nele não fazia nada.
- **O aviso de erro ao criar e o toast de desfazer se sobrepunham.** Agora empilham.

---

## [0.17.0] — 2026-09-24

**Etapa 4 de 5 do redesenho de UI/UX: `/ajustes` em seções, com o quadro de modelos arrastáveis.**
A página única de ajustes vira três seções, Modelos, Provedor e Gasto, com um cabeçalho comum. A
tabela «Seus modelos», com um botão de rádio por tarefa, dá lugar a um **quadro**: os favoritos
numa coluna e uma coluna por tarefa, e o modelo vai para a tarefa arrastado ou pelo menu.

**Entrada separada da `[0.16.0]`**, pelo mesmo precedente das anteriores: cada etapa do redesenho
tem plano, revisão e dívida de conferência próprios. **`apps/web` vai de `0.12.0` para `0.13.0`**
e **`apps/api` de `0.9.0` para `0.9.1`**; `packages/shared` fica em `0.7.0`, `apps/mcp` em
`0.10.0`. Fora de `apps/web`, só mudou o texto das duas mensagens de um erro da API, que mandavam
marcar o modelo na tabela que esta entrada remove. O quadro usa os endpoints de tarefa e de favorito que já existiam.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo e
`vite build` ok. O `@dnd-kit` ficou num chunk compartilhado com o kanban, e o bundle inicial não
cresceu. As suítes da API e do MCP não foram rodadas. Na API, o que mudou foi só o texto de duas
mensagens, e nenhum teste confere esse texto.

**Sem conferência de interface à mão, pela quarta etapa seguida.** Nada disto foi visto na tela: o
arraste por mouse e por teclado; a recusa do chat; o menu "Usar para…"; o erro de rede com
rollback; o movimento reduzido; o catálogo; as seções e o medidor. `apps/web` continua sem runner
de teste.

_Emenda, no mesmo dia: o usuário conferiu esta etapa à mão no fechamento do redesenho e relatou
que tudo funcionou. Ver a `[0.18.0]`._

### Adicionado
- **Seções `/ajustes/modelos`, `/ajustes/provedor` e `/ajustes/gasto`**, listadas no painel
  contextual. `/ajustes` e qualquer caminho desconhecido abaixo dele levam a Modelos. Não há seção
  de aparência: o tema continua no trilho.
- **Cabeçalho comum às três seções**: o aviso de que o conteúdo sai da máquina, o **medidor do
  gasto de hoje** (barra e o texto "US$ x de y"), o aviso de chamadas sem custo, o aviso de
  provedor sem chave (RNF-03 do PRD de IA) e o erro da seção.
- **Quadro de modelos**, com uma coluna «Seus favoritos» e uma coluna por tarefa, cada tarefa com
  um lugar:
  - arrastar um favorito para uma tarefa a atribui, e o favorito continua na coluna;
  - arrastar o modelo de uma tarefa para outra o move;
  - arrastar o modelo de uma tarefa de volta para os favoritos o tira da tarefa;
  - a tarefa que precisa de ferramentas diz isso numa etiqueta sempre visível, e **o chat recusa
    modelo sem ferramentas**: durante o arraste, a coluna fica tracejada, com ícone e texto, e
    soltar ali não faz nada;
  - o arraste começa só pela alça do cartão.
- **Alternativa sem arraste**: o menu "Usar para…" de cada favorito, com as tarefas impedidas
  desabilitadas e o motivo, e "Remover dos favoritos"; e o botão "Tirar de tarefa" em cada lugar
  ocupado.
- **Arraste por teclado no quadro**: `Espaço` pega e solta, as setas pulam de coluna em coluna e
  `Esc` cancela, com anúncios em português para leitor de tela. Depois de tirar, remover ou mover,
  o foco vai para a coluna onde a mudança aconteceu.
- **O quadro responde antes da rede**: a atribuição aparece na hora e volta atrás se o servidor
  recusar. Com várias mudanças seguidas, o quadro se acerta com o servidor quando a última termina.
- **Catálogo em grade de cartões**, cada um com as tarefas que o modelo serve, e um estado de erro
  com "Tentar de novo".
- Dois ícones novos, desenhados à mão: alça de arraste e opções.

### Alterado
- **No catálogo, `Enter` ou clique num favorito o desfavorita**; antes, só favoritava.
- **Um favorito em uso por alguma tarefa não sai pelo catálogo.** Aparece uma mensagem pedindo
  que ele seja tirado da tarefa no quadro antes, porque desfavoritar também limpa a tarefa.
- **Com movimento reduzido, o cartão arrastado não anima.**
- O cartão navegado pelo teclado no catálogo não fica mais escondido sob a barra de filtros fixa.
- O link de ajustes do assistente, no aviso sem modelo de chat, leva direto a `/ajustes/modelos`.
- **As duas mensagens do erro `MODELO_NAO_ESCOLHIDO` mandam arrastar um modelo para a coluna da
  tarefa, em Ajustes → Modelos**: a de tarefa sem modelo e a de modelo que saiu dos favoritos.
  Antes, uma mandava marcar o modelo na coluna de «Seus modelos», tabela que não existe mais, e a
  outra mandava "marcar outro nos ajustes".

### Corrigido
- **O campo do teto diário aparecia vazio ou com o valor antigo** quando a página abria antes de
  os ajustes chegarem do servidor.

### Removido
- **A tabela «Seus modelos»** com um botão de rádio por tarefa, substituída pelo quadro.

---

## [0.16.0] — 2026-09-24

**Etapa 3 de 5 do redesenho de UI/UX: o assistente em painel lateral e em tela cheia.** O chat
modal da Etapa B da frente de IA sai de cena. No lugar dele, a mesma conversa tem duas vistas: um
**painel à direita** que empurra o conteúdo, sem cobri-lo, e a rota **`/assistente`** em tela
cheia. Passar de uma para a outra não interrompe a resposta em curso.

**Entrada separada da `[0.15.0]`**, pelo mesmo precedente que separou aquela da `[0.14.0]`: cada
etapa do redesenho tem plano, revisão e dívida de conferência próprios. Só **`apps/web` vai de
`0.11.0` para `0.12.0`**; `apps/api` fica em `0.9.0`, `packages/shared` em `0.7.0`, `apps/mcp` em
`0.10.0`. Nada fora de `apps/web` foi tocado.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo e
`vite build` ok, com a conversa, o painel e a página do assistente em chunks próprios. As suítes da
API e do MCP não foram rodadas: nada do que elas exercitam mudou.

**Sem conferência de interface à mão, pela terceira etapa seguida.** Nada disto foi visto na tela:
o painel empurrando o conteúdo; expandir para `/assistente` e sair dela sem interromper a resposta;
fechar o painel cancelando o `fetch`; o botão Parar; a sugestão de contexto; o `Esc` no editor e no
painel; renomear conversa pelo teclado; e o aviso sem modelo de chat. `apps/web` continua sem
runner de teste.

_Emenda, no mesmo dia: o usuário conferiu esta etapa à mão no fechamento do redesenho e relatou
que tudo funcionou. Ver a `[0.18.0]`._

### Adicionado
- **Painel do assistente** à direita, com 400 px de largura, redimensionável entre 320 e 640 px, e
  a largura lembrada entre sessões. Ele empurra o conteúdo e não é modal. O `Esc` fecha o painel
  só quando o foco está dentro dele, e o foco volta para onde estava ou para o botão do trilho.
- **Rota `/assistente`**, com a mesma conversa em tela cheia, um convite e três sugestões de
  pergunta. Expandir o painel para ela não interrompe a resposta em curso. Sair dela com resposta
  em curso abre o painel, para que a resposta continue à vista.
- **Lista de conversas agrupada** em Hoje, 7 dias e Antes, com **renomear** (RF-24, que até aqui
  não tinha tela) e excluir. As duas ações aparecem também com o foco do teclado, não só com o
  mouse.
- **Falas com avatar**, modelo e fontes consultadas em etiquetas, e um botão **Copiar** em cada
  resposta.
- **Botão Parar** no compositor, enquanto a resposta chega.
- **Sugestão de contexto**: com uma nota ou um card aberto, o compositor oferece anexá-lo. É só
  uma oferta: nada é anexado sem que se clique nela.
- **Sem provedor ou sem modelo de chat**, o compositor mostra um aviso com link para Ajustes e o
  campo fica desabilitado (RNF-03 do PRD de IA).
- **"Perguntar ao assistente"** no cabeçalho do editor de nota, depois de Formatar e Copiar, e no
  do card. O botão abre o painel com a nota ou o card já anexado.
- **Botão "Painel do assistente"** na base do trilho, que liga e desliga o painel e some em
  `/assistente`.
- **Conversas recentes no Início**, e a área Assistente ganha conteúdo próprio no painel contextual.
- Quatro ícones novos, desenhados à mão: conversas, painel direito, expandir e lápis.

### Alterado
- **O item Assistente do trilho leva a `/assistente`**, em vez de abrir o chat modal.
- **"Conversar", no menu "+", abre o painel com uma conversa nova.**
- **`Ctrl+Shift+Y` alterna o painel**, e em `/assistente` põe o foco no campo de mensagem.
- **O `Esc` global não fecha mais o chat.**
- **A resposta em curso só aparece na conversa a que pertence.** Trocar de conversa durante o
  streaming não mostra mais a resposta da outra.
- O modo de edição da nota passa a usar o ícone de lápis.

### Corrigido
- **Fechar o chat logo depois de enviar a primeira mensagem de uma conversa nova não interrompia a
  resposta**, e um segundo `Enter` nesse intervalo criava duas conversas. O defeito já existia no
  chat da Etapa B da frente de IA.

### Removido
- **O chat modal**, substituído pelo painel e pela rota `/assistente`.

---

## [0.15.0] — 2026-09-24

**Etapa 2 de 5 do redesenho de UI/UX: a casca e a navegação.** A barra lateral única dá lugar a um
**trilho de áreas** de 56 px e a um **painel contextual** ao lado dele, cujo conteúdo muda com a
área em que se está. Os **filtros da lista de notas passam a morar na URL**: o Voltar do navegador
desfaz um filtro, recarregar não o perde, e um recorte vira link. O assistente continua abrindo o
chat modal de hoje — painel lateral e rota `/assistente` são da Etapa 3.

**Entrada separada da `[0.14.0]`**, embora as duas movam o mesmo pacote e nenhuma tenha sido
publicada: é o precedente da Fase 5, cujas Etapas B e C, ambas só em `apps/web`, ficaram em
`[0.5.0]` e `[0.6.0]`. Cada etapa do redesenho tem plano, revisão e dívida de conferência próprios,
e fundidas não se saberia qual delas deixou o quê sem ver. Só **`apps/web` vai de `0.10.0` para
`0.11.0`**; `apps/api` fica em `0.9.0`, `packages/shared` em `0.7.0`, `apps/mcp` em `0.10.0`. Nada
fora de `apps/web` foi tocado.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo e
`vite build` ok. As suítes da API e do MCP não foram rodadas: nada do que elas exercitam mudou.

**Sem conferência de interface à mão, pela segunda etapa seguida.** Nada disto foi visto na tela: o
trilho e o painel nos dois temas, o menu "+" e o do avatar operados só por teclado, os filtros com
Voltar e com recarga da página, recolher e mostrar o painel (pelo botão e por `Ctrl+\`), o badge de
links, a lista de atalhos e a troca de workspace. `apps/web` continua sem runner de teste.

_Emenda, no mesmo dia: o usuário conferiu esta etapa à mão no fechamento do redesenho e relatou
que tudo funcionou. Ver a `[0.18.0]`._

### Adicionado
- **Trilho de áreas** à esquerda, com Início, Notas, Boards, **Assistente em destaque**, Links e
  Ajustes. No topo, a marca, Buscar e um menu **"+"** para criar nota, criar board, salvar link ou
  conversar; na base, atalhos, tema e o avatar com o menu **Sair**.
- **Painel contextual** ao lado do trilho, com o seletor de workspace e a busca no topo e, embaixo,
  o que a área pede: favoritas e boards no Início, filtros em Notas, a lista em Boards.
- **O painel recolhe** com `Ctrl+\` ou pelo botão, e a escolha sobrevive à recarga. Recolhido, o
  trilho mostra o workspace ativo e um ponto sobre Notas quando há filtro valendo que saiu de vista;
  o foco vai para o botão que mostra o painel de volta.
- **Filtros de notas na URL** — tipo, tags, favoritas, lixeira, busca e ordem (`/n?tipo=…&tags=…`).
  Trocar filtro entra no histórico e o Voltar desfaz; a busca atualiza no lugar, sem encher o
  histórico. Abrir, fechar e criar nota preservam o recorte. O workspace **não** vai para a URL
  (RF-02 da Fase 2).
- **Chips removíveis** no topo da lista de notas, um por filtro ativo.
- **O item Notas do trilho volta à última lista visitada**, com os filtros dela.
- **O item Links mostra quantos links estão marcados para ver depois.**
- **"Novo board", no menu "+", já chega com o cursor no campo de nome.**
- Quatro ícones novos, desenhados à mão: busca, mais, recolher e teclado.

### Alterado
- **A barra lateral única some**; o que ela oferecia se divide entre trilho e painel contextual.
- **`Ctrl+N` fora da lista de notas cria uma nota livre**, em vez de herdar o tipo que estava
  filtrado. Dentro de `/n`, continua herdando.
- A lista de atalhos (`Ctrl+/`) ganha `Ctrl+\`.
- O título "Yu-book" sai da vista e fica só para leitor de tela; a marca "Yu" do trilho o substitui.

### Removido
- O ícone de conversa, sem uso depois que o assistente passou a ter ícone próprio.

---

## [0.14.0] — 2026-09-24

**Etapa 1 de 5 do redesenho de UI/UX: a fundação visual.** Tokens, fonte e seis primitivos de
interface em `apps/web`, e as telas que já tinham consumidor para eles passando a usá-los. Nenhuma
tela foi redesenhada ainda — isso é das etapas seguintes. O que muda à vista é a tipografia, o
tamanho mínimo de texto, a forma do foco e o diálogo de atalhos.

O redesenho é uma **quinta numeração**, aprovada em 2026-09-24 e posta **antes** da Etapa C da
frente de IA: 1 fundação visual, 2 casca e navegação, 3 assistente em painel lateral e em
`/assistente`, 4 `/ajustes` com o quadro de modelos por tarefa, 5 polimento das telas. "Etapa 1" daqui
não é Etapa A ou B da frente de IA, nem etapa do MCP (que segue na **4 de 5**), nem fase de produto
(0 a 5 fechadas). Também não é o "Redesenho da navegação" de 2026-08-20, que foi outra coisa.

**Entrada separada da `[0.13.0]`**, embora nenhuma das duas tenha sido publicada: aquela moveu os
quatro pacotes, esta só `apps/web`. Só **`apps/web` vai de `0.9.0` para `0.10.0`**; `apps/api`
fica em `0.9.0`, `packages/shared` em `0.7.0`, `apps/mcp` em `0.10.0`. Nada em `packages/shared`,
na API ou no MCP foi tocado.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok e `pnpm typecheck` limpo.
Um `vite build` conferiu que todas as utilidades novas são geradas e que `.shadow-e1` resolve para
`var(--sombra-e1)`. As suítes da API e do MCP não foram rodadas: nada do que elas exercitam mudou.

**Sem conferência de interface à mão.** Não havia como entrar no app sem as credenciais do operador.
Nada disto foi visto na tela: a Inter carregando e o recuo para a fonte de sistema sem rede, o modo
ao vivo do CodeMirror com a métrica de fonte nova, os dois temas, a trava de foco do diálogo de
atalhos e o movimento reduzido. `apps/web` continua sem runner de teste.

_Emenda, no mesmo dia: o usuário conferiu esta etapa à mão no fechamento do redesenho e relatou
que tudo funcionou. Ver a `[0.18.0]`._

### Adicionado
- **Fonte Inter** na interface inteira, carregada do Google Fonts com `display=swap`. Sem rede, a
  interface cai na fonte de sistema de antes.
- **Movimento reduzido respeitado**: com `prefers-reduced-motion`, animação e transição somem.
- **O diálogo de atalhos (`Ctrl+/`) prende o foco**: `Tab` não escapa para a página de trás, o
  foco começa no título e volta a quem o tinha ao fechar (RNF-06 da Fase 1).
- **O dashboard mostra um esqueleto com a forma da tela pronta** enquanto carrega, com o mesmo
  cabeçalho, em vez de a página saltar quando os dados chegam (RNF-11 da Fase 1).
- Três ícones novos, desenhados à mão como os outros: assistente, fechar e alerta.

### Alterado
- **Texto miúdo sobe para 11 px.** Os rótulos e metadados escritos em 10 px, ilegíveis em Inter,
  passam a 11/16 — são noventa ocorrências, em quase todas as telas.
- **O contorno de foco acompanha o raio do elemento.** Antes ele trazia um raio próprio de 2 px que
  vencia o do botão, e o botão mudava de forma ao receber foco.
- **O botão de tema anuncia "Tema claro", pressionado ou não**, em vez de um rótulo que trocava com
  o estado e, lido junto do `aria-pressed`, dizia duas coisas contraditórias.
- Os avisos de `/ajustes` e o indicador de salvamento da nota e do card passam a ter a mesma forma
  nos dois lugares, e o código de bloco em Markdown usa a mesma pilha monoespaçada do resto.

### Segurança
- **A página passa a fazer requisição a uma origem de terceiros**, `fonts.googleapis.com` e
  `fonts.gstatic.com`, a cada carga sem cache: o Google vê o IP de quem abre o Yu-book. Até aqui a
  SPA só falava com a própria API. Decisão aceita, com o motivo em `docs/historico.md`.

---

## [0.13.0] — 2026-09-23

**Etapa B da frente de IA: o chat que lê.** Até esta entrada o Yu-book mandava um texto ao modelo e
recebia outro de volta. Agora **uma mensagem do usuário não é uma chamada ao provedor, são até
cinco**: o modelo pede uma ferramenta, o Yu-book executa contra o acervo, o resultado volta e ele
decide se acabou. As **nove ações** que o servidor MCP publica desde a Etapa 3 passaram a ser as
mesmas que o chat oferece ao provedor — **uma definição, dois consumidores**, em
`packages/shared/src/ferramentas.ts`. O que o MCP publica não mudou um byte: `tools/list` devolve
**8551 B com escrita e 3480 B sem**, idêntico antes e depois, comparado por JSON-RPC entre as duas
revisões.

Cobre a **Fase 3** do [`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md), RF-17 a RF-26 — e
**revoga o RF-21, a RN-04 e o CA-09** de lá, porque o laço de ferramenta é exatamente o que eles
mandavam não fazer: em vez de o chat pedir que se anexe algo, ele vai buscar. A RN-05 — toda
afirmação cita origem — continua valendo inteira, e agora é sustentada por construção: só existe
afirmação sobre o que uma ferramenta de leitura devolveu.

É a **Etapa B da frente de IA**, que é a **Fase 5 do roteiro de IA aplicada**. Não é fase de
produto — as de produto vão de 0 a 5, seguem fechadas, e a 6 (Google Calendar) não começou — e não é
etapa do MCP, que continua na **4 de 5**. Quatro numerações, nenhuma conversível na outra.

Os quatro pacotes se movem: `apps/api` e `apps/web` de `0.8.0` para `0.9.0`, `packages/shared` de
`0.6.0` para `0.7.0`, `apps/mcp` de `0.9.0` para `0.10.0` — no `package.json` **e** no construtor do
`McpServer`, que é o que ele anuncia no `initialize`. **Desta vez o MCP foi tocado de verdade**, ao
contrário das três entradas anteriores: `apps/mcp/src/formato.ts` foi apagado, as quatro superfícies
de tool passaram a ler o metadado de `packages/shared`, e `fuso.ts` nasceu. O que ele **publica**
continua o mesmo — nove tools, quatro resources, dois templates, dois prompts. `ERROR_CODES` ganhou
um membro, `MODELO_SEM_FERRAMENTA`.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos
quatro pacotes, `pnpm --filter @yu-book/api test` com **8 arquivos e 131 testes** (eram 7 e 109),
`pnpm --filter @yu-book/mcp test` com **6 arquivos e 49 testes** (eram 5 e 43),
`pnpm --filter @yu-book/web build` ok e `prisma migrate status` com o banco em dia. A suíte do MCP
foi rodada duas vezes, com `TZ=UTC` e com o fuso da máquina, `America/Sao_Paulo`: 49 passam nos
dois, que é o ponto da suíte nova.

**A sequência de seis entregas sem conferência de interface à mão termina aqui, e a conferência
cobrou na hora.** O operador abriu o painel pela primeira vez e encontrou, em minutos, um defeito
que nenhum dos portões via: a tela `/ajustes` não tinha como escolher o modelo da tarefa `chat` —
está nos **Corrigido** abaixo. Não é a dívida quitada; é ela sendo cobrada.

O que passou a estar **verificado ao vivo**, nesta árvore: o painel abre, a escolha de modelo por
tarefa funciona, o laço busca sozinho, lê a nota e cita a origem, e o gasto do dia aparece. O que
**continua sem verificação nenhuma**: o anexo pelo `@` a partir da tela, o chip de origem abrindo o
alvo, o teto cortando no meio de uma resposta, renomear e excluir conversa, e o atalho
`Ctrl+Shift+Y`. `apps/web` continua sem runner de teste — a conferência de hoje vale para a árvore
de hoje e não vigia nada amanhã. O que os 22 testes novos da API cobrem é o que está atrás da tela:
o laço, o teto por passo, o corte de anexo, o escopo por usuário, o formato dos eventos e a
convivência das duas escolhas de modelo.

**Para usar o chat é preciso marcar um modelo na coluna `chat` de «Seus modelos», em `/ajustes`.**
Enquanto não houver, o painel recusa com `MODELO_NAO_ESCOLHIDO`, e um modelo que não saiba chamar
ferramenta é recusado com `MODELO_SEM_FERRAMENTA` — na tela, esse rádio já vem desabilitado.

### Adicionado
- **Painel de chat, por `Ctrl+Shift+Y` e por botão na navegação** (RF-17). A resposta chega em
  streaming, aparecendo enquanto é gerada (RF-22).
- **O assistente lê o acervo sozinho**, chamando até cinco ferramentas por pergunta: buscar notas,
  abrir nota, listar quadros, abrir quadro, ver o dashboard, criar card, mover card, mandar nota
  para a lixeira e restaurar. São as **mesmas nove** que o servidor MCP publica, do mesmo arquivo.
  O limite de cinco passos não é economia: é o que impede um modelo em ciclo de gastar o teto do dia
  numa pergunta só.
- **Anexo por `@`**: nota, card ou quadro entram no contexto da **mensagem** (RF-18, RF-19). Nota vai
  com o corpo completo; quadro vai com as colunas e a face dos cards, o mesmo recorte que o MCP usa.
- **A resposta cita a origem** (RF-20, RN-05): o turno termina nomeando o que consultou, e cada
  fonte abre o alvo.
- **Conversas persistidas, escopadas por usuário, com renomear e excluir** (RF-23, RF-24). Excluir
  conversa não toca em nota nem em card. Cada mensagem guarda **qual modelo a respondeu** (RF-25).
- **Rotas de conversa** em `/ai/conversations`, mais `POST /ai/conversations/:id/messages` em
  `text/event-stream`. Limite de taxa próprio, 10/min: o global de 300/min por IP não protege contra
  dez pedidos de um minuto cada.
- **Migrations `20260923165733_chat_ancorado` e `20260923172226_fontes_da_resposta`**: as tabelas
  `ai_conversation`, `ai_message` e `ai_attachment`, e as fontes citadas por mensagem.
- **O servidor MCP passou a saber o fuso do usuário** (`apps/mcp/src/fuso.ts`), lido de
  `ai_preference.timezone` — a mesma fonte que decide a janela do teto diário.
- **`pnpm --filter @yu-book/mcp verificar` mostra o fuso em uso** e avisa quando ele é o padrão, em
  vez de o recuo passar calado.
- **`MODELO_SEM_FERRAMENTA`** em `ERROR_CODES`, separado de `MODELO_NAO_ESCOLHIDO` porque o que se
  pede a quem está na tela é outro: lá é escolher um modelo, aqui é trocar por um que saiba chamar
  ferramenta.

### Corrigido
- **A tela `/ajustes` não tinha como escolher o modelo do chat.** Ela trazia a tarefa `formatar`
  fixa numa constante, e a Etapa B acrescentou `chat` ao enum, ao banco e ao `PATCH /ai/tasks/:task`
  sem que a tela acompanhasse: o painel exigia uma escolha que não tinha por onde ser feita. Agora
  «Seus modelos» tem uma **coluna de rádio por tarefa**, **derivada de `AI_TASKS`** e não escrita à
  mão — a próxima tarefa aparece sozinha em vez de repetir o buraco (RF-03). Encontrado na primeira
  vez que o chat foi usado.
- **O rádio de `chat` vem desabilitado em modelo sem suporte a ferramenta**, com o motivo no
  `title`. É a recusa de `MODELO_SEM_FERRAMENTA` antecipada para antes de a pergunta ser digitada,
  em vez de depois de ela já ter sido enviada.
- **As duas mensagens de `MODELO_NAO_ESCOLHIDO` nomeiam a tarefa** e dizem em qual coluna marcar.
  Antes diziam "escolha um modelo para esta tarefa" sem dizer qual: quem olhava para um modelo
  marcado — o de formatar — concluía que o erro era falso e que a tela estava mentindo.
- **Busca sem resultado deixou de ser um beco sem saída.** Perguntado por uma receita que **está**
  no acervo, o modelo buscou `"receita de bolo"`, recebeu vazio e desistiu numa volta só — a busca é
  por palavra sobre título e corpo, e "receita" não está em "Bolo de fubá". `formatarBusca` passou a
  declarar isso e a sugerir o termo mais específico sozinho antes de concluir que não existe.
  Medido depois: a mesma pergunta passou a buscar duas vezes, ler a nota e citar a origem. **Muda as
  duas superfícies** — a mesma função imprime o resultado de `search_notes` no chat e no servidor
  MCP, então o texto que o cliente MCP recebe num resultado vazio também mudou. O que `tools/list`
  publica continua idêntico: nenhuma `descricao` foi tocada.
- **O MCP hospedado relatava todo prazo um dia à frente, calado.** Os formatadores usavam o fuso do
  **processo**: na máquina do operador isso acertava por acaso, e no serviço da Railway, que roda em
  UTC, errava sempre — o front grava o prazo às 23:59:59 locais, o que em UTC−3 é 02:59 do dia
  seguinte. Agora o dia sai do fuso **do usuário**, e a regressão é guardada por uma suíte escrita em
  `Asia/Tokyo` de propósito, que morde em qualquer máquina. O `railway.json` **não** precisa de `TZ`
  e não deve ganhar uma.
- **O catálogo das nove ações não entra mais no bundle da primeira pintura.** Ele custava 6,3 KB
  para quem só abriu o dashboard. `packages/shared` declara `sideEffects: false`, e o `search_notes`
  agora aparece só no pedaço `PainelChat`, carregado sob demanda — conferido no `dist`.

### Alterado
- **Os formatadores do acervo saíram de `apps/mcp` para `packages/shared`.** Card, quadro,
  dashboard e lista de notas são formatados pelo mesmo código nas duas superfícies, e o dia de um
  prazo passa a ser argumento em vez de efeito do ambiente.
- **O anexo pende da mensagem, não da conversa** — emenda à seção 7 do PRD. Preso à conversa, o
  histórico mentiria: uma pergunta feita antes de você anexar a nota apareceria depois como se já a
  tivesse tido. O anexo guarda uma cópia do título, para que um alvo mandado à lixeira não
  transforme a linha do histórico em três nulos.
- **O limite de contexto do chat corta por anexo inteiro**, nos mesmos 60 000 caracteres que a
  formatação já usava, e a tela diz quais ficaram de fora (RNF-04). Meia nota no contexto é o tipo
  de entrada que faz o modelo afirmar o contrário do que a nota diz. Resolve a Q-05 do PRD.
- **`apps/api` ganhou uma dependência direta**, `zod-to-json-schema`: é o que traduz o schema Zod de
  cada ação para o formato que o provedor espera no campo `tools`.

### Removido
- **`apps/mcp/src/formato.ts`**, 250 linhas, absorvido por `packages/shared/src/formato.ts`.

---

## [0.12.0] — 2026-09-23

**O operador favoritou modelos gratuitos, eles recusaram, e a trava era nossa.** Medido com a chave
dele, no mesmo modelo: com `provider: { data_collection: "deny" }` o roteamento devolve **404** —
"No endpoints found matching your data policy (Free model training)"; **sem** o bloco, **200**, custo
zero. A conta dele no provedor já permitia endpoints que treinam. Nós é que fixávamos a política em
**toda** chamada de inferência, e **endpoints gratuitos treinam com os dados**: exigir que não
treinem é exigir um endpoint que não existe. A tela ainda afirmava "o servidor pede ao provedor que
não guarde o texto para treino" como se fosse propriedade do produto, quando era escolha nossa
escondida no código — e contrária ao que o operador decidiu no começo desta frente. Agora a escolha
é dele, com a consequência escrita nos dois estados — é o que restou do RNF-01, revogado em
2026-09-22 junto com o Ollama.

**O Gemma gratuito continua fora de alcance e não é este o motivo:** ele responde **429 com e sem** a
política, saturação do endpoint gratuito. Nada aqui o conserta.

Nenhuma das quatro numerações avança. Continua sendo a **Etapa A da frente de IA**, que é a Fase 5 do
roteiro de IA aplicada; as fases de produto seguem em 0 a 5 fechadas, e o MCP na Etapa 4 de 5.

Os quatro pacotes se movem: `apps/api` e `apps/web` de `0.7.0` para `0.8.0`, `packages/shared` de
`0.5.0` para `0.6.0`, `apps/mcp` de `0.8.0` para `0.9.0` — no `package.json` **e** no construtor do
`McpServer`, que é o que ele anuncia no `initialize`. **O MCP não foi tocado** — nenhuma das nove
tools, quatro resources, dois templates e dois prompts mudou, e ele não importa nada de
`packages/shared/src/ia.ts` —, mas `AiSettings` e `aiSettingsPatchSchema` mudaram no pacote que ele
declara como dependência, e ele vai ao ar hoje construído contra o `0.6.0`. É o mesmo critério das
duas entradas anteriores: a versão de um pacote diz **contra qual contrato ele foi construído**.
`ERROR_CODES` não ganhou membro novo.

Portões, medidos nesta árvore: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos
quatro pacotes, `pnpm --filter @yu-book/api test` com **7 arquivos e 109 testes** (eram 106),
`pnpm --filter @yu-book/mcp test` com 5 arquivos e 43 testes, `pnpm --filter @yu-book/web build` ok e
`prisma migrate status` com o banco em dia.

**A interface não foi verificada à mão, e é a sexta entrega seguida nessa condição** — Etapas A, B e
C da Fase 5, a Etapa A da frente de IA, a correção do catálogo de ontem e agora esta. O interruptor e
os dois textos de consequência estão **implementados e não verificados**: `apps/web` não tem runner
de teste e nenhum portão executa uma linha de `AjustesPage.tsx`. O que os testes cobrem é o que vai
no corpo da requisição — com a política restritiva o pedido carrega `data_collection: "deny"`; com o
treino permitido ele **não carrega bloco de provedor nenhum**; e quem nunca configurou começa
proibindo. Para isso o dublê de provedor passou a guardar os corpos recebidos: antes dava para
afirmar que uma chamada saiu, não o que ela pediu.

### Adicionado
- **Interruptor "permitir que o provedor treine com o conteúdo", em `/ajustes`**, desligado por
  padrão. Ligado, os modelos gratuitos passam a funcionar e o provedor pode guardar o conteúdo das
  notas; desligado, o servidor pede que ele não guarde e os gratuitos ficam indisponíveis. **A tela
  diz a consequência nos dois estados** — antes prometia a proteção sem dizer o que ela custa.
- **Migration `20260923142258_politica_de_dados`**: coluna `allow_training` em `ai_preference`,
  obrigatória e sem padrão no banco. Ela entra **com** `DEFAULT false` e o padrão é removido em
  seguida, em dois comandos — `prisma migrate deploy` roda no **boot** em produção, e coluna
  obrigatória sem padrão falha se a tabela tiver linha: a falha derrubaria o serviço, não um
  pipeline. A linha que já existe em produção fica com `false`, então **ninguém passa a permitir
  treino por efeito da atualização**.

### Alterado
- **A requisição de inferência monta o bloco `provider` a partir da preferência.** Com a política
  restritiva vai `{ data_collection: "deny" }`, como antes; com o treino permitido **não vai bloco
  nenhum**, e é deixar o roteamento livre que abre os gratuitos.
- **O aviso do topo de `/ajustes` parou de prometer proteção.** Ele diz agora só o que vale em
  qualquer estado — o conteúdo da nota sai da sua máquina — e remete à escolha logo abaixo.
- **`AiSettings` ganhou `allowTraining`** e `aiSettingsPatchSchema` passa a aceitar o campo. Ele é
  **obrigatório** no tipo de saída: quem montar uma `AiSettings` à mão precisa informá-lo.
- **O padrão da política mora em `packages/shared`**, em `TREINO_PERMITIDO_PADRAO`, e não no
  `@default` da coluna. Duas fontes para o mesmo padrão divergiriam em silêncio.

---

## [0.11.0] — 2026-09-23

**A Etapa A foi para produção e quebrou na primeira tentativa de uso.** O operador favoritou uma
variante `:batch` do modelo — ela custa metade, tem nome quase idêntico e aparece colada na variante
normal na lista — e a formatação devolveu **404**. O provedor recusa essas variantes no endpoint que
usamos e **não expõe campo nenhum** que as identifique: comparando a entrada normal com a `:batch`,
só `id`, `name` e `pricing` mudam. Estávamos oferecendo no catálogo modelos que a chamada não
aceita. Esta entrada tira essas variantes de circulação, torna o erro do provedor legível e
reconstrói o catálogo em volta da pergunta que a tela não deixava responder: **qual destes modelos
eu devo escolher?**

Nenhuma das quatro numerações avança. Continua sendo a **Etapa A da frente de IA**, que é a Fase 5
do roteiro de IA aplicada; as fases de produto seguem em 0 a 5 fechadas, e o MCP na Etapa 4 de 5.
Isto é correção e refino da mesma entrega.

Os quatro pacotes se movem: `apps/api` e `apps/web` de `0.6.0` para `0.7.0`, `packages/shared` de
`0.4.0` para `0.5.0`, `apps/mcp` de `0.7.0` para `0.8.0`. **O MCP não foi tocado** — nenhuma das nove
tools, quatro resources, dois templates e dois prompts mudou, e ele não importa nada de
`packages/shared/src/ia.ts` —, mas `AiModel`, `AiFavorite` e a query do catálogo mudaram no pacote
que ele declara como dependência. A versão de um pacote existe para dizer **contra qual contrato ele
foi construído**, e ele vai ao ar hoje construído contra o `0.5.0`. `ERROR_CODES` não ganhou membro
novo desta vez.

Portões: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos quatro pacotes,
`pnpm --filter @yu-book/api test` com **7 arquivos e 106 testes** (eram 97),
`pnpm --filter @yu-book/mcp test` com 5 arquivos e 43 testes, `pnpm --filter @yu-book/web build` ok
e busca por `sk-or-v1` e `openrouter.ai` no bundle compilado: **zero ocorrências** (CA-01, M2).

**Nada disto foi verificado à mão, e é a quinta entrega seguida em que isso acontece** — Etapas A,
B e C da Fase 5, a Etapa A da frente de IA e agora esta. `apps/web` continua sem runner de teste, e
os portões acima **não cobrem nenhuma linha de interface**: os chips de preço, o seletor de
ordenação, a etiqueta de raciocínio e os índices na lista estão implementados e ninguém os
executou. A repetição é a informação, não o caso isolado. O que os testes da API cobrem é o que está
atrás da tela: as três exclusões do catálogo, o teto de preço com zero como filtro de gratuitos, a
ordenação que põe o não medido no fim e a recusa do favorito de lote.

Segue valendo a **corrida declarada no teto**: dez pedidos de 60 s cabem no limite de 10/min da
rota e podem ler o gasto antes de qualquer linha de uso existir. E o teto **não é exercitável na
prática** pela conta do operador, que é free tier com crédito: modelo gratuito custa zero, então o
teto corretamente não barra e o gasto do dia não sobe. Continua aberto o defeito do `diaDoPrazo` no
MCP hospedado, que nada aqui toca.

### Corrigido
- **Variante `:batch` não aparece mais no catálogo.** São 71 dos 455 modelos do provedor, custam
  metade do preço e ficam coladas na variante normal na lista — uma armadilha atraente. O provedor
  não tem campo que as marque, então o discriminador é o sufixo do `id`, e a regra vive em **um
  lugar só**.
- **Favorito de lote gravado antes deste filtro é recusado com `422` e uma frase que diz o que
  fazer**, em vez do 404 em inglês sobre adaptadores. Tirar as variantes do catálogo não desfaz a
  linha que já está no banco de produção, e o usuário não tem como adivinhar o que "cannot be used
  with the chat/completions endpoint (adapter OpenAIBatchAdapter)" pede dele.
- **Erro de provedor virou acionável** (RF-06). Antes a mensagem era "O provedor de IA respondeu
  404" e não dizia a ninguém o que fazer — foi preciso reproduzir a chamada à mão para descobrir o
  que perguntar ao operador. Agora ela carrega o caminho chamado e a mensagem do corpo, truncada em
  200 caracteres e só quando o corpo é o JSON esperado, para não despejar página de erro de terceiro
  na tela. Vale para os três desfechos: chave recusada, cota excedida e o resto.

### Adicionado
- **Filtro de preço por faixa na tela de ajustes**: grátis, até US$ 0,50, até US$ 2 e qualquer. As
  faixas saem da distribuição real do catálogo — mediana em US$ 0,325 por milhão de tokens de
  entrada —, não de números redondos escolhidos no olho. O teto é pelo preço de **entrada**, que é o
  que domina a conta ao formatar uma nota: o corpo inteiro entra e só a formatação sai.
- **Filtro de raciocínio e etiqueta "raciocínio" na lista**, ao lado das de ferramentas e grátis.
  Raciocínio pesa no custo — pensar gasta tokens de saída —, então é informação de escolha, não
  enfeite. 238 dos 348 modelos declaram.
- **Seis critérios de ordenação**: recentes, mais barato, maior contexto e os três índices de
  qualidade. Ordena-se **antes** de cortar em 20, senão "mais barato" diria "mais barato entre os
  vinte mais recentes".
- **Sinal de qualidade no catálogo**, com três índices de terceiro — inteligência, código e
  agêntico. Eles **ordenam mas não filtram**: estão presentes em 142 dos 348 modelos, e filtrar por
  índice esconderia dois terços do catálogo. Quem não tem medição **não ganha etiqueta nenhuma**,
  porque ausência quer dizer "não medido" e não "ruim"; na ordenação, o não medido vai para o fim,
  nunca para o meio.
- **Corte de conhecimento e aceitação de imagem** passam a vir no catálogo (`knowledgeCutoff`,
  `acceptsImage`), capturados agora que o resto da normalização está de pé.

### Alterado
- **O catálogo passou de 455 modelos do provedor para 348.** Além das variantes de lote, saem duas
  famílias novas: **15 modelos de saída não-textual**, que devolvem imagem ou áudio e falhariam na
  tarefa "texto entra, texto sai" pelo mesmo motivo de fundo que o lote; e **18 apelidos
  `…-latest`**, que funcionam hoje e são a mesma armadilha por outro caminho — o favorito guarda uma
  **cópia** de preço e de contexto, e sob apelido essa cópia fica errada **em silêncio** no dia em
  que o alvo muda, orçando outro modelo. A exclusão dos apelidos é reversível: voltando, eles
  precisam de etiqueta própria na tela. Dos 348 que ficam, 292 sabem usar ferramentas, 238 declaram
  raciocínio e 22 são gratuitos.
- **`AiFavorite` deixou de estender `AiModel`** e declara campo a campo o que o banco guarda. A
  forma do tipo não muda em nada nesta versão; o que muda é que ele **para de herdar** os campos
  novos. Índice de qualidade é medição de terceiro que muda com o tempo, e congelar uma nota velha
  dentro de um favorito seria desinformar: os índices existem para **escolher** um modelo no
  catálogo, não para descrever o já escolhido.
- **`AiModel` ganhou `reasoning`, `acceptsImage`, `indices` e `knowledgeCutoff`**, e
  `listAiModelsQuerySchema` ganhou `maxPrice`, `reasoning` e `sort`. `sort` tem padrão
  `"relevance"`, o que torna o campo obrigatório no tipo de saída — quem monta uma
  `ListAiModelsQuery` à mão precisa informá-lo.

---

## [0.10.0] — 2026-09-22

**Etapa A da frente de IA aplicada: o Yu-book deixa de ser só _servidor_ MCP e passa a ser
_cliente_ de um modelo.** É a **Fase 5 do roteiro de IA aplicada**
([`docs/applied-ai-read-trip.md`](docs/applied-ai-read-trip.md)), detalhada em
[`docs/prd-ia-no-yu-book.md`](docs/prd-ia-no-yu-book.md). **Não é fase de produto** — as de produto
vão de 0 a 5, seguem fechadas, e a 6 (Google Calendar) não começou — e **não é etapa do MCP**, que
continua na 4 de 5. Três numerações, nenhuma conversível na outra.

Os quatro pacotes se movem: `apps/api` e `apps/web` de `0.5.0` para `0.6.0`, `packages/shared` de
`0.3.0` para `0.4.0`, `apps/mcp` de `0.6.0` para `0.7.0`. **O MCP não muda em nada observável** —
nenhuma das nove tools, quatro resources, dois templates e dois prompts foi tocada, e
`POST /ai/notes/:id/format` deliberadamente **não** vira tool —, mas `ERROR_CODES` ganhou seis
membros e `apps/mcp/src/cliente.ts` consome `ApiErrorBody`. A regra dos quatro pacotes existe para
que a versão de um pacote diga **contra qual contrato ele foi construído**, e o contrato mudou.

**O Ollama saiu do escopo, e com ele caem o RNF-01 e a RN-01 do PRD.** A API roda na Railway, sem
GPU: um recurso apoiado em modelo local não existiria em produção, que é onde o app é usado. O
provedor é um só, OpenRouter, e **o corpo da nota sai da máquina em toda tarefa de IA**. A mitigação
é dizer isso **na tela de ajustes** e mandar `provider: { data_collection: "deny" }` na requisição.
Caem também o **NO5** (o PRD proibia painel de gastos; a entrega tem teto diário e custo visível, a
pedido do operador) e, como decisão sem código nesta etapa, o **NO2**. Os porquês em
[`docs/historico.md`](docs/historico.md).

Portões: `pnpm --filter @yu-book/shared build` ok, `pnpm typecheck` limpo nos quatro pacotes,
`pnpm --filter @yu-book/api test` com **7 arquivos e 97 testes** (eram 6 e 58),
`pnpm --filter @yu-book/mcp test` com 5 arquivos e 43 testes, `pnpm --filter @yu-book/web build` ok
e busca por `sk-or-v1` e `openrouter.ai` no bundle compilado: **zero ocorrências** (CA-01, M2).

**Não verificado à mão, e `apps/web` não tem runner de teste.** Foram conferidos na tela: provedor
conectado, catálogo buscável, nota formatada com três `[[wikilinks]]` intactos e o gasto do dia
subindo. **Não** foram: o desfazer em 8 s, a recusa quando se edita durante a formatação, a ausência
de colateral em título, tags e workspace, e a recusa por teto atingido. Duas dessas dependem de
gastar dinheiro de verdade — com modelo gratuito o custo é zero, então o teto corretamente nunca
barra e o gasto do dia não sobe. **Há ainda uma corrida declarada no teto**: o limite de 10/min da
rota, com orçamento de 60 s por chamada, deixa até dez pedidos passarem pela leitura do gasto antes
de qualquer linha de uso existir. Um usuário, uma tela — aceita, não resolvida.

### Adicionado
- **Tela de ajustes em `/ajustes`**, com entrada própria na navegação e carga sob demanda por
  `lazy()`: o catálogo de modelos do provedor não precisa estar no bundle que abre a tela de notas.
  Reúne, numa requisição só, o estado do provedor, o catálogo buscável, os favoritos, o modelo de
  cada tarefa, o teto diário e o gasto de hoje.
- **Botão de formatar a nota por IA** no editor, ao lado do de copiar (RF-10), com **desfazer
  disponível por 8 segundos** (RF-11, RF-12). O resultado é aplicado no rascunho e gravado pelo
  autosave — a ida e a volta passam pelo mesmo caminho, e por isso custam **uma** requisição cada.
  O RF-13 sai de graça: título, tags e workspace nem são enviados, então não podem ser alterados.
  Editar a nota enquanto ela é formatada **descarta** o resultado em vez de engolir o que você
  acabou de escrever (RF-15); falha de provedor deixa a nota intacta, com erro em `role="alert"`
  (RF-16).
- **Módulo `assistente` em `apps/api`** (RF-01), nas duas camadas do projeto, com sete rotas:
  `GET /ai/health`, `GET /ai/models`, `GET` e `PATCH /ai/settings`, `POST /ai/favorites`,
  `DELETE /ai/favorites/:id`, `PATCH /ai/tasks/:task` e `POST /ai/notes/:id/format`. `GET /ai/health`
  responde **sem executar inferência** (RF-08); `GET /ai/models` serve o catálogo do provedor com
  cache de 1 h e marca a resposta como `stale` quando ela veio do cache porque o provedor não
  respondeu.
- **Teto de gasto diário, com a fronteira do dia no fuso do usuário.** `ai_usage.local_day` é
  gravado, não calculado na consulta, e o fuso vive em `ai_preference`: a API roda em UTC e o
  operador vive em UTC−3, então sem isso o teto zeraria três horas cedo todo dia, calado. Teto
  padrão de US$ 0,20/dia, ajustável até US$ 100.
- **A origem do custo de cada chamada fica gravada e aparece na tela** — `provedor`, `estimado` ou
  `desconhecido`. O terceiro degrau grava zero, e zero não move o teto; por isso as chamadas sem
  custo informado do dia são **contadas e mostradas**. Teto que mente é pior que teto nenhum.
- **Favoritar modelo guarda uma cópia do catálogo**, não uma referência: a estimativa de custo não
  pode buscar as centenas de modelos do provedor dentro da requisição, e a lista de favoritos
  precisa abrir com o provedor fora do ar. `snapshot_at` registra quando a cópia foi tirada.
- **Migration `20260922180759_ia_etapa_a`**: quatro tabelas (`ai_preference`, `ai_model_favorite`,
  `ai_task_model`, `ai_usage`) e dois enums (`AiTask`, `AiCostSource`). **São as primeiras tabelas
  de configuração por usuário do projeto**; até aqui todo dado era conteúdo.
- **`packages/shared/src/ia.ts`**: `diaLocal(instante, fuso)`, os conversores µUSD ↔ dólar,
  `ehFusoValido`, os tetos e o limite de corpo enviado ao modelo, cinco schemas Zod e os tipos de
  resposta. Mais `AI_TASKS` e `AI_COST_SOURCES` em `enums.ts` e **seis códigos de erro** em
  `ERROR_CODES`: `PROVEDOR_INDISPONIVEL`, `PROVEDOR_DEMOROU`, `COTA_EXCEDIDA`,
  `TETO_DIARIO_ATINGIDO`, `MODELO_NAO_ESCOLHIDO` e `RESPOSTA_INVALIDA`.
- **`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` e `OPENROUTER_APP_URL`** validadas no boot pelo
  mesmo `env.ts` (RF-05). Todas opcionais: **sem chave a API sobe igual** e só as funções de IA
  ficam indisponíveis, com o motivo na tela (RNF-03, CA-02).
- Dois ícones novos desenhados à mão em `Icones.tsx`, como manda a casa.

### Alterado
- **`POST /ai/notes/:id/format` tem limite próprio de 10 requisições por minuto.** O limite global é
  de 300/min por IP e não protege contra dez chamadas de vinte segundos cada.
- **A guarda de wikilink é código, não prompt** (RN-06): a resposta do modelo é recusada se o
  **conjunto de alvos `[[…]]`** mudar. É conjunto, e não lista ordenada — comparar por índice
  recusaria uma formatação só por ela ter reordenado itens, depois de a chamada já ter sido paga.
- **Custo em µUSD inteiro** em todo lugar — banco, contrato e API. Não há `Decimal` no schema, e
  `JSON.stringify` lança em `bigint`; a conversão para dólar acontece num lugar só,
  em `packages/shared`.
- **A preferência de IA não é criada na leitura.** `GET /ai/settings` devolve os padrões do
  `packages/shared` sem gravar nada — um `GET` que escreve é surpresa; quem cria a linha é o
  `PATCH`.

### Corrigido
- **`desfavoritar` era checar-depois-agir** e violava a INV-04: a posse passa a ser conferida na
  mesma operação que apaga.

### Segurança
- **`GET /ai/health` não devolve mais o rótulo do provedor quando ele é o prefixo da própria
  chave**, que é o padrão do OpenRouter. Esconder o campo no JSX não bastava: o corpo da resposta
  chega ao navegador, à aba de rede e a qualquer cache no caminho. A redação passou para o service.
- **Nenhuma chave de provedor alcança o navegador** (RNF-02, O5): toda chamada a modelo parte do
  servidor (RF-04, RN-02), e a busca por `sk-or-v1` e `openrouter.ai` no artefato compilado não
  encontra nada.

---

## [0.9.0] — 2026-09-04

**O acabamento da Etapa 4 do MCP: a segunda camada da trava de escrita e o primeiro deploy do
pacote.** Fecha as **duas limitações declaradas na `0.8.0` que ainda eram código** — o escopo não
conferido dentro dos handlers de escrita, e o `trust proxy` ausente. **Não é a Etapa 5** (mesa de
trabalho multi-repositório), que continua não entregue: continua sendo a **Etapa 4 das cinco da
proposta de MCP** ([`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md)) e a
**Fase 3 do roteiro de IA aplicada** ([`docs/applied-ai-read-trip.md`](docs/applied-ai-read-trip.md)).
O que muda de verdade é outra coisa: `apps/mcp` **deixa de ser um pacote que só roda na máquina do
operador** e passa a ser hospedado.

`apps/mcp` vai de `0.5.0` para `0.6.0`. **`apps/api` não foi tocado** e segue em `0.5.0`, como
`apps/web`; `packages/shared` segue em `0.3.0` — o contrato não mudou, e a regra dos quatro pacotes
não se aplica. É por mover só `apps/mcp`, e a `0.8.0` ter movido `apps/mcp` **e** `apps/api`, que
esta é uma entrada nova e não um acréscimo àquela.

`pnpm typecheck` sem erros nos quatro pacotes, `pnpm --filter @yu-book/mcp test` com **4 arquivos e
38 testes** (eram 32), `pnpm --filter @yu-book/api test` com 6 arquivos e 58 testes, e
`pnpm --filter @yu-book/mcp build` ok. Contra servidor de pé, com o `startCommand` exato do
`railway.json`: o processo sobe, `/health` responde com `Host` desconhecido — que é como o
healthcheck da Railway chega —, um `Host` forjado em `/mcp` toma 403, um downgrade de escopo derruba
a sessão (404, sessões vivas 1 → 0) e a reinicialização devolve **5 tools**, `MCP_ESCRITA_HABILITADA=0`
com a caixa marcada concede só `yubook:read`, e o stdio contra API remota registra 5 tools. **Duas
provas negativas**: um handler sem o invólucro e uma tool de escrita registrada no módulo errado —
cada uma derruba um teste diferente.

**O primeiro deploy sobe com `MCP_ESCRITA_HABILITADA=0`**, decisão do operador: primeiro voo só de
leitura. Ligar depois é uma variável no painel, sem deploy de código.

### Adicionado
- **Segunda camada da trava de escrita, no ponto da chamada** (`src/autorizacao.ts`, novo). Até aqui
  a trava era só na montagem da sessão — o que o cliente vê no `tools/list` —, e ela falha calada:
  uma tool de escrita registrada no módulo errado fica registrada **sempre**, para um token de
  leitura e contra a API de produção, sem que compilador, teste ou execução reclamem. O guarda é
  **total nos dois transportes**: em `stdio` pergunta se a API é local (`env.escritaLiberada`), em
  `http` pergunta pelo desligamento global e pelo `yubook:write` do token. Não é `return true` no
  stdio — é justamente o que faz uma tool registrada sem condição continuar recusando contra uma API
  remota.
- **`comErroDeEscrita` em `src/erros.ts`**, irmão de `comErro`, envolvendo as quatro tools que mudam
  dado. **A ordem é parte da correção**: o guarda roda antes de `relatar(...)` e antes de qualquer
  chamada de API — uma recusa não pode emitir log de uma escrita que não aconteceu, porque esse log
  é a única trilha de auditoria que chega ao usuário. A recusa volta como `isError`, dizendo ao
  modelo que **nada foi alterado** e que repetir não resolve, com o motivo certo para cada eixo.
- **`apps/mcp/railway.json`** — o pacote passa a ser deployável, o que nunca foi. `NODE_ENV=production`
  e `MCP_TRANSPORTE=http` vão no `startCommand`, **não** como variáveis de serviço: o primeiro
  porque `NODE_ENV` de serviço quebra o build, o segundo porque sem ele o processo sobe em `stdio` e
  fica mudo. `healthcheckPath: "/health"`.
- **Seção de hospedagem no [`README` de `apps/mcp`](apps/mcp/README.md)** e no `.env.example`: quais
  cinco variáveis vão no painel, quais duas são proibidas e por quê, e a ordem de criar o serviço
  antes de preencher as que dependem do domínio.
- **`tests/escrita.test.ts` e `tests/arnes.ts`** — o **primeiro cliente JSON-RPC em memória do
  repositório**, sobre `InMemoryTransport` com `authInfo` por mensagem, que é o que permite chamar
  uma tool de escrita com um token de leitura. Os testes anteriores construíam os objetos que a
  integração deveria fornecer, e por isso provavam as peças e não a superfície. A lista de tools de
  escrita é **derivada**, não escrita à mão: sobe o servidor com e sem escrita e subtrai os
  `tools/list`; os argumentos mínimos saem do `inputSchema`, porque o SDK valida antes do handler.
  Tool de escrita nova entra coberta sem ninguém lembrar de listá-la.

### Alterado
- **A sessão HTTP passou a guardar a superfície com que foi montada.** Se o token deixa de bater —
  ganhando **ou** perdendo `yubook:write` —, a sessão é encerrada de verdade e o pedido leva 404. A
  simetria é de propósito: o catálogo que o modelo vê nunca anuncia uma tool que vai recusar, e
  nunca esconde uma que já pode ser usada.
- Os escopos `yubook:read` e `yubook:write` saíram de `src/auth/provedor.ts` para `src/autorizacao.ts`,
  junto de `escritaPermitida`. A regra da escrita sob HTTP passou a existir num lugar só.

### Segurança
- **Um cliente podia rebaixar o próprio token e continuar escrevendo.** `exchangeRefreshToken` aceita
  `scope` no pedido e filtra o concedido, então dava para renovar pedindo só leitura e seguir usando
  o mesmo `mcp-session-id` com as **nove** tools registradas. Agora a sessão é encerrada quando a
  superfície e o token divergem, e o guarda no ponto da chamada recusa mesmo que algo escape disso.
- **`app.set("trust proxy", 1)`.** Sem isto, atrás do proxy da Railway o `req.ip` é o do proxy para
  todo mundo: o limite de **20 tentativas por 5 minutos** no `POST /login` vira um balde global, e o
  `express-rate-limit` v8 ainda emite `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` ao ver o header. **`1` e
  não `true`** — `true` confia na cadeia inteira de `X-Forwarded-For`, que o cliente forja para
  trocar de balde a cada tentativa, que é exatamente o que o limite existe para impedir.

### Limitações conhecidas
- **A `apps/api` usa `trustProxy: true` do Fastify**, e portanto confia na cadeia inteira de
  `X-Forwarded-For` — o defeito que o `1` do MCP corrige. É dívida anotada e deliberadamente fora
  desta entrega, para não misturar mudança de produção da API com o primeiro deploy do MCP.
- **`logout` com um refresh token de rotações atrás não revoga nada** — `count = 0`, sem erro.
  Fechar exige uma coluna `replacedById` no schema da API.
- **A proteção contra revogação em massa tem teto de 120 s, não de 30 s.** Quem manda no tempo real
  é a janela de idempotência do MCP, não a graça da API.
- **Nenhum teste exercita o aperto de mão OAuth completo com navegador.** O arnês novo cobre a
  superfície JSON-RPC; o fluxo de autorização continua verificado à mão.
- **Uma instância, sempre.** O transporte é com estado por decisão, e o POST de uma chamada e o GET
  do SSE precisam cair na mesma máquina.

---

## [0.8.0] — 2026-09-01

**Etapa 4 do servidor MCP — transporte HTTP e identidade.** O servidor deixa de ser um processo por
pessoa e passa a atender muitos clientes, o que quebra a premissa em que toda a Etapa 3 se apoiava:
com `stdio`, quem está do outro lado é quem iniciou o processo, e a credencial podia morar no
ambiente; sobre HTTP, **o servidor deixa de saber quem está perguntando**, e credencial em arquivo
viraria uma identidade só para todo mundo. É a **Etapa 4 das cinco da proposta de MCP**
([`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md)) e a **Fase 3 do roteiro de
IA aplicada** ([`docs/applied-ai-read-trip.md`](docs/applied-ai-read-trip.md)). **Não é fase de
produto** — as de produto vão de 0 a 5, estão fechadas, e a próxima delas continua sendo a agenda.
Três numerações convivem no repositório e nenhuma se converte na outra.

`apps/mcp` vai de `0.4.0` para `0.5.0` — transporte novo, compatível com quem já usava o stdio.
`apps/api` vai de `0.4.0` para `0.5.0`, e desta vez **muda o que é deployado**: a janela de graça no
reuso de refresh token altera o comportamento de `POST /auth/refresh` em produção. `apps/web` segue
em `0.5.0` e `packages/shared` em `0.3.0` — o contrato não mudou, e a regra dos quatro pacotes não
se aplica.

**A verificação foi de verdade, e ganhou um portão automático novo.** `pnpm typecheck` sem erros nos
quatro pacotes (`apps/mcp` agora entra pelo `tsconfig.test.json`), `pnpm --filter @yu-book/mcp test`
com **3 arquivos e 32 testes** — o primeiro suíte de testes que este pacote tem —,
`pnpm --filter @yu-book/api test` com 6 arquivos e 58 testes, e `pnpm --filter @yu-book/mcp build`
ok. Contra servidor de pé: duas contas em duas sessões simultâneas veem **acervos diferentes**; o
token sobrevive a um reinício do processo, que antes devolvia 401; renovação dupla devolve o mesmo
par com **uma** rotação no banco; um código de autorização apresentado como refresh token responde
`invalid_grant`; `MCP_ESCRITA_HABILITADA=0` deixa 5 tools mesmo com escopo de escrita forçado; e o
POST sem session id não vaza servidor nenhum — 5 conectados, 5 fechados.

### Adicionado
- **Transporte HTTP** (`MCP_TRANSPORTE="http"`), StreamableHTTP com sessão, ao lado do `stdio` que
  continua sendo o padrão. **Uma montagem só serve os dois** (`src/servidor.ts`): as mesmas nove
  tools, os mesmos resources e prompts, as mesmas capabilities. O que muda entre eles é de onde vem
  a identidade, e só isso.
- **Servidor de autorização OAuth 2.1 próprio**: registro dinâmico de cliente, PKCE, página de login
  e consentimento **sem uma linha de JavaScript**, emissão e verificação de token. Ele **emite** o
  token, não repassa o de um terceiro — quem autoriza digita e-mail e senha do Yu-book, e o que
  sobrevive à página é a sessão da API, nunca a senha.
- **Nenhum estado durável no emissor.** Cliente registrado, código de autorização e refresh token
  viajam **cifrados dentro do próprio identificador** (AES-256-GCM para o segredo, HS256 para a
  assinatura, tudo em `node:crypto`). Não há tabela, não há Redis, e reiniciar o processo não
  invalida nada.
- **Escopos `yubook:read` e `yubook:write`**, decididos na caixa de seleção do consentimento. Quem
  não marcar a escrita recebe uma sessão com **5 tools**; quem marcar recebe as **9**. Os escopos
  congelam na criação da sessão.
- **`MCP_ESCRITA_HABILITADA=0` desliga a escrita globalmente no transporte HTTP, sem deploy de
  código** — as quatro tools de escrita não se registram em sessão nenhuma, mesmo que o token traga
  o escopo.
- **Varredura de sessões ociosas** (`MCP_SESSAO_TTL_MS`, 30 min por padrão) e **teto duro de sessões
  vivas** (`MCP_SESSOES_MAX`, 100). Existem porque o SDK **não** fecha a sessão quando o cliente
  some: sem elas, um cliente que cai de rede deixa sessão viva para sempre, sem erro e sem log, e o
  vazamento vira negação de serviço.
- **Validação do cabeçalho `Host`** por `MCP_HOSTS_PERMITIDOS`, e **limite de 20 tentativas por 5
  minutos** no `POST /login`, antes que elas virem login de verdade na API.
- **Testes automatizados em `apps/mcp`**, com Vitest: 32 casos sobre os envelopes cifrados, o
  provedor OAuth e o contexto de identidade. `pnpm --filter @yu-book/mcp test` é portão novo, e o
  `typecheck` do pacote passou a incluir os testes (`tsconfig.test.json`).
- **`apps/api`: janela de graça de 30 s no reuso de refresh token** (`GRACA_DE_REUSO_MS` em
  `auth.service.ts`), coberta por três testes de integração novos em `tests/auth-refresh.test.ts`.
- **Segundo usuário no seed de `apps/api`**, sem o qual o isolamento entre contas não se prova.
- **`.env.example` com as onze variáveis separadas por transporte**, dizendo em cada uma se ela vale
  no `stdio`, no `http` ou nos dois, e **diagnóstico de boot por transporte** no stderr. O
  [`README` de `apps/mcp`](apps/mcp/README.md) foi reescrito em torno dos dois modos.

### Alterado
- **`POST /auth/refresh` deixou de derrubar todas as sessões do usuário quando um refresh token
  recém-consumido reaparece dentro de 30 s.** Nessa janela a resposta é 401 e nada é revogado; fora
  dela, o comportamento antigo continua — reuso é vazamento e a cadeia inteira cai. Altera o
  invariante **INV-06**. O motivo é o servidor MCP, que não é navegador: a rotação é atômica e o
  token novo só existe na resposta, então uma resposta perdida fazia o cliente reapresentar o
  anterior de boa-fé e deslogar o operador de todo lugar, inclusive do navegador dele.
- **A identidade passou a ser por requisição**, e não por processo: o `accessToken` da API viaja
  cifrado dentro do token de acesso do MCP, é aberto a cada chamada e amarrado ao handler por
  `AsyncLocalStorage`. **Nenhuma das 16 chamadas de API mudou de assinatura** — o contexto entra em
  `comErro`/`comErroDeResource` e sai em `cliente.ts`. Em `stdio` não há contexto e a conta do
  `.env` continua sendo a identidade certa.
- **O token do MCP vive `apiExp − 60 s`, derivado do token da API e nunca fixado.** Um tempo de vida
  constante mentiria sempre que a sessão da API fosse mais curta que ele.
- **A renovação de token virou idempotente por `jti`:** duas renovações simultâneas, ou uma
  repetida, custam **uma** chamada à API e devolvem o mesmo par.
- **O erro do `POST /token` passou a ser classificado:** 401 da API vira `invalid_grant`, que manda
  o cliente reautorizar; 5xx e falha de rede viram `server_error`, que manda tentar mais tarde.
  Antes tudo virava 500 e o cliente retentava para sempre sem nunca abrir o navegador.
- `entrarNaApi` lança `ErroDaApi` em vez de erro genérico, e a página de login passou a falar com
  gente: só a mensagem do 401 vem da API, o resto vira texto genérico — a tela é pública.

### Corrigido
- **Um reinício do processo derrubava todos os tokens vivos.** O emissor guardava as sessões da API
  num mapa em memória; o mapa e a função `criarSessaoDaApi` inteira foram apagados, e o estado que
  sobrava passou a viajar cifrado no próprio token.
- **`getClient` devolvia `client_id: ""` para todo cliente registrado**, o que tornava tautológica
  toda comparação de cliente: um refresh token vazado valeria em qualquer cliente, e a checagem que
  deveria amarrar o token a quem o pediu não amarrava nada.
- **Um POST sem session id com corpo que não fosse `initialize` vazava um `McpServer` por
  tentativa** — nascia, era recusado pelo SDK, e nunca era mapeado nem fechado. A recusa passou a
  acontecer antes de qualquer construção.

### Removido
- O mapa de sessões da API em memória e `criarSessaoDaApi`, substituídos pelo envelope cifrado.

### Segurança
- **Um desvio de autenticação real foi encontrado e fechado nesta entrega.** O envelope do código de
  autorização era **superconjunto estrutural** do envelope de refresh token, então um código
  apresentado em `grant_type=refresh_token` abria como refresh válido e devolvia um token **com
  escopo de escrita** — contornando de uma vez o uso único, o `exp` de 60 s e o PKCE. A correção é
  um **rótulo de tipo obrigatório** dentro do envelope cifrado: envelope de outro tipo sai como
  lixo, e não como estrutura compatível.
- **O `accessToken` da API viaja cifrado (`atk`) dentro do token de acesso do MCP**, e não em claro.
  Quem interceptar um token do MCP não recebe de brinde uma credencial da API.
- **O boot recusa subir em `http` se `YUBOOK_EMAIL` estiver definida**, e recusa subir sem um
  `MCP_SEGREDO` de pelo menos 32 caracteres. Credencial de conta no ambiente de um servidor
  multiusuário é exatamente o que esta etapa existe para remover.
- **A URL pública nunca é derivada do cabeçalho `Host`** (`MCP_URL_PUBLICA`): um atacante que manda
  `Host: evil.com` faria o servidor anunciar o `token_endpoint` dele no metadata de descoberta.
- **Sessão de outro usuário responde 404, não 403** — confirmar que o id existe já seria informação
  demais.

### Limitações conhecidas
- **A proteção contra revogação em massa tem teto de 120 s, não de 30 s.** Quem manda no tempo real
  é a janela de idempotência do MCP, não a graça da API. Um cliente que guarde um refresh anterior e
  o reapresente depois disso ainda derruba as sessões do usuário. Fechar exigiria estado no
  servidor, que é justamente o que o emissor não tem.
- **`logout` com um refresh token de rotações atrás não revoga nada** — `count = 0`, sem erro.
  Fechar exige uma coluna `replacedById` no schema da API.
- **`trust proxy` não está configurado.** Atrás do proxy da Railway, o limite por IP do `/login`
  vira um balde global. É item do deploy, que ainda não aconteceu.
- **Nenhum teste exercita o aperto de mão OAuth completo.** Os 32 casos cobrem as peças; os dois
  últimos defeitos desta entrega apareceram à mão, e é o que dá a medida do buraco.
- **O escopo não é conferido dentro de cada handler de escrita.** Hoje a trava é só na montagem da
  sessão, e é ela mais o deploy na Railway que abrem a etapa seguinte.
- **Uma instância, sempre.** O transporte é com estado por decisão — sem `sessionIdGenerator` o SDK
  desliga o SSE, e com ele iriam o log das escritas e o progresso. Com duas instâncias, o POST de
  uma chamada e o GET do SSE podem cair em máquinas diferentes.

---

## [0.7.0] — 2026-08-26

**Etapa 3 do servidor MCP — as tools de escrita.** O servidor deixa de só consultar o segundo
cérebro e passa a mudá-lo: `create_card`, `move_card`, `trash_note` e `restore_note`. É a **Etapa 3
das cinco da proposta de MCP** ([`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md)),
a que a Etapa 2 tinha declarado fora do próprio escopo, e é a **Fase 2 do roteiro de IA aplicada**
([`docs/applied-ai-read-trip.md`](docs/applied-ai-read-trip.md)). **Não é uma fase de produto** — as
fases de produto vão de 0 a 5, estão concluídas, e a próxima delas continua sendo a agenda. Três
numerações diferentes convivem no repositório; nenhuma se converte na outra.

`apps/mcp` vai de `0.3.0` para `0.4.0` — superfície nova, compatível com quem já usava as cinco
tools de leitura. `apps/api` vai de `0.3.0` para `0.4.0` **sem mudar uma linha do que é deployado**:
o que ele ganhou foi o primeiro seed do projeto e os scripts do segundo ambiente, ferramenta de
desenvolvimento. `apps/web` segue em `0.5.0` e `packages/shared` em `0.3.0` — o contrato **não**
mudou, e é por isso que a regra dos quatro pacotes não se aplica aqui.

**A verificação desta etapa foi de verdade, e é a primeira em três entregas que se pode dizer isso.**
`pnpm typecheck` verde nos quatro pacotes, os 55 testes de integração da API passando (5 arquivos),
`pnpm --filter @yu-book/mcp build` ok, e roteiros sequenciais completos rodados contra o ambiente
local: nota para a lixeira → a busca não acha mais → restaurar → `get_note` confirmando o que volta
e o que não volta → restaurar de novo não altera nada. **Zero linhas não-JSON no stdout** em todos
os roteiros, que é a regra que derruba o transporte stdio quando quebra. `get_board` e
`yubook://board/{id}` continuam devolvendo os mesmos **1385 bytes, caractere a caractere** — a
duplicação de superfície não virou duplicação de código.

**E a revisão pegou uma afirmação falsa antes de ela sair.** A descrição de `trash_note` dizia que
os links `[[…]]` não voltam ao restaurar; eles voltam. O erro nasceu **nesta entrega**, não é
dívida antiga, e está corrigido e reverificado no banco — 1 → 0 → 1 aresta em `note_link` ao
excluir e restaurar. O que ele custou está em [`docs/historico.md`](docs/historico.md); o que
importa aqui é que as descrições abaixo descrevem o comportamento real.

O preço está medido: `tools/list` foi de **3480 bytes com 5 tools para 8517 com 9**, e isso é gasto
em todo turno de conversa. É o custo da granularidade estreita, aceito de propósito. A revisão
cortou **273 bytes** de `description` e `.describe()` no fonte — texto que não mudava decisão
nenhuma do modelo — e só `trash_note` cresceu (+42), para desfazer a afirmação falsa. No fio, com o
JSON dos schemas junto, isso deu **196 bytes a menos** que antes das correções.

### Adicionado
- **`create_card`** — cria um card no fim de uma coluna, com título, descrição em Markdown, prazo,
  prioridade e tags. O quadro é deduzido da coluna: não existe parâmetro de quadro. Não cria
  coluna, quadro, workspace nem checklist. Data **sintaticamente válida e inexistente** — um
  `2026-13-45` — é recusada dizendo que o campo não é uma data existente, em vez de deixar um
  `Invalid time value` cru chegar ao modelo.
- **`move_card`** — move um card para outra coluna ou o reordena dentro da que já está. A posição
  pedida é **a posição em que o card vai ficar**, dita assim para não exigir subtração mental de
  quem chama. Card arquivado não se move: a recusa manda desarquivar primeiro.
- **`trash_note`** — manda a nota para a lixeira. A confirmação **separa o que a volta desfaz do
  que ela não desfaz**, porque são coisas de natureza oposta: os cards que apontavam para a nota
  perdem o vínculo e `restore_note` **não** o refaz, enquanto os links `[[…]]` são apagados e
  **voltam** ao restaurar. Os números vêm de uma leitura feita antes da exclusão — depois do fato
  não há mais o que contar. A conta de cards diz, no próprio texto, que **card arquivado também
  perde o vínculo e não entra nela**: a API zera o vínculo de todos, mas só os ativos são
  contáveis. Chamar `trash_note` numa nota que **já está** na lixeira não é mais um 404 que manda
  procurar o id onde a busca não enxerga — a tool diz desde quando ela está lá, devolve o id para
  `restore_note` e não registra passo de algo que não aconteceu.
- **`restore_note`** — tira a nota da lixeira, com os backlinks recalculados nos dois sentidos.
  Avisa, na própria descrição, que **não** refaz o vínculo dos cards e que pode falhar por título
  duplicado, se outra nota tiver tomado o título enquanto esta estava lá.
- **Notificação de log a cada escrita** (`notifications/message`): é o único registro que chega ao
  usuário de que uma nota foi para a lixeira — o stderr deste pacote nenhum cliente MCP mostra.
- **Notificação de progresso**, emitida só quando o cliente manda um `progressToken` no `_meta` da
  chamada. Sem token, nada é emitido; o log continua nos dois casos.
- **`annotations` do MCP nas quatro tools novas**, para o cliente saber antes de chamar o que é
  destrutivo (`trash_note`) e o que é idempotente (`restore_note`).
- **Ambiente local de escrita**, separado do de desenvolvimento e da produção: banco `yubook_mcp`,
  API na porta 3334 por `pnpm --filter @yu-book/api dev:mcp`, e `pnpm --filter @yu-book/api db:seed`
  criando um acervo recriável e o usuário `mcp@yu-book.test`. O seed é idempotente e escreve
  **pelos services**, não pelo Prisma cru, para que `note_link` exista e as posições nasçam
  contíguas — a gaveta de links é a única exceção, e está comentada no arquivo. O acervo é
  desenhado para **exercitar caminho, não para parecer cheio**: **16 cards, dos quais 15 ativos** —
  `list_boards` diz 15 porque conta só os ativos, e o décimo sexto está arquivado de propósito —,
  duas notas na lixeira — uma para a restauração feliz, outra que perdeu o
  título para uma nota ativa e faz a restauração falhar com 409 —, um card com checklist 2/3, três
  links na gaveta, e a coluna "Fazendo" com **4 cards ativos contra um `wipLimit` de 3**, estourada
  de propósito, porque o limite existe para avisar e não para bloquear. Instruções no
  [README](README.md) e em [`apps/mcp/README.md`](apps/mcp/README.md).
- **`pnpm --filter @yu-book/mcp verificar` passa a dizer se a escrita está ligada** e contra que
  tipo de host — a pergunta que o utilitário responde deixou de ser só "estou lendo de onde?".

### Alterado
- **Os dois prompts empacotados deixaram de proibir ação.** Onde diziam "este servidor é somente
  leitura", agora dizem o que mudou: a revisão do dia pode *propor* uma escrita e nomear a tool que
  a executa, mas não chama nenhuma sem pedido; retomar contexto segue sendo leitura.
- **`get_board` passa a imprimir o id de cada coluna**, sob o nome dela. Custa 36 caracteres por
  coluna e é o que torna as escritas de kanban alcançáveis.
- **O erro de validação que chega ao modelo agora nomeia o campo e o motivo**, em vez da frase
  "Dados inválidos", que não dizia nada e levava o modelo a repetir a mesma chamada errada. O erro
  de título duplicado ganhou explicação própria, incluindo o caso em que o título foi tomado
  enquanto a nota estava na lixeira. O `NOT_FOUND` ganhou a cláusula da lixeira, pelo mesmo motivo
  que a ausência dela custava caro: mandar o modelo reconferir o id em `search_notes` é inútil
  quando o id que ele tem é o de uma nota excluída, que a busca por desenho não enxerga.
- **As descrições das tools encolheram 273 bytes sem perder informação acionável.** Saiu do
  `.describe()` de `tags` a explicação da normalização silenciosa do servidor, que o modelo não tem
  como acionar nem evitar, e portanto não muda decisão nenhuma dele. Texto de tool é orçamento
  gasto em todo turno.
- `prisma/**/*` entrou no `tsconfig.test.json` de `apps/api`, para que o seed não escape do
  `pnpm typecheck` — o único portão automático que existe aqui.
- `docs/prd-fase-5-refino.md` foi para `docs/old/` com a Fase 5 fechada, e a proposta de MCP saiu de
  `docs/temp/` para [`docs/old/proposta-mcp-inicial.md`](docs/old/proposta-mcp-inicial.md). Os links
  de quem apontava para elas foram corrigidos; o conteúdo dos dois, não — documento em `docs/old/`
  é registro de época. O nome do contêiner do Postgres ficou igual no `README.md` da raiz e no de
  `apps/mcp` — divergiam no mesmo diff, e um dos dois comandos de setup falhava copiado como está.

### Corrigido
- **O prazo de um card era relatado um dia à frente.** O front grava o prazo às 23:59:59 do fuso
  local; o servidor MCP cortava o texto da data em UTC, e em UTC-3 isso cai no dia seguinte. Valia
  para **todo** card com prazo, em `get_board`, `get_dashboard` e nos dois prompts. Bug preexistente
  desde a Etapa 1.
- **Não havia como descobrir o id de uma coluna pelo MCP**, o que teria deixado `create_card` e
  `move_card` inalcançáveis: nenhuma tool, resource ou prompt imprimia `columnId`. Era bloqueante
  para esta etapa.
- **Detalhe de erro de validação era descartado antes de chegar ao modelo** — `issues` vinha da API
  e era jogado fora. Tolerável enquanto o servidor só lia; inútil agora que ele erra por campo.
- **Os dois prompts afirmavam que o servidor é somente leitura**, o que desligaria as tools novas
  justamente nos fluxos empacotados.

### Segurança
- **A escrita nasce desligada fora de um host local.** As quatro tools novas só se registram quando
  `YUBOOK_API_URL` aponta para localhost; contra a Railway elas **somem do `tools/list`**, e o motivo
  vai para o stderr no boot. `YUBOOK_ESCRITA_REMOTA=1` destrava, deliberadamente. Enquanto o servidor
  só lia, apontar o `.env` para produção era inofensivo — deixou de ser: um pedido mal interpretado
  pelo modelo cria dado de verdade, e não existe desfazer deste lado.
- **Exclusão definitiva de nota e exclusão de card não viraram tool**, nem por engano de nome: as
  duas são irreversíveis e continuam só no aplicativo, com um humano confirmando. `trash_note` foi
  batizada assim, e não `delete_note`, também por isso.

### Limitações conhecidas
- **A trava de ambiente protege contra *remoto*, não contra *o banco errado*.** Ela verifica o
  host, e `localhost:3333` — o banco de **desenvolvimento** — passa por ela sem reclamar. Isso não
  é hipótese para quem for configurar: é o estado de quem **já** configurou, porque `3333` era o
  padrão anterior do `.env.example` e nenhum `.env` existente foi migrado. Nesse caso o stderr
  anuncia `escrita: habilitada (API local)` com toda a confiança, e as tools escrevem no acervo de
  trabalho de verdade. A porta é a única diferença entre os dois ambientes e nada a verifica.
  **Confira a porta no `.env` antes de usar escrita.**
- **A volta dos backlinks ao restaurar é melhor esforço, e falha por caixa.** A API acha as notas
  que citam a restaurada filtrando o texto por `[[` mais o título, **sensível a maiúscula**, mas
  casa o alvo ignorando acento e caixa. Medido: `[[Notificações de progresso` reencontra a nota,
  `[[notificações de progresso` não. Um `[[wikilink]]` escrito com caixa diferente da do título
  continua funcionando na interface e não volta à tabela de links.

---

## [0.6.0] — 2026-08-24

**Etapa C da Fase 5 — a nota**: botão de copiar e um quarto modo de edição, "ao vivo". Com ela a
**Fase 5 está completa** (Etapas A, B e C entregues). Mudou **só `apps/web`** — nenhum contrato,
migration, endpoint ou primitiva do MCP —, então só ele bumpa, de `0.4.0` para `0.5.0`; `apps/api`,
`apps/mcp` e `packages/shared` seguem em `0.3.0`. Requisitos em
[`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md) §5.4 e §5.5 (RF-28 a RF-41).

É a primeira dependência externa nova do front desde a Fase 3: seis pacotes (`@codemirror/state`,
`@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/autocomplete` e
`@lezer/markdown`), autorizados pelo operador em D-01 e **só eles** — RNF-13 continua valendo.
O editor entra por `import()` sob demanda: o chunk ficou em **115,9 KB comprimidos**, dentro do teto
de 120 KB de RNF-05, e o bundle inicial seguiu em 171,35 KB gz, inalterado.

**Esta etapa não foi executada uma única vez.** `pnpm typecheck` limpo nos quatro pacotes, os 55
testes de integração da API verdes (regressão — nenhum novo, a Etapa C não toca a API) e
`pnpm --filter @yu-book/web build` ok, mas **nenhum portão do projeto carrega uma `EditorView`**,
porque não existe teste de front aqui. Um editor inteiro foi escrito e nunca rodou: **CA-23 a CA-35
estão implementados e não verificados**. É a terceira entrega seguida nessa condição. O que falta
conferir está em [`docs/historico.md`](docs/historico.md).

### Adicionado
- **Modo "ao vivo", o quarto do editor de notas** (RF-32 a RF-41): a marcação some do que já foi
  escrito e o texto aparece formatado no próprio lugar em que se digita — `# Título` vira título sem
  o `#`, `**negrito**` vira negrito sem os asteriscos. A linha onde o cursor está mostra a marcação
  crua (RF-34), e selecionar um trecho revela a marcação de tudo o que está dentro da seleção
  (RF-35). O documento continua sendo a string de Markdown: fechar uma nota sem digitar não altera
  um byte.
- **`[[wikilink]]` clicável dentro do texto** no modo ao vivo (RF-36), com o mesmo comportamento do
  preview — resolvido navega, não resolvido cria a nota — e os não resolvidos continuam marcados.
- **Caixa de tarefa clicável** (RF-39): marcar `- [ ]` no modo ao vivo edita o texto do Markdown.
- **Autocomplete de `[[` e atalhos de formatação no modo novo** (RF-37, RF-38): `Ctrl+B`, `Ctrl+I`,
  `Ctrl+K`, ``Ctrl+` `` e `Ctrl+S` continuam, e cada aplicação de marcação é **um** passo do
  desfazer (CA-31).
- **Botão de copiar a nota inteira como Markdown**, no cabeçalho, ao lado do seletor de modo
  (RF-28 a RF-30): copia `# Título`, uma linha em branco e o corpo exatamente como está, sem
  reescrita. Copia o **rascunho**, não o que está gravado, porque entre a tecla e o autosave existem
  800 ms em que os dois divergem. Confirma por 2 segundos e anuncia por `aria-live`; falha de
  permissão da área de transferência vira aviso visível, não silêncio.

### Alterado
- **O modo "ao vivo" passa a ser o padrão** (RF-32), e a escolha de modo anterior é descartada uma
  vez: a chave do `localStorage` mudou de nome, então quem já tinha um modo salvo cai no novo padrão
  na primeira abertura e escolhe de novo se quiser. Os três modos antigos — `edicao`, `dividido` e
  `leitura` — continuam existindo e **idênticos**, inclusive a rolagem sincronizada do dividido
  (RF-40) e o autosave (RF-41).
- **O PRD da Fase 5 foi corrigido em três pontos que a entrega contradisse**: RF-31 (atalho do botão
  de copiar) saiu do escopo, a remoção de `caret.ts` prometida em D-01 e na §17 não aconteceu, e o
  realce de sintaxe dentro de bloco de código descrito em RF-33 não vale para o modo ao vivo.

### Corrigido
- **`Ctrl+K` dentro do editor abria a paleta de busca além de inserir o link.** O handler chamava
  `preventDefault` sem `stopPropagation`, e o listener global de `window` recebia o evento assim
  mesmo.
- **`Ctrl+Shift+B` deixava a seleção em negrito além de navegar para os boards.** O mapa de atalhos
  do editor nunca testava `shiftKey`, e com Shift o `e.key` é `"B"`, que minúsculo casa com o
  negrito. Os dois eram bugs pré-existentes, não introduzidos pela etapa.

### Limitações conhecidas
- **O botão de copiar não tem atalho de teclado** (RF-31 fora do escopo, decisão do operador):
  `Ctrl+Shift+C` é "inspecionar elemento" no Chrome e no Firefox, e `preventDefault()` não cancela.
- **Bloco de código no modo ao vivo não tem realce por token** — só fonte monoespaçada e fundo.
  Realce dentro da cerca exigiria parsers aninhados por linguagem, exatamente o peso recusado em
  D-01. Nos modos `dividido` e `leitura` o realce completo continua, via `renderMarkdown`.
- **O mesmo texto pode aparecer levemente diferente entre o modo ao vivo e o modo leitura**: são
  dois parsers de Markdown convivendo no bundle, o `marked` e o do Lezer.
- **Para leitor de tela, o modo ao vivo é pior que a `<textarea>`.** Manter os três modos antigos
  intactos **é** a mitigação — ver [`docs/historico.md`](docs/historico.md).

---

## [0.5.0] — 2026-08-24

**Etapa B da Fase 5**: precisão e fluidez do arraste do kanban. Mudou **só `apps/web`** — nenhum
contrato, migration, endpoint ou primitiva do MCP —, então só ele bumpa, de `0.3.0` para `0.4.0`;
`apps/api`, `apps/mcp` e `packages/shared` seguem em `0.3.0`. A Etapa **C** (copiar nota e editor ao
vivo) não começou: a Fase 5 **não** está concluída. Requisitos em
[`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md) §5.3 (RF-18 a RF-27).

**Esta etapa não tem portão automático que a valide.** `pnpm typecheck` nos quatro pacotes, os 55
testes de integração da API (regressão — nenhum novo, a Etapa B não toca a API) e o build do front
passaram, mas o que ela entrega é tato, e não existe teste de front no projeto: CA-14 a CA-22 estão
implementados e **não verificados à mão**. O que falta conferir está em
[`docs/historico.md`](docs/historico.md).

### Alterado
- **O destino do arraste passa a ser decidido pelo ponteiro** (RF-19): `pointerWithin` primeiro,
  `rectIntersection` quando o ponteiro não está sobre nada e `closestCorners` como último recurso —
  encadeados, nunca somados, porque a pontuação de cada algoritmo está em escala própria e misturar
  as listas ordena por números incomparáveis. O arraste por teclado, que não tem coordenada de
  mouse, cai no fallback retangular e continua com a mesma completude (INV-30).
- **A posição de inserção é contada, não apontada** (RF-18): o índice é quantos cards da coluna têm
  o ponto médio acima do ponteiro, ignorando o card arrastado. Antes era o índice do card sob o
  cursor.
- **O destino aparece como um vão de contorno tracejado**, no lugar do card fantasma em opacidade
  reduzida (RF-22).
- **O gesto ficou mais legível**: cursor de "segurando" durante todo o arraste e animação de
  assentamento ao soltar (RF-23).
- **A rolagem automática ficou mais estreita na horizontal** e mais generosa na vertical (RF-21).
  Com o limiar padrão, a faixa lateral de um board largo engolia a primeira e a última coluna, e
  elas nunca rolavam na vertical.
- **Menos repintura durante o arraste** (RF-25): a lista de cards visíveis devolve a mesma
  referência quando não há filtro, os `items` dos dois `SortableContext` são memoizados e o cartão
  do card só repinta quando os dados dele mudam.
- Nada do arraste por teclado mudou (RF-26): `Espaço` pega e solta, `Esc` cancela, as setas movem e
  cada etapa continua sendo anunciada.
- O PRD da Fase 5 foi corrigido em três pontos, e um deles **renumerou a Etapa C**: RF-18 passou a
  descrever a contagem geométrica com a nota de por que a redação anterior oscilava; RF-20 virou um
  bloco de "já atendido, não implementar"; e entrou o RF-27, descoberto na investigação. A Etapa C,
  que ia de RF-27 a RF-40, agora vai de **RF-28 a RF-41**.

### Corrigido
- **A última posição de uma coluna cheia era inalcançável**, a não ser mirando a margem inferior do
  quadro: como o índice vinha do card sob o cursor, não havia card abaixo do último para apontar.
- **O vizinho trocava de lugar sozinho com a mão parada.** Duas causas somadas: a regra do ponto
  médio se invertia no frame seguinte ao da inserção, e a estratégia de ordenação vertical dos
  cards deslocava de novo o vizinho que o DOM já tinha reordenado (RF-27). As estratégias dos cards
  foram desligadas; as das **colunas** continuam ligadas, porque ali os itens não mudam durante o
  gesto e o deslocamento é o único mecanismo que existe.

---

## [0.4.0] — 2026-08-24

**Etapa A da Fase 5**: tags de card no kanban e busca na lista de tags da barra lateral. As duas
saíram juntas porque são o mesmo gesto — filtrar uma lista de etiquetas por texto digitado —, e
implementá-las em sessões separadas as faria divergir. A Etapa **B** (precisão do arraste) saiu logo em seguida, na
`0.5.0`; a **C** (copiar nota e editor ao vivo) não começou: a Fase 5 **não** está concluída.

Os quatro pacotes vão a `0.3.0`. `packages/shared` mudou contrato — `CardSummary` e `cardInputSchema`
ganharam `tags` —, e a regra do projeto manda bumpar junto quem consome o contrato: `apps/api`,
`apps/web` e `apps/mcp`. Requisitos em [`docs/old/prd-fase-5-refino.md`](docs/old/prd-fase-5-refino.md).

### Adicionado
- **Tags de card no kanban** (RF-01 a RF-07): até 8 etiquetas livres por card, com até 24
  caracteres cada, criadas ao digitar no painel do card — não existe tela de cadastro. O seletor
  oferece as tags já em uso naquele board, ordenadas por quantidade de cards, para que marcar o
  segundo card com o mesmo assunto seja escolher e não redigitar. A face do card mostra três
  etiquetas e resume o resto em `+n`.
- **Barra de filtro por tag acima das colunas** (RF-08 a RF-10). O filtro é **OU**: duas tags
  selecionadas mostram os cards que tenham qualquer uma das duas. Cada coluna passa a exibir
  `visíveis de total` enquanto o filtro estiver valendo. É local — não vai para a URL, não sobrevive
  a recarregar a página nem a trocar de board.
- **Busca no cartão de tags da barra lateral** (RF-12 a RF-17): campo acima da lista, casando por
  trecho, sem acento e sem caixa (`progr` acha `programação`). Uma tag ativa como filtro continua
  visível mesmo que não case com o texto — esconder um filtro que está valendo faria a tela mentir.
  Com texto digitado o campo declara quantas tags de quantas está mostrando; `Esc` limpa o texto e,
  já vazio, devolve o foco à lista; nenhuma tag casando, o cartão diz qual termo não achou nada.
- Migration `20260824215324_tags_do_card`: coluna `tags` (`text[]`) na tabela `card`. **Sem índice**
  — o filtro roda no cliente sobre o board que `GET /boards/:id` já devolve inteiro, e índice sem
  consulta que o use é peso morto na escrita.
- Oito testes de kanban: normalização, fusão por acento e caixa, corte da tag longa em vez de
  recusa, `422` ao passar de 8 tags sem gravar nada, tags na face de cada card, e preservação das
  tags ao salvar só o título, ao mover e ao arquivar.

### Alterado
- **Reverte o NO6 da Fase 2** ("etiquetas próprias do card não; tags são de nota"). O uso mostrou
  que assunto e estágio são eixos independentes: a coluna diz em que ponto o card está, a tag diz de
  que assunto ele é, e forçar os dois no mesmo eixo multiplicava colunas.
- `CardSummary` passa a trazer `tags` e `cardInputSchema` a aceitá-las; `CardDetail` e
  `cardUpdateSchema` herdam. **Nenhum endpoint novo:** o catálogo de tags de um board é derivado dos
  cards que a resposta do board já traz, e um `/boards/:id/tags` seria segunda fonte de verdade para
  a mesma informação.
- O texto da tag é normalizado no servidor mesmo já tendo sido normalizado no front, e duas tags que
  só diferem por acento ou caixa são fundidas numa só, prevalecendo a primeira grafia recebida
  (RN-01, RN-02). `tags` só é gravada quando vem na requisição, para que salvar só o título de um
  card não zere as etiquetas dele.
- **Com filtro de tag ativo, mover card fica desabilitado — mouse e teclado** (RN-05). O índice de
  destino é contado sobre a lista renderizada; filtrada, "soltar na segunda posição" viraria a
  segunda posição do recorte e o servidor renumeraria a coluna inteira em cima disso. Recusar o
  gesto, com o motivo escrito no quadro e um botão para limpar o filtro, é mais honesto que traduzir
  índices.
- O servidor MCP mostra as tags na linha de cada card (RF-11), e a descrição de `get_board` passou a
  dizer que elas agrupam por assunto num eixo independente da coluna. O resource
  `yubook://board/{id}` herda sem alteração, porque formata pela mesma função.
- A revisão passou a ter o que cobrar: `invariantes-yu-book` ganhou INV-33 (arraste desligado sob
  filtro) e INV-34 (as duas noções de tag não são para ser unificadas), e `contrato-compartilhado`
  ganhou `normalizarTag` no catálogo de espelhamentos que quebram em silêncio.
- `PROPOSTA.md` virou [`docs/old/PROPOSTA-inicial.md`](docs/old/PROPOSTA-inicial.md) e
  `docs/prd-mcp-resources-e-prompts.md` foi para `docs/old/`. Os dois são registro do que se decidiu
  na época, não descrição do estado atual. As referências no README acompanham.

---

## [0.3.0] — 2026-08-24

Etapas 2 e 4 do servidor MCP: com elas o servidor passa a expor as três primitivas do protocolo —
tools, resources e prompts — e as propriedades de contrato que elas exigiram. **Nenhuma migration
nesta versão:** as colunas já existiam na tabela; o que mudou foi o que a API expõe (RF-25).

Os quatro pacotes vão a `0.2.0`. `packages/shared` mudou contrato, e a regra do projeto manda bumpar
junto quem consome o contrato — `apps/api`, `apps/web` e também `apps/mcp`, que importa os mesmos
tipos. Requisitos em [`docs/old/prd-mcp-resources-e-prompts.md`](docs/old/prd-mcp-resources-e-prompts.md).

### Adicionado
- **Resources do servidor MCP** (RF-01 a RF-06): `yubook://notas`, `yubook://boards`,
  `yubook://tags` e `yubook://workspaces`. São índices — identificam e rotulam, sem corpo de nota
  nem descrição de card. O catálogo de notas para em 200 itens e **declara o total real quando
  corta** (RNF-01): cap silencioso faz o modelo concluir que o acervo é só aquilo. Notas na lixeira
  não aparecem.
- **Resource templates** `yubook://nota/{id}` e `yubook://board/{id}` (RF-07 a RF-10) — o conteúdo
  sob demanda, endereçado por uuid, para que renomear uma nota não invalide uma URI já injetada no
  contexto de alguém. Verificado contra a API de produção: `yubook://nota/{id}` e a tool `get_note`
  devolvem os mesmos 5080 bytes, caractere a caractere (CA-05).
- **Prompts** `revisao_semanal` e `retomar_contexto` (RF-13 a RF-18). Buscam pelas tools e declaram
  o que **não** fazer: não inventar prazo que não veio da API, não embutir conteúdo de nota na
  própria mensagem, citar o `id` de cada nota mencionada.
- **Tool `get_dashboard`** (RF-11, RF-12): prazos vencidos, prazos dos próximos sete dias, notas
  editadas recentemente e o tamanho da fila de links, numa requisição só. É a fonte dos prompts —
  nenhum deles remonta esse recorte por conta própria.
- Nono agente especialista, `mcp`, dono de `apps/mcp`, e a sétima skill, `servidor-mcp-yu-book`. O
  agente opera em dois modos: criar ou alterar uma primitiva, e verificar propagação depois que o
  domínio mudou (RF-38i a RF-38m, RF-50a).

### Alterado
- `CardSummary` passa a trazer `updatedAt` (RF-23). "O que está parado" é uma pergunta sobre o
  quadro inteiro, e respondê-la exigia uma requisição por card. `CardDetail` herda a propriedade em
  vez de declarar a sua.
- `GET /notes/titles` passa a devolver `NoteTitle`, com o nome do workspace e `updatedAt` (RF-24).
  Um endpoint só serve ao autocomplete de `[[…]]` no front e ao catálogo do servidor MCP.
- A tool `get_board` passa a formatar pela mesma função do resource equivalente (RF-19): tool e
  resource são duas superfícies do mesmo recurso, e o que se duplica de propósito é a superfície,
  nunca a implementação.
- O `revisor` ganhou um passo no checklist: diff que toca `packages/shared/src` vira observação de
  que o agente `mcp` deve rodar no modo de propagação.
- `docs/casos-para-conteudo.md` foi para `docs/temp/` — é matéria-prima de outro projeto, não
  documentação técnica do Yu-book.

### Corrigido
- O catálogo de notas era orçado em "~40 bytes por nota", número que nunca foi medido e que chegou a
  ser copiado para um requisito não funcional. A medição real dá ~100 bytes, porque o uuid sozinho
  ocupa 36 caracteres. Corrigido no comentário de `titulos()` e em RNF-01, que passou a limitar o
  catálogo por **quantidade** de itens em vez de por tamanho de acervo.
- JSDoc duplicado em `titulos()`: o comentário antigo sobreviveu a uma reescrita e ficou empilhado
  com o novo.

---

## [0.2.0] — 2026-08-22

Infraestrutura de trabalho e a primeira etapa do servidor MCP. **Nenhum dos serviços deployados
mudou**: `apps/api`, `apps/web` e `packages/shared` seguem em `0.1.0`. O pacote novo `apps/mcp`
nasce em `0.1.0`.

### Adicionado
- **Servidor MCP do Yu-book** em `apps/mcp` (Etapa 1 — só leitura, transporte stdio), com as tools
  `search_notes`, `get_note`, `list_boards` e `get_board`. Registrado em `.mcp.json`.
  Verificado contra a API de produção: as quatro tools respondem sobre dados reais.
- `pnpm --filter @yu-book/mcp verificar`, diagnóstico que confirma `/health`, `/health/db`, o login
  e a contagem de notas antes de conectar um cliente.
- **Estrutura `.claude/` de trabalho:** oito agentes especialistas, seis skills e memória
  persistente por agente, com `CLAUDE.md` como contexto mínimo. Requisitos em
  [`docs/old/prd-agentes-e-skills.md`](docs/old/prd-agentes-e-skills.md).
- `CHANGELOG.md` e `docs/historico.md`.

### Alterado
- Os PRDs de fase foram arquivados em `docs/old/`; as referências no README, no `CLAUDE.md` e nas
  skills acompanham o novo caminho.
- `pnpm build` na raiz passa a compilar também `@yu-book/mcp`.

---

## [0.1.0] — 2026-08-20

Fases 0 a 4 do projeto, entregues sem release intermediário. Reconstruída retroativamente a partir
dos PRDs de fase e do histórico do git.

### Adicionado

**Fundação (Fase 0)**
- Monorepo pnpm com `apps/api` (Fastify + Prisma + Postgres), `apps/web` (React + Vite + Tailwind) e
  `packages/shared` (schemas Zod usados pelos dois).
- Autenticação de dois tokens: access JWT HS256 de 15 min mantido em memória no front, e refresh
  opaco de 7 dias em cookie `httpOnly` guardado como hash no banco, com rotação a cada uso,
  detecção de reuso e consumo atômico.
- Deploy na Railway em três serviços a partir do mesmo repositório, com `prisma migrate deploy` no
  boot e healthcheck em `/health` e `/health/db`.

**Notas (Fase 1)**
- CRUD de notas com uma entidade `Note` e um campo `kind` (`aula`, `projeto`, `trilha`, `trabalho`,
  `livre`), com campos livres por tipo em `meta` (JSONB).
- Editor Markdown com preview lado a lado e autosave 800 ms depois da última tecla, com 3 novas
  tentativas a cada 5 s em caso de falha de rede (RF-14, RF-17).
- Links `[[wiki]]` entre notas, com backlinks no rodapé, autocomplete ao digitar `[[` e criação da
  nota a partir de um link que ainda não existe.
- Busca full-text em português com `unaccent` e stemming, ranking com título pesando mais que o
  corpo, e queda para similaridade por trigrama quando não há resultado exato.
- Tags, workspaces e lixeira reversível.

**Workspace global e kanban (Fase 2)**
- Seletor de workspace que troca o contexto da aplicação inteira e sobrevive a recarregar a página.
- Boards por workspace, nascendo com `A fazer`, `Fazendo` e `Feito`; cards com prazo, prioridade,
  checklist e descrição em Markdown.
- Movimentação por mouse e por teclado, com as duas fazendo a mesma coisa e cada etapa anunciada
  para leitor de tela; posições renumeradas em transação, sem empate nem buraco (RN-01).
- Vínculo card ↔ nota nos dois sentidos, e cards nos resultados da paleta de busca.

**Gaveta de links (Fase 3)**
- Duas listas — favoritos e "ver depois" — numa entidade `Link` com um campo `kind`.
- Captura arrastando o link de outra janela para qualquer ponto da aplicação, com `Ctrl+V` como
  alternativa dentro da gaveta.
- Leitura do título da página no servidor, tratada como origem hostil: recusa endereço privado, de
  laço, link-local e CGNAT, revalida a cada redirecionamento, lê no máximo 512 KB e desiste em 2 s.
- Identidade visual por bloco de cor derivada do domínio, sem favicon — buscar o ícone entregaria a
  um terceiro a lista de tudo que se guarda.

**Dashboard e tema claro (Fase 4)**
- Tela inicial em `/` com prazos vencidos e da semana, notas recentes e o tamanho da fila de links,
  tudo em uma requisição e nada dali escrevendo.
- Tema claro além do escuro, com a escolha aplicada antes da primeira pintura para não piscar ao
  carregar. Contraste dos dois temas verificado por cálculo em 74 pares texto/fundo, em WCAG AA.

**Vídeos do YouTube na gaveta**
- Título lido pelo oEmbed, miniatura montada a partir do id do vídeo sem requisição no salvamento, e
  duração quando existir `YOUTUBE_API_KEY` no ambiente.

### Alterado
- Navegação lateral redesenhada: ícones próprios em SVG na grade 16×16, seções recolhíveis que
  continuam mostrando o filtro ativo quando fechadas, e tags num cartão próprio.
- Cache do front após salvar deixa de invalidar seis consultas por pausa de digitação e passa a
  costurar a resposta, com uma requisição.
- `GET /notes` passa a truncar o trecho no banco em 600 caracteres, em vez de trazer o corpo inteiro
  de 50 notas — 4,2 MB para 24 KB por página, medido com notas de 100 KB.
- `GET /notes/counts` passa de quatro `count` para uma varredura com `FILTER`.
- `note_link` só é recalculado quando o conjunto de `[[…]]` muda.
- Respostas da API passam a ser comprimidas com gzip acima de 1 KB.
- O kanban vira um chunk carregado sob demanda: bundle inicial de 600 KB para 525 KB.

### Corrigido
- Build da Railway falhava por poda de `devDependencies`; `NODE_ENV=production` passou a valer só no
  runtime, não no build.
- Node fixado em 22 nos dois serviços.

### Segurança
- Contraste do tema escuro corrigido: branco sobre `accent-500` estava em 4,47:1, abaixo do mínimo
  de 4,5 do WCAG AA.
- Rate limit de 10 tentativas por 5 minutos por IP no login, e custo constante para email
  inexistente, para que o tempo de resposta não revele quais contas existem.
- Cadastro fechável por `ALLOW_SIGNUP`, com padrão fechado em produção.

[Não lançado]: https://github.com/yjdutra/Yu-book/compare/5fb0f52...HEAD
