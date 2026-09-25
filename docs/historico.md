# Histórico de contexto

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo. Aqui ficam as
**decisões** e os porquês; o que mudou fica em [`../CHANGELOG.md`](../CHANGELOG.md).

O que entra: decisão tomada e alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que não entra: relato de "o que
eu fiz hoje" sem decisão dentro.

---

## 2026-09-25 — Frente de IA, Etapa F: agendamento, e quem dispara

Quarta etapa do [plano de agentes de acervo](plano-agentes-de-acervo.md), feita no mesmo dia da
emenda à E. O que mudou está na `[0.22.0]` do changelog, e os requisitos na seção 5.8 do PRD de IA
(RF-65 a RF-69, RN-20 a RN-23, CA-38 a CA-42). A E já tinha decidido que haveria trabalho de fundo.
Coube à F decidir quem dispara e o que fazer quando o horário não pode rodar.

**Agendador interno à API, e não o cron da Railway.** O plano geral deixava as duas opções abertas.
O cron da Railway seria um serviço a mais chamando a API, e isso pede autenticação de máquina: um
segredo novo e uma rota que aceita chamada sem usuário. O relógio interno é um `setInterval` de
60 s com `.unref()`, ao lado da varredura de execuções da E. Ele liga no boot e para no SIGTERM, e
inicia pelo mesmo `iniciar` do "Rodar agora", com o `userId` do dono. O preço: as duas instâncias do
deploy rodam o relógio juntas. Quem garante que um horário roda uma vez é o único
`(routine_id, scheduled_for)` (INV-60). No SIGTERM a volta da agenda é **aguardada** antes de
`encerrarExecucoes`, para que um horário não comece uma execução enquanto as vivas são gravadas
`interrompida`.

**Tentativas limitadas por causa de custo** (decisão do operador). A recusa no início pode vir de
outra execução em andamento, de falta de ideia, do teto do dia ou de rotina inválida. Qualquer uma
tenta de novo a cada 5 minutos, até 3 tentativas, e depois fica `pulada` com o motivo. Recusa não
chama o provedor e não custa nada. **Uma execução que começou nunca é repetida**, nem quando falha
no meio, porque repeti-la cobraria de novo a cada tentativa. Descartadas: não tentar de novo, que
faria um horário se perder por uma execução manual que acabou um minuto depois; e repetir também a
execução que falhou, que é o risco de custo apontado pelo operador.

**A `pulada` é o estado do horário, não só o desfecho.** O plano admitia uma linha `pendente`
separada. Ficou uma linha só por horário:

- a primeira recusa cria a linha `pulada`, com `attempts: 1`;
- a tentativa seguinte a **converte** em execução, com UPDATE condicional a `status: pulada` **e**
  ao `attempts` que ela viu;
- uma nova recusa soma `attempts` com a mesma condição;
- com `attempts: 3`, a linha fica definitiva.

A corrida entre instâncias fecha pelo único, na criação, e pelo `count` zero da escrita condicional
nas tentativas seguintes. Nenhum caminho do motor grava `pulada`, e por isso uma execução que
começou nunca volta a ser tentativa. O preço é um status que muda de sentido com `attempts`:
enquanto houver tentativa pela frente, a `pulada` não é final. Para a tela não dizer "pulada" antes
da hora, `proximaTentativa` (em `packages/shared`) serve ao agendador e à tela.

**Janela de 15 minutos, que não alcança horário anterior à última gravação da rotina.** A janela
cobre as três tentativas (0, 5 e 10 min) e um reinício curto. Horário perdido com a API fora por
mais tempo não é recuperado: rodar às 14h o post das 8h não é o que se pediu. Sem limite do outro
lado, porém, ligar a agenda, "Retomar" ou pôr um horário que venceu há poucos minutos dispararia na
hora uma execução que ninguém pediu, e que custa. Por isso um horário sem linha só conta se for
posterior ao `updatedAt` da rotina. O efeito colateral aceito: editar qualquer campo no minuto
seguinte a um horário vencido e **ainda não atendido** pula esse horário. Isso só acontece com a API
fora ou atrasada naquele minuto, e errar para o lado de não gastar foi o que se pediu. Um horário que
já tem linha segue as tentativas, e a edição não as desfaz.

**"Visto" por conta, não por navegador.** O "desde a última visita" do Início grava
`ai_preference.runs_seen_at`, porque o operador usa mais de um dispositivo, e um `localStorage`
mostraria a mesma execução como nova em cada um. O Início manda o `ate` que o próprio
`GET /dashboard` devolveu, e não "agora". Assim, uma execução que termina entre a leitura e a marca
não some sem ter sido vista, e o marco só anda para frente.

**Menores:**

- Uma rotina com defeito não derruba a volta das outras. O erro é registrado e a volta segue.
- `comoSeFosseUtc` saiu de `formato.ts` para `agenda.ts`, e `diaParaPrazo` passou a usar
  `instanteLocal`. O comportamento foi comparado com a versão antiga em cerca de 92 mil casos. O
  ano de 0001 a 0099 foi conferido à parte para manter a frase de erro, porque `Date.UTC` joga esses
  anos para 1900–1999.
- A volta recebe `agora`, `registro` e `somenteDe` como obrigatórios, sem valor padrão (regra da
  convenção). A suíte roda no banco real, sem relógio falso.

**A versão abre a `[0.22.0]`, com bump dos quatro pacotes.** Pela regra do `changelog-e-versao`
§3.1, a F **caberia** na `[0.21.0]`: move o mesmo conjunto de pacotes, e nada foi publicado. A
emenda à E entrou lá por esse caminho. Não se fundiu porque a emenda corrigia e completava a própria
E, e a F é etapa nova, com seção própria no PRD. Cada uma das etapas C, D e E teve heading e bump
próprios mesmo sem publicação, e fundir a F apagaria no changelog a fronteira entre "rodar à mão" e
"rodar sozinha".

**Dívida: nada foi conferido na tela.** Os portões cobrem o servidor e o contrato, e nenhum deles
monta um componente. Roteiro do plano, **somado** aos das Etapas C, D e E e ao da emenda:

1. Agendar uma rotina para daqui a 2 minutos. Conferir o selo, as "Próximas" e o relógio no painel,
   e a execução nascendo sozinha com "agendada".
2. Pausar e retomar com um clique, também com o rascunho sujo.
3. Provocar uma recusa (por exemplo, esvaziar a coluna de ideias). Ver as 3 tentativas e a `pulada`
   com o motivo no histórico, no painel e no Início.
4. No Início, o bloco Rotinas com "desde a última visita". Recarregar e ver o marco avançar.
5. Teclado, os dois temas e `prefers-reduced-motion`.

**Ficou pendente:**

- A conferência acima e as das etapas anteriores.
- O comportamento real com duas instâncias no deploy da Railway. Ele foi testado simulando duas
  voltas simultâneas no mesmo banco, e nunca num deploy.
- As ferramentas web, na Etapa G.

---

## 2026-09-25 — Frente de IA, emenda à Etapa E: a rotina que começa num pedido, e o editor que quebrava

O operador fez a primeira conferência da E em `/assistente/rotinas/novo`. O que ele viu gerou uma
emenda no dia seguinte, antes de qualquer push. O que mudou está na `[0.21.0]` do changelog, e os
requisitos na seção 5.7 do PRD de IA, emendada (RF-55 e RF-57, RF-63 e RF-64, RN-18, CA-35 a CA-37).

**O que ele viu na tela.** O painel lateral transbordava o cartão em cerca de 100 px, o título do
passo vazava do bloco e o cabeçalho sticky aparecia cortado no topo. As causas, achadas no código e
não na tela:

- os `<fieldset>` do painel têm, por padrão do navegador, `min-inline-size: min-content`, e a lista
  de agentes, com `truncate`, alargava a única coluna da grade;
- o `items-start` do botão do bloco anulava o `truncate` do título;
- a linha de cima não usava a mesma grade da de baixo;
- a linha de destaque do painel era estreita;
- o corte do cabeçalho tem causa **provável**, não confirmada: o `scrollIntoView` no mount rolava
  também os ancestrais. Foi trocado por `rolarLinhaAte`, que só mexe no `scrollLeft` do contêiner
  do fluxo.

**A rotina era específica demais.** Ela sempre partia de uma coluna de ideias. O operador quer que
ela possa começar direto no agente, com um pedido fixo. Decisões dele:

- **A saída pode ser card ou nota**, e a escolha vale para os dois tipos de entrada.
- **Ferramentas web ficam na Etapa G.** Os exemplos que motivaram o pedido ("dar um ping numa
  página", "usar a busca do OpenRouter") pedem ferramenta que olha fora do acervo, com SSRF,
  domínios permitidos e custo a decidir. Isso não cabe numa emenda. Até a G, um pedido desses roda,
  mas o agente não tem com que cumpri-lo.

Decisões de implementação que não se veem na tela:

- **RN-18 fica restrita à entrada por coluna.** No pedido não há o que consumir, e rodar de novo é
  rodar de novo. **RN-19 fica intacta**: uma execução por vez vale para os dois tipos, pelo mesmo
  índice parcial.
- **Título de nota que colide não falha a execução.** A execução já pagou os passos, e perder o texto
  por um título repetido seria o pior desfecho. A primeira tentativa acrescenta
  ` · DD/MM/AAAA HH:MM` no fuso de `/ajustes`, e a segunda um trecho do `runId`. Descartada:
  recusar no início, porque o título de `primeira_linha` só se conhece no fim.
- **O workspace da nota não tem chave estrangeira**, de propósito, como as colunas da rotina. A posse
  é conferida no service, com o mesmo 404 de um id inexistente. Com um workspace excluído depois, a
  rotina passa a listar um problema na saída, em vez de a FK decidir por ela.
- **Migration nova em vez de editar as da E.** As migrations da E ainda não subiram, mas o banco de
  dev guarda a conta real e já as aplicou.
- **O modelo "Pedido direto" usa o agente Marketing.** O LinkedIn impõe forma de post, e o Revisor é
  instruído a não reescrever. Os dois brigariam com um pedido qualquer num passo "reescreve".

**A versão continua `[0.21.0]`, sem bump novo.** A emenda muda o contrato de `packages/shared` e
move os mesmos quatro pacotes que a E já moveu. Pela regra do `changelog-e-versao` §3.1, duas entregas
cabem numa entrada quando movem o mesmo conjunto de pacotes. Nada da `[0.21.0]` foi publicado:
`origin/master` para no redesenho, e C, D e E só existem localmente. Abrir a `[0.22.0]` registraria
como "corrigido" um editor quebrado que nunca chegou a ninguém. O preço aceito: o commit `bb574a8`
tem `packages/shared` em `0.10.0` com um contrato diferente do `0.10.0` final. Como não há tag nem
deploy desse commit, ninguém depende dele.

**Dívida: o conserto não foi conferido na tela**, e o resto da E continua sem conferência. Os
portões cobrem o servidor. O typecheck dos quatro pacotes e os 57 testes do MCP foram medidos neste
fechamento, e os 240 testes da API foram relatados pela sessão de implementação. Nenhum deles monta
um componente. Roteiro do plano da emenda, **somado** ao de oito itens da E:

1. Em `/assistente/rotinas/novo`, com um agente de descrição longa: o painel lateral não transborda,
   o título do passo trunca, o cabeçalho aparece inteiro, e a estimativa se alinha com o painel.
   Conferir também o `EditorAgente`, que tem o mesmo cabeçalho sticky.
2. O modelo "Pedido direto": rodar e ver a nota com a faixa "via rotina" e o "Abrir nota". Rodar de
   novo com um título fixo: a segunda nota ganha data e hora.
3. Uma rotina por coluna com saída em nota: a ideia se move como antes.
4. Trocar o tipo de entrada no painel: os blocos e a validação acompanham, e o grupo "A ideia usada"
   some com o pedido.
5. Teclado, os dois temas e `prefers-reduced-motion`.

**Ficou pendente:**

- A conferência acima, a da E e as das Etapas C e D.
- As ferramentas web, na Etapa G.

---

## 2026-09-24 — Frente de IA, Etapa E: rotinas, e o trabalho assíncrono que o Yu-book recusava

Terceira etapa do [plano de agentes de acervo](plano-agentes-de-acervo.md), entregue no mesmo dia da
C e da D. O que mudou está na `[0.21.0]` do changelog, e os requisitos na seção 5.7 do PRD de IA.
Aqui ficam as decisões.

**O Yu-book passa a ter trabalho assíncrono, e isso revoga uma decisão registrada.** Três documentos
diziam o contrário:

- o roteiro de IA aplicada, na tabela que separa o Yu-book da mesa de trabalho: "Trabalho
  assíncrono: nenhum, por decisão" (`applied-ai-read-trip.md:261`);
- o PRD de IA, nas restrições técnicas, que previa a questão para a busca semântica (Fase 4 dele) e
  exigia que "não entrasse por inércia";
- a Q-03 do mesmo PRD, que perguntava como fazer o backfill sem fila de jobs.

O operador decidiu que **a execução de uma rotina roda no servidor, desacoplada da aba**. "Rodar
agora" responde `202` na hora, e a tela só acompanha: pode fechar e voltar. Os motivos:

- **A rotina só toca o acervo.** O pior caso continua sendo o do caderno: um card ruim numa coluna.
  Nada é publicado fora do Yu-book, e o que a mesa de trabalho arrisca ("publica no repositório
  errado") não existe aqui.
- **A escrita é do código, só na saída** (RN-16). Nos passos, o modelo só lê. O card de saída e o
  destino da ideia são gravados pelo código, no fim de uma execução bem-sucedida. Um modelo
  desgovernado no meio do fluxo não tem com o que escrever.
- **Dois tetos cortam antes de cada chamada** (RN-17): o da execução e o diário. Uma execução sem
  ninguém olhando não gasta mais do que alguém autorizou.
- **Uma execução longa não pode depender da aba.** São até seis passos, cada um com até cinco
  chamadas ao provedor. Amarrar isso a uma aba aberta faria o custo já pago se perder por um
  fechamento acidental.

A alternativa descartada foi a execução **dentro da requisição**, como o chat: um SSE que é a
própria execução, cortado quando a aba fecha. Ela manteria a regra antiga, mas ao preço do motivo
acima.

**A decisão estava prevista para a Etapa F** (agendamento), no plano geral, e foi tomada na E. A F
herda o mecanismo e não precisa mais decidir se há trabalho de fundo, só **quem dispara**.

**O preço: a execução viva mora na memória da API.** Um `Map` de execuções vivas guarda o
controlador de cancelamento, os assinantes do SSE e o texto parcial do passo em curso. O plano
partia de "a API roda em instância única". **A Railway sobrepõe instâncias no deploy**: a nova sobe
enquanto a antiga ainda atende, e o `Map` de uma não enxerga o da outra. O desenho foi feito para
aguentar essa janela:

- **Pulso** (`heartbeat_at`, a cada 10 s). É ele, e não "estar no meu `Map`", que diz se a execução
  tem dono. A reconciliação só fecha execução de **pulso vencido** (45 s). Roda no boot, a cada 60 s
  e ao iniciar outra execução. Fechar toda execução `em_andamento` no boot, como o plano propunha,
  mataria as da instância antiga no meio de um deploy.
- **Gravações condicionais.** Quem executa só grava o fim se a execução ainda está `em_andamento`, e
  a reconciliação de outra instância não é sobrescrita.
- **Cancelamento e SSE pelo banco.** O pedido de cancelar vira `cancel_requested_at`, que quem
  executa confere no pulso e antes de cada passo. O SSE de uma execução que roda noutra instância
  manda retratos lidos do banco em vez de eventos ao vivo.
- **Índice único parcial para a RN-19**: `ai_routine_run_uma_em_andamento_idx`, em `user_id WHERE
  status = 'em_andamento'`. Com duas instâncias, a conferência "já há uma em andamento?" em código
  tem corrida. O índice não tem.
- **SIGTERM** aborta as execuções vivas e espera cada uma gravar `interrompida` antes do
  `app.close()`.

**Uma execução perdida num redeploy fica `interrompida`, e a ideia volta a ser elegível.** Como a
escrita só acontece no fim, uma execução interrompida não deixou nada no acervo, e o próximo "Rodar
agora" pega a mesma ideia. O custo dela já foi pago e continua contando no teto diário.

**Com o card criado, a execução é `concluida`.** Se o consumo da ideia (mover ou arquivar) falhar
depois disso, ela termina com os avisos `CONSUMO_FALHOU` ou `FINALIZACAO_PARCIAL`, e não `falhou`.
Marcá-la `falhou` com o card já na coluna tiraria da ideia o registro que a torna inelegível (RN-18),
e a próxima execução geraria um segundo post da mesma ideia.

**Risco residual, aceito e declarado.** Entre o último pulso e a gravação do card existe uma janela.
Um laço de eventos parado por uns 45 s, ou relógios divergentes entre as duas instâncias, podem
levar a outra instância a julgar a execução morta e liberar a ideia. Se a execução "morta" ainda
gravar o card, a mesma ideia pode sair em **dois cards**. É o pior caso do caderno, visível na
coluna, e não justifica trava distribuída.

**A idempotência é pelo registro, e não pela posição da ideia** (RN-18). O plano geral dizia "a
ideia consumida sai da coluna ou é marcada". Com a ação de consumo "manter", ela não sai. Um card com
execução concluída ou em andamento desta rotina não é escolhido de novo, qualquer que seja a ação.
Assim a idempotência não depende de o consumo ter dado certo.

**O destino da ideia é configurado na rotina e executado pelo código**, e não pedido ao agente.
Pela RN-14, texto não concede ferramenta. Além disso, `move_card` nem está no chat, e "o agente vai
lembrar de mover" é o contrário de previsível.

**`rotina` entrou em `AiTask` sem virar coluna de modelo.** O enum precisa do valor para o registro
de uso, mas a rotina não tem modelo padrão próprio: cada passo usa o do agente ou o da tarefa
`chat`. `TAREFAS_COM_MODELO`, em shared, mantém o quadro de modelos de `/ajustes` com as duas
colunas de antes.

**O passo com o provedor saiu do chat** (`passoNoProvedor`, em `passo.service.ts`), e o teto diário
foi com ele. O teto da execução entra como `tetoExtra`. A alternativa, uma segunda cópia do passo
no motor da rotina, deixaria duas conferências de teto que divergiriam caladas. O chat ficou com o
mesmo comportamento, com uma exceção: uma falha de `garantirTeto` ou de `registrarUso` que não seja
estouro do teto vira evento `erro`, em vez de escapar do laço. `abrirNoProvedor` ganhou `signal`,
combinado ao timeout por `AbortSignal.any`. Antes o cancelamento não tinha como chegar ao fetch.

**Dívida: a etapa foi entregue sem conferência de interface à mão**, como a C e a D. Os portões
cobrem o servidor. O typecheck dos quatro pacotes e os 57 testes do MCP foram medidos no fechamento,
e os 229 testes da API foram relatados pela sessão de implementação. Nenhum deles monta um
componente. Roteiro de conferência, do plano da etapa:

1. Estado vazio: montar a rotina a partir do modelo "Post do LinkedIn" e ver os blocos ligados, com
   o "+" nos conectores.
2. Inserir o Revisor pelo "+", reordenar por arraste e depois só por teclado, e remover pelo `Menu`.
3. No painel lateral de cada bloco: escolher as colunas, ver a coluna de consumidas limitada ao
   quadro da entrada e ver a estimativa de custo mudar.
4. Com alteração pendente, "Rodar agora" fica desabilitado, com o motivo. Depois de salvar, rodar:
   os blocos acendem em sequência, o texto chega, e custo e tokens aparecem.
5. Fechar a aba no meio, voltar pelo histórico e ver o progresso continuar.
6. Cancelar no meio: a ideia fica na entrada.
7. Ao concluir: o card em "Aguardando publicar" com a faixa "via rotina", o botão "Ver execução" e a
   seção Observações, e a ideia em "Usadas". Rodar de novo pega a próxima ideia.
8. Teclado completo, foco devolvido, os dois temas e `prefers-reduced-motion`.

**Ficou pendente:**

- A conferência acima, e as das Etapas C e D, que seguem em aberto.
- A Q-03 do PRD de IA (o backfill da busca semântica) foi anotada, mas não resolvida. Agora existe
  mecanismo de trabalho de fundo no processo. Se ele serve a um backfill de embeddings, que é longo
  e não tem teto por execução, é a Fase 4 do PRD que decide.
- O `applied-ai-read-trip.md:261` continua dizendo "nenhum, por decisão". É um roteiro com data, e
  esta entrada é o que o revoga.
- `CLAUDE.md` e as skills ainda não falam de rotinas nem de trabalho de fundo. A atualização é do
  `curador`.

---

## 2026-09-24 — Frente de IA, Etapa D: agentes especialistas

Segunda etapa do [plano de agentes de acervo](plano-agentes-de-acervo.md), entregue no mesmo dia da
C. O que mudou está na `[0.20.0]` do changelog, e os requisitos na seção 5.6 do PRD de IA. Aqui ficam
as decisões. As três primeiras são do operador, e o plano geral as deixava em aberto.

**Tabela própria, e não um `kind` de nota.** O plano geral pesava a alternativa: um `kind` novo
reaproveitaria editor, busca e wikilinks, e seguiria a decisão de "uma entidade forte". O operador a
descartou pelo motivo que lhe foi apresentado na escolha: como nota, o agente apareceria na lista de
notas, na busca e no MCP, e o `search_notes` do próprio chat leria as instruções de outro agente;
e o `meta` da nota só guarda valores simples. O agente é quase todo estrutura que nota não tem —
lista de ferramentas conferida contra o catálogo do chat, fontes vivas, modelo e notas-base em
ordem —, que viraria frontmatter validado à mão em cada gravação. O que a nota daria de graça é o que continua sendo nota:
**a premissa mora no acervo**, como nota-base editada no editor de sempre. A portabilidade que o
`kind` traria saiu pela exportação em Markdown com frontmatter (RF-52).

**O agente é fixo por conversa.** Trocar de agente no meio misturaria, no mesmo histórico, respostas
escritas com premissas diferentes, e a marca do que foi criado não diria mais com qual. Trocar de
agente é abrir outra conversa. O nome fica gravado na conversa (`agentName`) porque a FK é
`SetNull`: sem a cópia, excluir o agente apagaria a informação de quem respondeu.

**A área fica dentro de Assistente**, em `/assistente/agentes`, sem item novo no trilho. Um agente é
uma forma de conversar, e o lugar dele é junto das conversas. O efeito colateral foi separar "a
área Assistente" de "a tela do chat" (`naTelaDoChat`). Antes eram a mesma coisa, e o painel lateral
sumia na área inteira. Com a galeria e o editor dentro da área, ir do chat para a galeria com uma
resposta em curso a deixaria sem nenhuma superfície à vista, com o laço pagando (INV-56). O painel
agora só some em `/assistente` exato.

**`formatar` e `chat` continuaram fora do registro de agentes.** O plano geral perguntava se virariam
os dois primeiros agentes "de sistema". Não viraram: `AI_TASKS` segue à parte, o chat sem agente é
o "Assistente" de sempre, e o agente sem modelo próprio usa o da tarefa `chat`.

**Conversa de agente excluído dá 422 ao receber mensagem**, e não segue como o Assistente. Seguir
mudaria quem responde no meio da conversa sem ninguém ter escolhido, e o cabeçalho continuaria com
o nome do agente. A conversa continua legível (CA-27). Continuar exige começar uma conversa nova, que
é o mesmo gesto de trocar de agente. Criar a conversa com um agente excluído no meio do caminho,
entre a conferência e o `create`, dá o mesmo 404 de um agente inexistente. A FK recusa (`P2003`), e
o código confere o nome da constraint para não engolir outra FK violada como "agente sumiu".

**Ao editar, só as referências novas são conferidas.** O editor manda a lista inteira de notas-base
e fontes a cada PATCH. Conferir de novo o que já estava gravado tornaria o agente impossível de
salvar depois de alguém excluir uma coluna usada por ele, até o usuário achar e tirar a fonte, e o
404 nem diria qual era. O que já está gravado passou pela conferência quando entrou. Na montagem,
o que deixou de resolver vira um bloco `indisponivel` com aviso. A prévia faz o mesmo com a coluna:
ela recebe um rascunho, e dizer 404 ali vazaria se a coluna é alheia ou apagada. As notas-base da
prévia são conferidas, porque a prévia as lê inteiras.

**Uma montagem só para a prévia e para o chat.** `montarContextoDoAgente` é chamada pelos dois, e o
que o editor mostra é o que o modelo recebe. Duas montagens divergiriam sem nenhum teste ficar
vermelho, e o RNF-10 é justamente mostrar o preço antes de gastá-lo. A montagem roda **a cada
mensagem** para que a fonte viva e a nota-base editada entre duas mensagens venham frescas. O preço
aceito são as leituras de banco por turno.

**As regras do Yu-book abrem o prompt, e o texto não concede ferramenta** (RN-13, RN-14). O
`INSTRUCOES` estático virou `instrucoesPara(ferramentas)`: as regras que valem sempre vêm primeiro, e
a linha de cada ferramenta só aparece se ela está na lista. A lista é conferida duas vezes, ao
oferecer ao provedor e ao executar, como no INV-52. Oferecer uma lista estreita não basta, porque o
modelo pode pedir pelo nome uma ação que não recebeu. Agente sem ferramenta nenhuma manda a
requisição sem `tools`, e por isso deixa de exigir modelo que saiba chamar ferramenta.

**O corte das premissas é por bloco inteiro e declarado**, dentro de 40 000 caracteres, reusando o
`montarContexto` dos anexos. Cortar no meio de uma nota-base daria ao modelo metade de um guia sem
que ninguém soubesse. Os cortados vão no evento `inicio` (`premissasCortadas`), separados dos
anexos cortados.

**Dívida: a etapa foi entregue sem conferência de interface à mão**, como a C. Os portões cobrem o
servidor: 200 testes na API, 56 no MCP e o typecheck dos quatro pacotes, medidos no fechamento.
Nenhum deles monta um componente. Roteiro de conferência, do plano da etapa:

1. Estado vazio da galeria: "Usar este modelo" no Especialista em LinkedIn, com as notas sugeridas,
   e salvar.
2. No editor, escolher notas-base e adicionar a fonte viva "coluna Publicado". A prévia muda
   caracteres e custo, e uma nota enorme aparece como "cortada".
3. Ligar e desligar ferramentas. As de escrita mostram o selo.
4. Conversar com o agente pelo painel contextual. O cabeçalho mostra o agente, e a resposta usa as
   premissas.
5. Pedir para criar um card. A marca diz o agente.
6. Tentar trocar de agente numa conversa começada: o seletor está fixo, e "nova conversa" o libera.
7. Excluir o agente. A conversa continua legível, com o nome guardado.
8. Exportar em `.md` e abrir o arquivo.
9. Teclado completo, foco devolvido, temas claro e escuro, `prefers-reduced-motion`.

**Ficou pendente:**

- A conferência acima, e a da Etapa C, que também segue em aberto.
- **"Nova conversa" ou escolher outra conversa em `/assistente` com uma resposta em curso escondem a
  resposta sem parar o laço.** O defeito é anterior à D. A D só pôs o aviso no caminho novo, o da
  conversa pedida de fora.
- **O Voltar do navegador não passa pela guarda de saída do editor.** Ela intercepta a navegação
  dentro do app e o fechamento da aba (`beforeunload`), mas não o botão Voltar.
- `CLAUDE.md` e as skills ainda não falam de agentes. A atualização é do `curador`.

---

## 2026-09-24 — Frente de IA, Etapa C: a marca de conteúdo gerado, e o chat que passou a escrever

A Etapa C abre o [plano de agentes de acervo](plano-agentes-de-acervo.md), aprovado hoje. As
Etapas D a G vão escrever no acervo, e o NO2 revisto só permite isso **com o conteúdo marcado no
dado**. Por isso a marca veio primeiro. O que mudou está na `[0.19.0]` do changelog, e os requisitos
na seção 5.5 do PRD de IA. Aqui ficam as decisões.

**A exploração do código desmentiu três premissas do plano geral.** Elas foram corrigidas no plano
da etapa e registradas em "Como ficou", no plano geral:

- **O chat não escrevia.** As quatro ações de escrita não tinham executor, e o prompt dizia que ele
  só sabia ler. Não havia "ferramenta de escrita que passa a gravar a marca". Era preciso **ligar**
  a escrita, e o operador decidiu ligar só `create_card` e uma ação nova, `create_note`.
- **O único caminho que já gravava texto de modelo era o MCP**, e a API não sabia quem chamava: o
  MCP se apresentava com o mesmo cabeçalho do front. Esse caminho ganhou a marca também.
- **O RNF-09 citado no plano não existia no PRD de IA**: era das fases de produto, porque os números
  colidem entre PRDs. Nasceu lá com o mesmo sentido, marca que não depende de cor.

**O catálogo do chat virou lista explícita.** `FERRAMENTAS_DO_CHAT` tem as cinco leituras mais as
duas criações. A alternativa era "todas menos mover, apagar e restaurar", e foi descartada: com ela,
qualquer ação nova em `ferramentas.ts` chegaria ao chat só por existir, sem ninguém decidir. A
segunda condição de antes continua valendo: ação sem executor não é oferecida. A RN-03 foi emendada
em vez de revogada. O pedido do usuário é a iniciativa, o Desfazer é a reversão e a marca impede a
confusão com o texto dele.

**A marca é gravada só pelo servidor, e o `origin` do contrato só aceita `mcp`.** O chat passa a
origem ao service por parâmetro, sem passar pelo corpo de requisição nenhum. Aceitar `via: "chat"`
em `origin` deixaria um cliente HTTP qualquer se passar pelo assistente, com um `conversationId`
alheio. Pelo mesmo motivo, **"Virar nota" não recebe o texto do cliente**: conteúdo, modelo e
conversa saem da `AiMessage` gravada. Aceitar o corpo do navegador permitiria gravar nota com a
assinatura de um modelo que nunca a escreveu. Só a fala do assistente vira nota. Marcar como gerada
a fala do usuário seria mentir no dado.

**O autor no MCP é rótulo, não identidade.** Sob HTTP vale o `client_name` do cadastro OAuth, porque
é o nome que o usuário leu na tela de consentimento antes de liberar a escrita. O `clientInfo` do
`initialize` fica de recuo, e é a fonte no stdio. Ler o nome do ambiente foi descartado, porque daria
o mesmo autor para todo cliente. Nenhum desses nomes autoriza nada: quem autoriza é a trava de
escrita.

**A marca nunca some, e só a mudança de fato no texto é revisão.** "Gerada e revisada" é um estado.
Deixar de ser gerada não é: editar à mão preenche `aiRevisedAt` e mantém a origem, e nenhuma rota
remove a marca. O "de fato" existe porque o autosave e o painel do card reenviam campos inalterados.
Sem a comparação, abrir e fechar uma nota a daria como revisada. Favoritar, mover, arquivar,
etiquetar e trocar de workspace não contam. Apagar a conversa de origem leva só o link (`SetNull`),
e a marca fica.

**Formatar com IA não marca, mas o autosave dele conta como revisão.** As duas partes foram decididas
pelo operador. Não marca porque formatar reorganiza o texto do usuário, sem gerar texto novo
(RF-42). Conta como revisão porque é uma edição do texto que o usuário iniciou, e o PATCH não sabe de
onde veio a mudança. Para não contar, o cliente teria que declarar "isto não é revisão", e isso é o
cliente afirmando algo sobre a marca, que a RN-10 não permite. O efeito aceito: formatar uma nota
gerada a mostra como "revisada".

**O que a resposta criou é gravado em qualquer saída do turno.** `AiMessage.created` é preenchido num
`finally`. Um turno interrompido, pelo painel fechado, pelo teto ou por erro, pode já ter criado
card ou nota. Isso existe no acervo e precisa continuar desfazível pelo histórico, e não só enquanto
o stream está aberto.

**Desfazer card exclui de vez.** Card não tem lixeira, e a rota de exclusão já existia. Nota vai para
a lixeira, de onde volta. A assimetria foi aceita em vez de criar uma lixeira de card nesta etapa.

**`formatarNota` passou a exigir o fuso**, porque a linha da marca tem dia. É o mesmo motivo de
`diaDoPrazo`: um conteúdo gerado às 22h em UTC−3 não foi gerado "amanhã". Sem valor padrão, como lá.
O preço está no MCP: `get_note` e `yubook://nota/{id}` fazem um `GET /ai/settings` a mais, em
paralelo. Não houve cache, pela mesma razão registrada em `apps/mcp/src/fuso.ts`.

**`AiVia` tem só `chat` e `mcp`.** Rotina e agente, das Etapas D e E, entram por migration aditiva
quando existirem. Um valor sem produtor seria um estado que ninguém testa.

**Correção de segurança anterior à etapa.** `notes.criar` e `notes.atualizar` não conferiam de quem
era o `workspaceId`: a FK só garante que ele existe. Com o id de outra conta, a nota era criada e a
resposta devolvia o nome do workspace alheio. Com um id inexistente, a violação de FK dava outro
erro, e isso permitia distinguir "não existe" de "é de outra pessoa". Agora os dois dão o mesmo 404
(INV-02), como `criarBoard` já fazia. O defeito é anterior à frente de IA e passou pelas revisões.
Veio à tona porque o `create_note` do chat põe nesse campo um valor escrito pelo modelo.

**Dívida: a etapa foi entregue sem conferência de interface à mão.** Os portões cobrem o servidor:
164 testes na API, 55 no MCP e o typecheck dos quatro pacotes. Nenhum deles monta um componente.
Roteiro de conferência, do plano da etapa:

1. No chat, pedir "crie um card X na coluna Y". O card aparece em "Criado nesta resposta", no quadro
   com a marca "IA", e o painel dele mostra a faixa com modelo e link da conversa.
2. "Virar nota" numa resposta: o diálogo, a nota criada, a faixa no editor e o toast "Abrir".
3. Editar a nota à mão: a faixa passa a "revisada", e a lista acompanha sem recarregar.
4. O filtro "Geradas por IA" na barra lateral, com contagem, chip e estado vazio.
5. A marca na paleta de busca e no Início.
6. "Desfazer" no chat manda a nota para a lixeira.
7. Tema claro e escuro, a marca lida sem cor (ícone e texto), e o teclado completo no diálogo e no
   "Desfazer".
8. MCP em stdio local: `create_card` e `create_note` criam com `via mcp` e o nome do cliente.

**Ficou pendente:**

- A conferência acima.
- A descrição de `create_note` aumentou o custo de todo turno do chat. Esse custo não foi medido do
  lado do chat. Do lado do MCP, o `tools/list` com escrita foi de 8551 B para 9601 B.
- `CLAUDE.md` e as skills ainda falam em "nove ações" e num chat que só lê. A atualização é do
  `curador`.

---

## 2026-09-24 — Redesenho de UI concluído: cinco etapas entregues sem ver a tela, e conferidas no fechamento

O redesenho de UI/UX de `apps/web`, aprovado hoje de manhã e posto antes da Etapa C da frente de
IA, fechou com a Etapa 5. São cinco entradas no changelog, `[0.14.0]` a `[0.18.0]`. `apps/web` foi
de `0.9.0` a `0.14.0`, com um minor por etapa, e `apps/api` ganhou um patch, `0.9.1`, na Etapa 4.
Resumo, com a decisão central de cada uma (o detalhe está na entrada da etapa, logo abaixo):

1. **Fundação visual.** Revogou a regra de não ter primitivo genérico: `components/base/` nasceu,
   sem biblioteca de UI atrás, e cada primitivo só entrou quando havia consumidor. Também trouxe a
   Inter pelo Google Fonts, com o IP do operador como preço aceito.
2. **Casca e navegação.** Os filtros de notas foram para a URL e o workspace ficou fora dela
   (RF-02 da Fase 2).
3. **Assistente.** A conversa saiu da vista e foi para uma sessão, porque há duas vistas e expandir
   não pode interromper. A regra do fluxo virou o INV-56.
4. **Ajustes.** No quadro de modelos, o favorito é cópia e o slot de tarefa é o que se move. A
   primeira mutação otimista com concorrência tratada (`onSettled` com `isMutating`).
5. **Polimento.** Primitivos e tokens nas telas antigas, e a gaveta e a paleta viraram `Dialogo`.
   O foco preso obrigou a levar o desfazer para dentro da gaveta.

**As cinco etapas foram entregues sem conferência na tela, e a conferência veio no fechamento.**
Enquanto elas eram entregues, nenhuma foi vista: os portões provam que compila e que o bundle se
forma, e nenhum deles monta um componente, dispara um sensor do `@dnd-kit` ou vê uma cor. A última
entrega conferida à mão antes disso, a Etapa B da frente de IA, tinha achado em minutos um defeito
que nenhum portão via. Por isso a primeira versão desta entrada tratava a conferência como a dívida
maior do redesenho e pedia que ele não fosse dado como pronto antes dela.

**Depois da Etapa 5, ainda em 2026-09-24, o usuário fez a conferência de interface à mão das cinco
etapas (`[0.14.0]` a `[0.18.0]`) e relatou: "Tudo funcionou perfeitamente."** A passada cobre as
correções da Etapa 5: o arraste de cards do kanban e de favoritos da gaveta pelo teclado, e as duas
mensagens de `MODELO_NAO_ESCOLHIDO`. O alcance do registro é esse relato. Não há checklist marcado
item por item, e esta entrada não diz quais itens das listas "O que fica aberto" abaixo foram
exercitados um a um. As listas ficam como estavam, com uma emenda que remete para cá, porque são o
retrato do que cada etapa deixou sem ver quando foi entregue. Os restos da Etapa B da frente de IA
que não pertencem ao redesenho, como o corte pelo teto no meio de uma resposta, não fazem parte
deste relato.

**O arraste de cards por teclado nunca tinha sido exercitado.** O RF-25 da Fase 2 foi dado como
entregue na Fase 2 e de novo na Etapa B da Fase 5, e o card nunca saiu do lugar pelo teclado: o
`Espaço` não chegava ao sensor (entrada da Etapa 5, abaixo). A correção entrou na Etapa 5 sem ser
vista na tela, e está entre o que o usuário conferiu no fechamento. Fica o aviso: "entregue" sem
ninguém exercitar pode significar "nunca funcionou", e aqui significou desde a Fase 2.

**No fechamento, o catálogo passou a vir antes do quadro em Ajustes → Modelos.** O ajuste é do
usuário, sobre a Etapa 4. A ordem da Etapa 4 punha o quadro "Modelo de cada tarefa" em cima e o
catálogo embaixo. O quadro só tem o que arrastar depois que há favoritos, e os favoritos saem do
catálogo. Quem favorita primeiro e arrasta depois agora lê a página de cima para baixo. Os textos
que apontam de uma seção para a outra mudaram junto: "Favorite modelos no catálogo acima", no
quadro sem favoritos, e "Tire-o da tarefa no quadro abaixo", no catálogo. Não há bump novo: a
mudança entrou na `[0.18.0]`, que não foi publicada.

**Dívida técnica que fica:**

- **A janela de concorrência do arraste do kanban.** `useMoverCard` (`lib/kanban.ts`) é otimista
  sem `mutationKey` nem o `onSettled` condicionado a `isMutating`. Dois arrastes seguidos com a
  rede lenta podem ter o rollback de um restaurando o estado otimista do outro, exatamente o caso
  que a Etapa 4 fechou no quadro de modelos. Não foi mexido porque a Etapa 5 tinha como regra não
  tocar na mecânica do arraste (INV-30, INV-33, INV-36), e a correção merece entrega própria, com o
  kanban conferido à mão antes e depois.
- **`apps/web` continua sem runner de teste.** O redesenho não mudou isso. A conferência do
  fechamento vale para esta árvore e não vigia a próxima mudança.

A quinta numeração se encerra aqui. O próximo passo da frente de IA é a Etapa C.

---

## 2026-09-24 — Redesenho de UI, Etapa 5: polimento, e o que o foco preso obrigou a mudar

A última etapa levou os primitivos de `components/base/` e os tokens às telas que ainda escreviam
botão, aviso e esqueleto à mão: dashboard, notas, kanban, card, boards, gaveta de links, paleta,
login e os seletores. É o que a Etapa 1 previa ("as telas migram quando forem redesenhadas, não
numa varredura"). O que mudou está na `[0.18.0]` do changelog; aqui ficam as decisões.

**A gaveta de links virou `Dialogo` lateral, e o desfazer foi junto para dentro dela.** Com o
`Dialogo`, a gaveta ganhou o foco preso e devolvido que ele faz por todos, em vez de uma versão
própria. O efeito colateral apareceu na revisão. O "Desfazer" da remoção era um toast fixo fora da
gaveta, e com o foco preso ele ficava visível e inalcançável pelo teclado. Soltar a trava enquanto
o toast existe foi a alternativa descartada, porque ela desfaria o motivo de usar o `Dialogo`. Por
isso, enquanto a gaveta está aberta, o desfazer aparece dentro dela.

**O colar da gaveta passou a ser ouvido no documento.** O `onPaste` morava na caixa da gaveta.
Com o `Dialogo`, a caixa dele passou a envolver o conteúdo, e o `onPaste` ficou num filho. Um
clique em área vazia deixa o foco na caixa do `Dialogo`, e o evento de colar não passa por filho
nenhum. Colar URL falhava justamente depois do clique que o usuário dá para colar. A regressão
nasceu e morreu nesta etapa, achada pelo revisor, e por isso não está no changelog. O ouvinte no
`document` vive só enquanto a gaveta está montada, e a gaveta só é montada aberta.

**O arraste de favoritos por teclado nunca tinha funcionado.** O item espalhava os `listeners` do
`useSortable` e depois declarava o próprio `onKeyDown`, o do `Delete`, que sobrescrevia o do
sensor. O `Espaço` nunca chegava ao `KeyboardSensor`. Agora os dois handlers são compostos: o do
item roda e depois chama o do sensor. Uma ref (`arrastando`), e não estado, porque só é lida dentro
do handler, impede que as setas do arraste troquem de aba (RF-18 da Fase 3) no meio do gesto. O
defeito é anterior ao redesenho. Nenhum portão o via, e só a leitura do revisor o achou.

**O kanban tinha o mesmo defeito, desde o primeiro commit dele.** Em `ColunaQuadro.tsx`, o card
espalha `{...listeners}` e depois declara o `onKeyDown` do `Enter`, que abre o card. Está assim
desde `9ce64cc` (2026-08-14, Fase 2). O `Espaço` nunca chegou ao `KeyboardSensor`, e mover card só
pelo teclado, que é o RF-25 da Fase 2, nunca funcionou. A correção é a mesma da gaveta: o handler
do card trata o `Enter` e depois chama o do sensor. A mecânica protegida (INV-30, INV-33, INV-36)
não foi tocada. O remapeamento de teclas, a colisão pelo ponteiro e a renumeração são os de antes.
O que mudou foi só o `Espaço` passar a chegar ao sensor. **Todas as fases desde a 2 davam o arraste
por teclado como entregue**, e a Fase 5, Etapa B, mexeu na precisão do arraste sem notar. É o mesmo
padrão de `{...listeners}` seguido de `onKeyDown`. Qualquer item arrastável novo que precise de
tecla própria tem que compor os dois handlers.

**A paleta ganhou comandos, e o `>` separa comando de busca.** Sem prefixo, comandos e resultados
convivem na mesma lista. Com `>`, só comandos, que é a convenção de editores de código. O último
item, "Perguntar ao assistente: «texto»", é o gancho da busca semântica da frente de IA. Ele abre
uma **conversa nova** e **não envia**, pelos mesmos dois motivos do bloco "Pergunte ao seu acervo"
do dashboard. Enviar sozinho mandaria ao provedor, com custo, um texto que o usuário digitou para
buscar e não para perguntar. E cair na conversa aberta misturaria a pergunta a um assunto alheio.

**O `Enter` da paleta espera a busca.** Com os resultados ainda a caminho, a lista mostrava só os
comandos, e um `Enter` rápido executava o primeiro comando em vez de abrir a nota procurada.

**O comando do painel respeita `/assistente`, como o atalho.** Pelo INV-56, fechar o painel chama
`parar()`. Em `/assistente`, alternar o painel pela paleta interromperia a resposta na tela. Por
isso o comando faz ali o mesmo que `Ctrl+Shift+Y`: põe o foco no campo de mensagem.

**`PilhaFlutuante`, em `base/Toast.tsx`, empilha o que flutua.** O aviso persistente do erro de
criação e o toast de desfazer eram dois `fixed` na mesma posição e se sobrepunham. Um contêiner
único empilha os dois.

**`BotaoIcone` ganhou `tamanho` porque `className` não sobrescreve.** No Tailwind v4, entre duas
utilidades da mesma propriedade vence a que vem depois no CSS gerado, e não a que vem depois no
atributo `class`. Um `h-8` ou uma cor passados por `className` perdiam para os da base, calados.
Tamanho virou prop (`p`, `m`, `g`), e a cor vai no ícone, não no botão. Foi assim que apareceu o
botão do assistente no card, cuja cor nunca tinha aparecido. Serve para qualquer primitivo de
`base/`: variar por `className` o que a base já define não funciona.

**`useTema` virou um armazenamento único (`useSyncExternalStore`), e o comportamento mudou.** Com
um `useState` por componente, trocar o tema pela paleta deixava o botão do trilho com o valor
velho. O hook antigo tinha outro efeito, que a reescrita expôs: gravava o tema no `localStorage` já
na primeira carga, e com isso a preferência do sistema ficava congelada como se fosse escolha. O
novo só grava na troca manual. É o que o RF-20 e o RF-21 da Fase 4 pedem: o sistema na primeira
visita, e só a escolha manual persistida. O script do `index.html` continua decidindo o valor
inicial antes da primeira pintura, e o hook só lê o que ele aplicou. **Num navegador que já abriu
o Yu-book, nada muda:** a chave `yb:tema` já foi gravada pelo hook antigo e segue valendo como
escolha. Para voltar a seguir o sistema, é preciso apagar a chave. Não há migração, e o CA-14 da
Fase 4 só se observa num navegador limpo.

**A saudação usa a hora do navegador.** É cortesia de tela e não precisa concordar com o servidor,
ao contrário do dia do prazo, que tem fuso decidido em `packages/shared`.

O revisor leu o diff e não achou invariante violada. Suas observações foram corrigidas antes desta
entrada: o comando do painel em `/assistente`, o desfazer inalcançável, o `tamanho` ignorado, o
`Enter` precoce, o arraste da gaveta, o colar, o "vencido" que o leitor de tela não ouvia, a
pergunta caindo na conversa aberta e o comentário do tema.

### O que fica aberto

**Pela quinta etapa seguida, nada foi conferido à mão.** Fica como dívida, para conferir na tela:

- o dashboard: saudação, "Pergunte ao seu acervo", a grade, os prazos com "vencido" lido pelo leitor
  de tela e o esqueleto;
- as notas, nos quatro modos do editor e com a barra de ações;
- o kanban, por mouse e por teclado. O teclado nunca tinha funcionado, e esta é a primeira vez que
  haveria o que ver;
- a gaveta lateral: colar com o foco na caixa, desfazer dentro dela, arraste de favoritos por
  teclado;
- a paleta com comandos, o `>`, a pergunta ao assistente e o `Enter` com a busca lenta;
- os toasts empilhados;
- o login;
- o tema: a troca pela paleta com o trilho acompanhando, e um navegador sem `yb:tema` seguindo o
  sistema.

A janela de concorrência do `useMoverCard` foi vista e não mexida. O motivo está no fechamento
acima.

> **Emenda, no mesmo dia.** O usuário conferiu esta etapa à mão no fechamento do redesenho e
> relatou que tudo funcionou. O alcance desse relato está na entrada do fechamento, no topo.

---

## 2026-09-24 — Redesenho de UI, Etapa 4: o quadro de modelos, em que o favorito é cópia e o arraste move

`/ajustes` deixou de ser uma página única. `pages/AjustesPage.tsx` virou uma casca de rotas para
três seções, e a lógica foi para `components/ajustes/`. A tabela «Seus modelos», com um botão de
rádio por tarefa, deu lugar a um quadro arrastável (`QuadroDeModelos.tsx` e `CartaoModelo.tsx`),
que era o pedido explícito do usuário para esta etapa. O que mudou está na `[0.17.0]` do
changelog; aqui ficam as decisões.

**Três seções, e nenhuma de aparência.** O tema já mora no trilho desde a Etapa 2. Uma seção
"Aparência" em Ajustes criaria um segundo lugar para a mesma escolha.

**O que precisa ser visto em qualquer seção ficou no cabeçalho, e não numa delas.** São o aviso
de que o conteúdo sai da máquina, o gasto do dia, as chamadas sem custo, o aviso de provedor sem
chave (RNF-03 do PRD de IA) e o erro. Na primeira versão, o RNF-03 só aparecia em Provedor. Como
`/ajustes` abre em Modelos, quem não tinha chave montava o quadro sem saber que nada ia funcionar.
Foi um dos achados do revisor.

**No quadro, o favorito é cópia, e o slot de tarefa é o item que se move.** O kanban move o card
de uma coluna para outra, e seguir esse modelo aqui faria o favorito sumir da coluna ao ser
atribuído. Não serve, por duas regras do servidor: um modelo pode servir várias tarefas ao mesmo
tempo, e o modelo de uma tarefa tem que ser um favorito. Se o favorito saísse da coluna ao ser
atribuído, a tela contradiria o dado. Por isso a coluna «Seus favoritos» nunca perde item por
arraste. Arrastar um slot é outra coisa: para outra tarefa, move; para os favoritos, tira da
tarefa.

**Mover um slot faz o PATCH no destino primeiro e só depois grava `null` na origem.** Na ordem
inversa, uma falha no segundo passo deixaria o modelo fora das duas tarefas. Nesta ordem, o pior
caso é o modelo ficar nas duas, que é um estado válido e visível no quadro. O revisor também
apontou um PATCH redundante nesse caminho, e ele foi retirado.

**A recusa do chat é soltar sem efeito, e não um erro depois.** A tarefa de chat exige modelo que
chame ferramenta. O quadro sabe disso antes do soltar e marca a coluna com tracejado, ícone e
texto, não só com cor (RNF-09). Soltar ali não dispara requisição. A alternativa era deixar o
servidor recusar e mostrar o erro, e ela foi descartada porque a regra já é conhecida no cliente.
Mandar a requisição só produziria um erro previsível.

**A alça é o único ativador do arraste**, porque o cartão tem menu e botões. Com o cartão
inteiro arrastável, clicar em "Usar para…" disputaria o gesto com o sensor. O menu e o botão
"Tirar de tarefa" são também a alternativa sem arraste que a acessibilidade exige.

**O teclado tem um `coordinateGetter` próprio** (`coordenadasPorColuna`, em
`QuadroDeModelos.tsx`). O `sortableKeyboardCoordinates` do kanban anda por item dentro de uma lista
ordenável, e aqui não há ordem dentro da coluna: o que existe é escolher a coluna. Por isso as
setas pulam de coluna em coluna. `Espaço` e `Esc` seguem o remapeamento do kanban (INV-30), e a
origem do slot usa `opacity-0` pelo mesmo motivo. O kanban não foi tocado: o quadro copia o
padrão, não o reaproveita. Com movimento reduzido, o `DragOverlay` não anima (`lib/movimento.ts`,
`useMovimentoReduzido`, novo).

**`useDefinirModeloDaTarefa` ficou otimista**, com `onMutate` e rollback em `onError`, porque
arrastar e ver o cartão voltar ao lugar até a rede responder parece defeito. **Não é a primeira
mutação otimista do front**, como dizia o relato da etapa: `useMoverCard` (`lib/kanban.ts`) e a
criação de link (`lib/links.ts`) já seguiam esse padrão. É a primeira da frente de IA. O que ela
tem de novo é a concorrência. Dois arrastes seguidos antes da resposta podem ter as respostas
fora de ordem, e o rollback de um pode restaurar o estado otimista do outro. Daí a `mutationKey`
e o `onSettled`, que só invalida quando `isMutating` diz que é a última (`lib/ia.ts`). Enquanto
houver mutação no ar, o cache fica com a versão otimista, e quem decide no fim é o servidor.

**No catálogo, o favorito virou interruptor, com uma trava.** `Enter` ou clique num favorito o
desfavorita. Só que desfavoritar também limpa, no servidor, toda tarefa que apontava para o
modelo (`apps/api/src/modules/assistente/preferencias.service.ts`, `desfavoritar`). Do catálogo
esse efeito não se vê. Por isso, favorito em uso por uma tarefa não sai por ali: aparece uma
mensagem mandando tirá-lo da tarefa no quadro primeiro. Pedir confirmação num diálogo foi a
alternativa descartada. O usuário confirmaria sem ver qual tarefa perderia o modelo, e o quadro,
onde isso se vê, fica a um passo. Foi o achado do "interruptor perigoso" do revisor.

**O campo do teto ganhou `key`.** Ele é não controlado (`defaultValue`), e na página única também
já era. Se a página montava antes de os ajustes chegarem, o campo nascia vazio e ficava assim. A
`key` com o valor salvo remonta o campo quando o dado chega. O defeito vinha da Etapa A da frente
de IA e foi corrigido aqui porque o código foi reescrito.

O revisor leu o diff e não achou invariante violada. Fez sete observações, e as sete foram
corrigidas antes desta entrada: o RNF-03 atrás de uma aba, o interruptor perigoso, as mutações
concorrentes, o foco perdido depois de tirar, remover ou mover (agora vai para a coluna), a rolagem
sob a barra de filtros fixa (`scroll-margin`), um `h3` que devia ser `h4`, os anúncios de teclado
que não batiam com o gesto e o PATCH redundante.

### O que fica aberto

**Pela quarta etapa seguida, nada foi conferido à mão.** E esta etapa tem o componente mais
dependente de gesto do redesenho: nenhum portão chega a disparar um sensor do `@dnd-kit`. Fica
como dívida, para conferir na tela:

- o arraste por mouse e por teclado, nos três sentidos (atribuir, mover, tirar);
- a recusa do chat a modelo sem ferramentas;
- o menu "Usar para…", com as tarefas impedidas e o motivo;
- o erro de rede com rollback, e dois arrastes seguidos com a rede lenta;
- o movimento reduzido;
- o catálogo, inclusive o favorito em uso que não sai;
- as seções e o medidor.

Somam-se ao checklist das Etapas 1 a 3 deste redesenho e ao que a Etapa B da frente de IA deixou
sem execução.

> **Emenda, no mesmo dia.** O usuário conferiu esta etapa à mão no fechamento do redesenho e
> relatou que tudo funcionou. O alcance desse relato está na entrada do fechamento, no topo.

---

## 2026-09-24 — Redesenho de UI, Etapa 3: uma conversa, duas vistas, e a regra que substitui o INV-53 no chat

O chat modal da Etapa B da frente de IA (`PainelChat.tsx`) foi apagado. No lugar dele, a mesma
conversa aparece em duas vistas: o painel lateral (`components/assistente/PainelAssistente.tsx`, na
coluna `yb:col-chat`) e a rota `/assistente` (`pages/AssistentePage.tsx`). O que mudou está na
`[0.16.0]` do changelog; aqui ficam as decisões.

**O estado e o fluxo da conversa saíram do componente e foram para uma sessão**
(`lib/sessaoChat.tsx`, com `ProvedorSessaoChat` em `App.tsx`). No modal, a conversa morria com o
componente, e era isso que o INV-53 protegia: desmontar abortava o `fetch`. Com duas vistas, a
conversa não pode pertencer a nenhuma delas, porque expandir o painel para `/assistente` desmonta
uma e monta a outra no meio da resposta. Se o fluxo morasse na vista, expandir interromperia a
resposta.

**A sessão tem dois contextos, estado e ações, e não um só.** O estado muda a cada tecla e a cada
delta do streaming. As ações (abrir, anexar, parar) são estáveis. Quem só abre o chat, que são a
casca, o editor e o card, consome só as ações e não re-renderiza durante o streaming. Com um
contexto único, o editor inteiro repintaria a cada pedaço de resposta. Foi um dos achados do
revisor.

**A regra do fluxo, que para o chat substitui o INV-53:**

- fechar o painel chama `parar()`. Fechar continua significando "não quero mais essa resposta",
  como no modal;
- o logout desmonta o provedor, e a limpeza dele aborta;
- sair de `/assistente` com resposta em curso abre o painel, para que a resposta continue
  à vista;
- expandir para `/assistente` não toca no fluxo.

O INV-53 continua valendo para os outros painéis montados por `&&`. A regra do chat virou
invariante própria, o INV-56 da skill `invariantes-yu-book`, porque o mecanismo mudou: não é
mais o desmonte que aborta.

**O `AbortController` nasce antes de a conversa ser criada.** No HEAD, o controle só nascia
depois do `POST` que cria a conversa (`PainelChat.tsx:298` e `:313`). Fechar o chat nesse
intervalo não tinha o que abortar, e a resposta seguia no servidor. Um segundo `Enter` no mesmo intervalo também criava uma segunda
conversa, porque nada marcava o envio em curso. O defeito já vinha da Etapa B. O revisor o
encontrou nesta etapa e ele foi corrigido aqui, e não numa entrega separada, porque o código que o
continha foi reescrito.

**A sugestão de contexto oferece e nunca anexa sozinha.** Com uma nota ou um card aberto, o
compositor sugere anexá-los. Anexar sem que se peça mandaria ao provedor, a cada mensagem, texto
que o usuário não escolheu enviar, e a política de dados da frente de IA é uma escolha dele.

**O painel contextual não recolhe sozinho quando card e chat estão abertos juntos.** Com o painel
contextual, o card e o chat abertos, a área útil fica estreita. A alternativa, recolher o painel
contextual automaticamente, mudaria um estado que o usuário escolheu e persiste em
`localStorage`, e ele voltaria recolhido depois de fechar o chat sem que ninguém tivesse pedido.
`Ctrl+\` resolve em um gesto. A decisão está registrada no plano da etapa.

**O `Esc` global não fecha mais o chat, e o do painel só vale com o foco dentro dele.** Com o
painel ao lado do editor, um `Esc` dado no editor ou num menu fecharia o chat e, pela regra
acima, interromperia a resposta.

**`Etiqueta` entrou em `components/base/`** para o modelo e as fontes de cada resposta. `Menu`
ganhou o lado `"baixo-fim"`, porque o menu de cada conversa, aberto perto da borda direita, saía
cortado. `PainelRedimensionavel` ganhou mínimo e máximo, de 320 a 640 px no chat.

O revisor leu o diff: nenhuma invariante violada, sete observações, as sete corrigidas antes desta
entrada. Foram a janela de criação, o desempenho do contexto, a fala na conversa errada, o menu
cortado, o foco ao fechar, a menção que sobrevivia ao envio e o foco na renomeação.

### O que fica aberto

**Pela terceira etapa seguida, nada foi conferido à mão, e desta vez o que não foi visto inclui
cancelamento de rede.** Os portões dizem que compila. Fica como dívida, para conferir na tela:

- o painel empurrando o conteúdo;
- expandir para `/assistente` e sair dela sem interromper a resposta;
- fechar o painel cancelando o `fetch`, conferido na aba de rede;
- o botão Parar;
- a sugestão de contexto;
- o `Esc` no editor e no painel;
- renomear conversa pelo teclado;
- o aviso sem modelo de chat.

Somam-se ao que a Etapa B da frente de IA já deixou sem execução (o anexo pelo `@`, os chips de
origem, o corte pelo teto) e ao checklist das Etapas 1 e 2 deste redesenho.

> **Emenda, no mesmo dia.** O usuário conferiu esta etapa à mão no fechamento do redesenho e
> relatou que tudo funcionou. O alcance desse relato está na entrada do fechamento, no topo.

---

## 2026-09-24 — Redesenho de UI, Etapa 2: a casca, os filtros na URL e o workspace que fica fora dela

A barra lateral única (`Navegacao.tsx`) foi apagada e deu lugar a um trilho de áreas de 56 px
(`components/casca/Trilho.tsx`) e a um painel contextual (`casca/PainelContexto.tsx` e
`casca/contexto/*`) que ocupa a mesma coluna redimensionável, `yb:col-nav`. O que mudou está na
`[0.15.0]` do changelog; aqui ficam as decisões.

**Os filtros da lista de notas saíram do `useState` da casca e foram para a URL**
(`lib/filtrosUrl.ts`, `/n?tipo&tags&favoritas&lixeira&q&ordem`). No estado, o Voltar do navegador
não desfazia um filtro e recarregar o perdia; na URL, os dois vêm de graça e o recorte vira link.
Valor fora do enum some calado, para que link velho não quebre a tela. Dois modos de escrita, por
intenção: **trocar filtro empilha** no histórico, porque é um passo que o usuário quer poder
desfazer; **a busca troca no lugar**, com debounce de 200 ms, porque cada tecla empilhada faria do
Voltar uma borracha letra a letra. O debounce ignora o eco da própria transição do react-router — sem
isso, a URL recém-escrita voltava ao campo e atropelava o que tinha sido digitado nesse meio-tempo.
Abrir, fechar e criar nota levam a query string junto; a primeira versão perdia os filtros ao criar
nota, e foi o revisor quem pegou.

**O workspace fica fora da URL, de propósito** (RF-02 da Fase 2). Ele não é filtro da lista de notas,
é o contexto da aplicação inteira — escolhido no seletor global, vale para boards, dashboard e
paleta, e persiste em `yb:workspace`. Pô-lo em `/n?ws=…` criaria duas fontes de verdade que
discordariam na primeira vez em que alguém abrisse um link antigo com outro workspace ativo.

**Mudança deliberada de comportamento: `Ctrl+N` fora de `/n` não herda mais o tipo filtrado.** Com o
filtro na URL, "o filtro atual" fora da lista passaria a ser o da última lista lembrada, e um filtro
esquecido lá atrás decidiria o tipo de uma nota criada do board. Dentro de `/n` a herança continua;
fora, a nota nasce livre.

**A última lista de notas é lembrada em memória, não em `localStorage`.** O item Notas do trilho volta
para `/n` com a query da última visita, porque sair para os boards e voltar não pode perder o recorte
— era o que o `useState` antigo garantia de graça. O estado mora em `Aplicacao.tsx` e morre com a
aba; a alternativa, persistir, faria um filtro de semana passada reaparecer numa sessão nova sem
aviso. O recorte que sobrevive a recarga é o da URL, e só ele.

**O selo do workspace, que aparece no trilho com o painel recolhido, leva a cor do workspace na
borda, não no fundo.** A cor é escolhida pelo usuário, e texto sobre ela não tem contraste
garantido; a inicial fica em `ink-200` sobre `ink-800`, que tem. É a mesma razão pela qual a Etapa 1
calculou o contraste das cores novas em vez de escolhê-las a olho — aqui não há o que calcular,
então a cor sai do caminho do texto. O selo existe porque, recolhido o painel, o seletor de workspace
sumia junto e nada na tela dizia em que workspace se estava; foi um dos achados do revisor.

**O ponto sobre Notas no trilho é a regra da seção recolhida estendida ao painel inteiro.** A barra
antiga já dizia, no cartão de tags fechado, quantas tags estavam valendo: recolher esconde os itens,
mas um filtro ativo não pode sumir da vista sem deixar de valer. Recolher o painel contextual é o
mesmo gesto em escala maior, então o trilho mostra um ponto sobre Notas quando a última lista tem
filtro e o painel está fechado, e o rótulo acessível passa a "Notas, com filtro ativo" — o ponto é
`aria-hidden`, o texto é que carrega a informação.

**`Menu` entrou em `components/base/` porque nasceu com dois consumidores**, o "+" de criar e o menu
do avatar, dentro desta mesma etapa — a regra da Etapa 1 de só fazer primitivo com consumidor. Setas,
Home/End, `Tab` fecha, e o `Esc` para a propagação e devolve o foco ao gatilho: sem o
`stopPropagation`, o mesmo `Esc` chegava ao atalho global e fechava também a paleta ou a gaveta
abertas atrás — o seletor de workspace já fazia assim.

Os atalhos globais saíram de `Aplicacao.tsx` para `lib/atalhosGlobais.ts`, sem mudança de
comportamento; `Ctrl+\` é o único novo. O revisor leu o diff: nenhuma invariante violada, oito
achados, os oito corrigidos antes desta entrada.

### O que fica aberto

**Busca digitada nos 200 ms antes de clicar numa nota se perde.** A `NotasPage` remonta entre `/n`
e `/n/:id`, e o debounce pendente morre com ela antes de escrever na URL. Resolver pede ou que a
página não remonte na transição, ou que o debounce descarregue ao desmontar; nenhum dos dois foi
feito.

**A contagem de entregas sem conferência à mão sobe para duas, e de novo nada foi visto.** Os
portões — `shared build`, `typecheck`, `vite build` — dizem que compila. Fica como dívida, para ser
conferido na tela: o trilho e o painel nos dois temas; os dois menus operados só por teclado (setas,
Home/End, `Esc` devolvendo foco, `Tab` fechando); os filtros com Voltar, com recarga e com link
colado; recolher e mostrar o painel pelo botão e por `Ctrl+\`, e para onde vai o foco; o ponto de
filtro e o selo do workspace com o painel recolhido; o badge de links; a lista de atalhos; e a troca
de workspace com filtros na URL. A Etapa 3 vai pôr o assistente dentro desta casca sem que ela, ou a
fundação da Etapa 1, tenha sido olhada.

> **Emenda, no mesmo dia.** O usuário conferiu esta etapa à mão no fechamento do redesenho e
> relatou que tudo funcionou. O alcance desse relato está na entrada do fechamento, no topo.

---

## 2026-09-24 — Redesenho de UI, Etapa 1: a fundação visual, e o primitivo que o projeto recusava

O operador aprovou hoje um redesenho de UI/UX de `apps/web` em cinco etapas — 1 fundação visual,
2 casca e navegação (trilho de ícones com painel contextual, filtros de notas na URL), 3 assistente
em painel lateral e na rota `/assistente`, 4 `/ajustes` com quadro de arraste de modelos por tarefa,
5 polimento das telas —, cada uma com plano próprio, e **pôs o redesenho antes da Etapa C da frente
de IA**. As etapas 3 e 4 mexem exatamente nas telas que a frente de IA criou, e redesenhar depois
seria refazer o que a Etapa C tivesse acabado de construir.

**É uma quinta numeração, e não se converte nas outras quatro.** Etapa 1 do redesenho não é Etapa A
da frente de IA, nem etapa do MCP, nem fase de produto, nem fase do roteiro de IA. Também não é
continuação do "Redesenho da navegação" de 2026-08-20, que mexeu em quatro arquivos e em nenhum
token. Vale a mesma regra da entrada de 2026-08-26: não unificar, não renumerar.

**Revogada a prática de não ter `Button` nem `Modal` genéricos.** Até aqui cada tela escrevia o
próprio botão e o próprio diálogo, e a regra se sustentava enquanto a repetição era de classes. Ela
deixou de se sustentar quando a repetição passou a ser de **comportamento**: `Bloco`/`Vazio`
duplicados em Dashboard e Ajustes, `IndicadorSalvamento` em PainelEditor e PainelCard, o `TRACO`
dos ícones copiado em três arquivos, e — o que decidiu — um diálogo que precisa prender foco,
devolvê-lo e fechar no `Esc`, coisa que escrita à mão em cada tela sai diferente em cada uma. Os
primitivos moram em `apps/web/src/components/base/` (`Botao`/`BotaoIcone`, `Bloco`/`Vazio`/
`Esqueleto`, `Aviso`, `IndicadorSalvamento`, `Dialogo`, `Tecla`) e em `lib/foco.ts`. **O que
continua valendo, e não foi tocado:** nada de biblioteca de UI. Os primitivos são nossos, pequenos,
e sem Radix atrás.

**Primitivo só onde tem consumidor.** Nenhum dos seis nasceu sem uma tela que o usasse nesta mesma
etapa: `Dialogo` e `Tecla` em Atalhos, `BotaoIcone` no seletor de tema, `Esqueleto` no dashboard,
`Aviso` em Ajustes, `Bloco`/`Vazio` e `IndicadorSalvamento` onde já estavam duplicados. A
alternativa era desenhar a biblioteca inteira agora, antes das telas — recusada pelo mesmo motivo
de 2026-09-22: abstração sem segundo caso é abstração desenhada para o caso errado. As telas que
ainda têm botão à mão migram quando forem redesenhadas, não numa varredura.

**A sombra passa por `--sombra-*`, não por `--shadow-*` direto.** O caminho óbvio era declarar
`--shadow-e1` no `@theme` e sobrescrevê-lo em `:root[data-tema="claro"]`, como se faz com cor. Não
funciona: o Tailwind v4 **copia o valor** da sombra para dentro da utilidade no build, e a
sobrescrita no tema claro não chega a `.shadow-e1`. O `@theme` só aponta — `--shadow-e1:
var(--sombra-e1)` — e o valor mora em `:root`, onde troca com o tema como qualquer variável. O
`vite build` conferiu que a utilidade gerada resolve `var(--sombra-e1)`. É um espelhamento a mais
para quem acrescentar sombra: token no `@theme` **e** as duas definições de `--sombra-*`.

**Duas cores novas com contraste calculado, não escolhido a olho.** `superficie` é o degrau que a
rampa `ink` não tinha — o cartão acima do painel —; `ia-500` existe só para fechar o gradiente das
áreas de IA. Texto branco sobre `ia-500` e sobre `accent-500` fica entre 4,80:1 e 6,31:1 nos dois
temas, acima do AA. Cada uma entrou no `@theme` e em `:root[data-tema="claro"]`, como manda o
design system.

**O `:focus-visible` perdeu o `border-radius: 2px`.** Fora de camada, ele vencia os `rounded-*` dos
elementos, e um botão arredondado virava quadrado ao receber foco. Sem o raio próprio, o contorno
segue o do elemento.

**Os 10 px sobem para 11 px, e isso é decisão, não efeito colateral.** A varredura trocou noventa
`text-[10px]`/`text-[11px]` por `text-miudo` (11/16) ou pela utilidade `rotulo`. Manter 10 px
exigiria um segundo degrau abaixo de `text-xs`, e 10 px em Inter é ilegível. Toda tela ficou um
pouco mais alta onde tinha rótulo miúdo.

**Inter pelo Google Fonts, e o preço é o IP do operador.** Até esta etapa a SPA só falava com a
própria API; agora cada carga sem cache pede a folha de estilo a `fonts.googleapis.com` e a fonte a
`fonts.gstatic.com`, e o Google fica sabendo de onde e quando o Yu-book foi aberto. A alternativa
era **servir a Inter do próprio bundle** — sem terceiro, sem dependência de rede — e custa um
arquivo de fonte versionado no repositório e o recorte de pesos feito à mão. Para um app
single-user cujo operador é o próprio usuário, o custo foi julgado maior que a exposição; está
registrado para que a troca seja uma decisão consciente, se um dia deixar de ser. O `<link>` fica
**depois** do script de tema no `index.html`: a fonte pode chegar atrasada (`swap`), o tema não, e
sem rede a interface cai na pilha de sistema de `--font-sans`.

**A devolução de foco mora na limpeza do efeito**, em `useFocoPreso`, e não num ramo `if (!ativo)`.
É a mesma armadilha da montagem condicional de painéis: quem monta `{aberto && <Dialogo aberto />}`
desmonta o diálogo com a prop ainda `true`, e um ramo que esperasse `false` nunca rodaria.

O `revisor` leu o diff: nenhuma invariante violada, seis achados, os seis corrigidos antes desta
entrada.

### O que fica aberto

**A contagem de entregas sem conferência à mão, que parou em seis na `[0.13.0]`, recomeça em uma —
e desta vez nenhuma parte foi vista.** Não havia
como entrar no app sem as credenciais do operador. Os portões que passaram — `shared build`,
`typecheck` e um `vite build` — dizem que o CSS é gerado e que o código compila; nenhum deles abre
uma tela. **Sem execução nenhuma:** a Inter carregando e o recuo para a fonte de sistema sem rede;
o modo ao vivo do CodeMirror com a métrica de fonte nova, que é o ponto mais provável de regressão
silenciosa, porque o editor mede a posição do cursor pela fonte e a entrega que o criou também não
chegou a instanciar uma `EditorView`; os dois temas com as sombras e as cores novas; a trava de foco
do diálogo de atalhos; e o movimento reduzido. `apps/web` segue sem runner de teste, e a Etapa 2
vai construir por cima desta fundação sem que ela tenha sido olhada.

> **Emenda, no mesmo dia.** O usuário conferiu esta etapa à mão no fechamento do redesenho e
> relatou que tudo funcionou. O alcance desse relato está na entrada do fechamento, no topo.

---

## 2026-09-23 — O chat usado pela primeira vez: a tela sem a tarefa, a busca que desistia, e a conferência que cobrou

Esta entrada não abre versão nova. A Etapa B ainda não foi publicada, então tudo aqui cabe dentro da
`[0.13.0]` e nenhum `package.json` se move — a regra é a da §3.1 da skill: o heading nomeia a versão
do conjunto, e o conjunto ainda não saiu. O que ela registra é o que aconteceu **entre** fechar os
documentos e o push: o operador usou o chat, e usar encontrou dois defeitos.

**O primeiro defeito é uma omissão de entrega, não um erro de código.** `AjustesPage.tsx` tinha
`const TAREFA: AiTask = "formatar"` **fixo**. A Etapa B acrescentou a tarefa `chat` ao enum, ao banco
e ao `PATCH /ai/tasks/:task`, e a tela nunca acompanhou: o chat passou a exigir uma escolha que não
tinha por onde ser feita. O conserto podia ser uma linha — marcar a segunda tarefa à mão — e foi
outro: uma **coluna de rádio por tarefa, derivada de `AI_TASKS`**. A alternativa barata se descarta
sozinha ao ser escrita, porque ela é literalmente o defeito de novo, só que com dois nomes em vez de
um; derivando da lista, a próxima tarefa aparece na tela no mesmo commit em que entra no enum.

**Vale registrar a forma do engano, porque ela se repete: é a terceira vez nesta frente que o
sintoma acusa o lugar errado.** Aqui a tela parecia mentir — havia um modelo marcado e mesmo assim o
erro dizia que não havia escolha —, e o que faltava era uma tarefa sem controle. Antes foram o 404 da
variante de lote, que parecia recusa do provedor e era o que nós oferecíamos no catálogo, e o 404 da
política de dados, que parecia indisponibilidade do modelo gratuito e era o bloco `provider` que nós
mandávamos. Nos três, o que o sistema **dizia** estava correto e apontava para fora; a causa estava
no que nós emitíamos. A lição operacional é barata: diante de erro que parece falso, conferir
primeiro o que **nós** enviamos, antes de acreditar no lugar que a mensagem indica.

**Duas decisões pequenas no conserto.** A primeira: o rádio de `chat` fica **desabilitado** em modelo
sem `supportsTools`, com o motivo no `title`, em vez de deixar marcar e recusar depois com 422. A
recusa tardia chega quando a pergunta já foi digitada, e o custo de descobrir ali é maior do que o de
um controle apagado com explicação. A segunda: as duas mensagens de `MODELO_NAO_ESCOLHIDO` passaram
a **nomear a tarefa** e a dizer em qual coluna marcar. Uma mensagem que diz "esta tarefa" para quem
está olhando para outra tarefa marcada é pior do que uma mensagem vaga: ela produz a conclusão
errada com confiança.

**O segundo defeito só a prova ao vivo encontrava.** Com o modelo configurado, o operador perguntou
por uma receita que **está** no acervo e recebeu "não encontrei". A busca estava certa — `q=bolo`
devolve "Bolo de fubá" —; o modelo buscou `"receita de bolo"`, recebeu vazio e **desistiu numa volta
só**. O resultado vazio relatava o que tinha entendido e não oferecia saída nenhuma, e "nenhum
resultado" lido por um modelo vira "não existe".

Três consertos possíveis, e o escolhido é o terceiro. (1) Afrouxar a busca — `OR` entre os termos ou
similaridade — muda a semântica para **todos** os consumidores e troca um falso negativo por vários
falsos positivos. (2) Instruir no prompt de sistema do chat: resolve numa superfície e deixa o
servidor MCP com o mesmo beco, porque o prompt do chat não alcança cliente nenhum de MCP. (3) Mudar
o **texto do resultado vazio** em `formatarBusca`, que é onde as duas superfícies se encontram: ele
passou a dizer que a busca é por palavra sobre título e corpo — não por assunto — e a sugerir o
substantivo sozinho antes de concluir que não existe. Medido depois: a mesma pergunta passou a buscar
duas vezes, ler a nota e citar a origem.

**O preço do terceiro caminho está declarado e é o mesmo já catalogado nesta frente:** esse texto é
contrato de conversa com o modelo em **duas** superfícies, e nenhum portão fica vermelho quando ele
muda. É irmão da dívida das nove `descricao`. O que **não** mudou: `tools/list` continua byte a byte
o mesmo, porque nenhuma descrição foi tocada — só a saída de uma tool.

**Um teste novo, e ele é da API por falta de onde mais.** `apps/api/tests/chat.test.ts` passou a
provar que as duas escolhas de modelo convivem e são independentes em `GET /ai/settings`: definir
`formatar` não derruba `chat`. É o contrato que a coluna de rádio desenha, e é o mais perto que se
chega de testar o defeito encontrado — `apps/web` continua sem runner, então o que sobra é blindar o
lado de cá. 131 testes na API, eram 130.

**A conferência à mão aconteceu, e é por isso que esta entrada existe.** A contagem de "entregas
seguidas sem conferência de interface" parou em seis. Não porque a dívida foi paga — `apps/web`
continua sem um único teste —, mas porque desta vez o operador abriu a tela, e a tela devolveu em
minutos um defeito que `typecheck`, 130 testes e o build não viam. É o argumento da dívida sendo
apresentado com um exemplo: o portão que faltava era o único que mordeu.

### O que fica aberto

**A conferência foi parcial, e a parte não conferida é a maior.** Verificado ao vivo: o painel abre,
a escolha de modelo por tarefa funciona, o laço busca sozinho, lê a nota e cita a origem, e o gasto
do dia aparece. **Continua sem execução nenhuma**: o anexo pelo `@` a partir da tela, o chip de
origem abrindo o alvo, o teto cortando no meio de uma resposta, renomear e excluir conversa, e o
atalho `Ctrl+Shift+Y`. Conferência à mão não é regressão: vale para a árvore de hoje e não vigia
nada amanhã.

**Pendência de pós-deploy.** Que o MCP **hospedado** passou a relatar o dia certo do prazo só é
conferível depois do push — o defeito só aparecia no serviço da Railway, que roda em UTC, e a suíte
em `Asia/Tokyo` prova o código, não o ambiente. Primeira coisa a conferir contra o serviço quando a
Etapa B subir.

**O texto do resultado vazio de `formatarBusca` não tem portão.** Quem o encurtar por parecer verboso
devolve o beco sem saída às duas superfícies, e nada fica vermelho.

---

## 2026-09-23 — Etapa B: uma definição para duas portas, e três coisas que só a medição sabia

Terceira sessão do dia, e a maior. O chat ancorado deixou de ser documento. O que vale registrar não
é que ele existe — está no changelog —, são as decisões que custaram alguma coisa.

**Uma definição, dois consumidores.** O metadado das nove ações do acervo — nome, título, descrição
e schema — saiu de `apps/mcp/src/tools/` e virou `packages/shared/src/ferramentas.ts`. O chat interno
e o servidor MCP oferecem as mesmas nove, da mesma fonte. A alternativa era escrever um segundo
catálogo para o chat, o que teria sido o diff menor e o único sem risco de mexer no MCP; recusada
porque dois catálogos à mão divergem em silêncio, e a divergência apareceria como **a mesma ação com
duas caras conforme a porta de entrada** — um modelo que sabe usar `move_card` pelo MCP errando os
campos pelo chat. Os **handlers ficam separados de propósito**: o MCP fala HTTP com a API, o chat
chama os services direto. O que é comum é o vocabulário, não o caminho.

**O preço está declarado, e não é pequeno:** a `descricao` de uma tool é contrato de conversa com o
modelo, e agora ela é contrato de dois. Editar uma frase lá muda o comportamento do servidor MCP para
todo cliente, e **nenhum portão fica vermelho**. Para provar que a migração não mudou nada, o agente
`mcp` comparou as duas revisões por JSON-RPC: `tools/list` devolve **8551 B com escrita e 3480 B
sem**, byte a byte igual. É prova de hoje, não vigilância — nada guarda esse número amanhã.

**Três decisões do operador, tomadas em modo plano.** (1) Pagar a dívida do `diaDoPrazo` inteira
nesta entrega, MCP incluído, em vez de deixá-la para depois como vinha desde que foi catalogada.
(2) O anexo pende da **mensagem**, não da conversa — o que contraria a seção 7 do PRD, que foi
emendada. Preso à conversa, o histórico mente: uma pergunta feita antes de você anexar a nota
apareceria depois como se já a tivesse tido. (3) Teto cortando no meio do laço **interrompe e entrega
o parcial**, em vez de descartar. A alternativa seria mais limpa de explicar — ou responde inteiro ou
não responde —, mas jogaria fora dinheiro já gasto e deixaria o usuário sem nada depois de esperar.

**Medir em vez de lembrar, três achados que teriam virado defeito em produção.** (a) O `usage` do
provedor **não** vem no chunk que traz o `finish_reason`, vem no **seguinte**. Parar de ler no
primeiro — que é o que a leitura ingênua do protocolo manda fazer — faria **todo passo do laço**
gravar custo `desconhecido`, e o teto diário viraria decorativo (INV-48). (b) Os `tool_calls` chegam
**fatiados por `index`**, não inteiros num chunk. (c) Erro em modo streaming volta como **JSON com
status HTTP normal**, e não como evento SSE — quem esperasse um evento de erro nunca o veria.

**O plano estava errado sobre a compressão, e a prova negativa revelou algo melhor.** Ele mandava
`config: { compress: false }` na rota do fluxo. Essa forma é **ignorada em silêncio**: o
`@fastify/compress` lê `routeOptions.compress` no `onRoute`, não `config.compress`. Ao tentar provar
negativamente que a linha fazia alguma coisa, descobri que ela **não é a primeira camada**: o
`@fastify/compress@9.2.0` já exclui `text/event-stream` na própria regex de tipos compressíveis, e
sem a linha a resposta sai sem `content-encoding` e o fluxo chega fatiado do mesmo jeito — conferido
nos dois estados. A linha ficou, na forma certa, como **segunda camada**, porque a exclusão é do
*padrão* do plugin: um `customTypes` no registro global a substitui inteira, e aí o streaming pararia
de fluir sem nenhum teste ficar vermelho. É o mesmo raciocínio das duas travas de escrita do MCP. O
comentário foi reescrito para dizer o que foi **medido**, não o que o plano supunha.

**A dívida do `diaDoPrazo` foi paga, e o que importa é como ela foi provada.** O defeito: os
formatadores usavam o fuso do **processo**, o que acertava por acaso na máquina do operador e errava
**sempre** no serviço hospedado, que roda em UTC — o front grava o prazo às 23:59:59 locais, e em
UTC−3 isso é 02:59 do dia seguinte, então o MCP da Railway relatava todo prazo um dia à frente,
calado, havia semanas. `apps/mcp/tests/fuso.test.ts` usa **`Asia/Tokyo`**, e essa escolha é o teste:
uma suíte escrita em `America/Sao_Paulo` passaria na máquina do operador com o código velho **e** com
o novo, provando nada. Rodei com `TZ=UTC` e com o fuso da máquina, `America/Sao_Paulo` — que é
justamente aquele em que o código velho passava por acaso: 49 passam nos dois.
Consequência direta — `apps/mcp/railway.json` **não** precisa de `TZ` e não deve ganhar uma; fixar o
fuso do processo seria voltar a esconder o defeito em vez de removê-lo.

**Assimetria decidida no recuo do fuso.** Falhar ao ler `ai_preference.timezone` recua para
`FUSO_PADRAO` na **leitura** e **falha alto** na **escrita** (`create_card` com prazo). A diferença é
entre rótulo e dado: numa leitura, o recuo produz no máximo uma linha de texto com o dia de outro
fuso, e derrubar a leitura do quadro inteiro por causa disso seria pior; numa escrita, o fuso vira o
**instante gravado no banco**, e recuar ali gravaria um prazo errado em silêncio. O recuo nunca é o
fuso do processo — cair no processo é exatamente o defeito que o módulo existe para remover. Também
se decidiu **não** cachear o fuso: um mapa por credencial economizaria as cinco consultas de
`GET /ai/settings` e traria de volta o modo de falha já catalogado neste servidor, o mapa indexado
por sessão que ninguém esvazia. Uma requisição a mais é custo previsível; um vazamento não é.

**Oito provas negativas, e duas delas ensinaram mais falhando.** Toda invariante nova ganhou um
defeito injetado para conferir que o teste morde. Duas passaram na primeira tentativa, o que é sinal
de prova ruim, não de código bom: uma mexia na estimativa de custo dentro de um modelo **gratuito**,
onde a estimativa é zero e portanto qualquer erro é invisível; a outra caiu no filtro em vez do mapa.
As duas viraram teste melhor depois de corrigido o defeito injetado.

**O revisor achou seis defeitos reais e todos foram corrigidos.** Vale listar porque quatro deles são
de uma classe que este projeto já produziu antes. O `abort` do painel **nunca disparava** — o
componente desmonta, então a limpeza tinha de ser função de retorno. O par `assistant`/`tool`
quebrado por desconexão **envenenava a conversa para sempre**: o provedor recusa um histórico em que
uma chamada de ferramenta não tem resposta, e a conversa ficava morta sem jeito de recuperar —
consertado **na leitura**, e não na escrita, porque conversa já quebrada em banco também precisa
voltar a funcionar. A pergunta era gravada **antes** da conferência do teto. Fontes repetiam ao vivo.
`onAbrirCard` estava morto. Chaves de cache em string literal. Mais o catálogo das nove ações
entrando no bundle da primeira pintura — 6,3 KB para quem só abriu o dashboard —, resolvido com
`sideEffects: false` em `packages/shared` e **medido depois**: `search_notes` agora só aparece no
pedaço `PainelChat`.

**O RF-21, a RN-04 e o CA-09 foram revogados**, e é a segunda revogação de requisito desta frente em
dois dias. Eles mandavam o chat **avisar que só responde sobre o anexado** em vez de tentar responder
sobre o acervo. O laço de ferramenta é exatamente o oposto — e é melhor no que aqueles requisitos
protegiam: a preocupação era resposta inventada sobre um acervo que o modelo não viu, e agora só
existe afirmação sobre o que uma ferramenta de leitura devolveu. A RN-05 sobrevive inteira e passa a
ser sustentada por construção. O anexo pelo `@` não sumiu; deixou de ser a **única** porta.

### O que fica aberto

**~~A sétima entrega seguida sem conferência de interface à mão.~~ Não foi — ver a emenda logo
abaixo.** O painel inteiro, o anexo pelo `@`,
a lista de fontes e o atalho estão implementados e **nada disso foi executado** — `apps/web` não tem
runner de teste. Já não é caso isolado nem dívida recente: é o modo de trabalho vigente, e a
contagem existe para que a decisão de mudá-lo seja tomada de propósito, e não por acidente no dia em
que algo quebrar na cara do operador.

> **Emenda, no mesmo dia.** A contagem parou em seis: horas depois disto o operador conferiu o chat à
> mão, e a conferência encontrou em minutos um defeito que nenhum portão pegava — `/ajustes` sem a
> coluna da tarefa `chat`. A dívida não foi paga; foi cobrada. A conferência foi **parcial**, e o que
> segue sem execução está listado na entrada do topo.

**O espelhamento do dia do prazo mudou de lado e não fechou.** `packages/shared` decide o dia pelo
`ai_preference.timezone`; `apps/web/src/components/PainelCard.tsx` continua lendo e gravando pelo
fuso do **navegador** — `getDate()` na leitura e um literal de data com `T23:59:59` na gravação,
os dois sem fuso explícito. Era "MCP × front", virou "shared × front": metade resolvida, e a metade
que sobrou é a que ninguém vai lembrar, porque o sintoma visível sumiu.

**Nenhum portão vigia o texto das nove descrições nem o tamanho do `tools/list`.** Os 8551 B são
prova de hoje. Quem editar uma descrição para o chat muda o contrato do MCP e não vai receber aviso
nenhum.

**A corrida no teto continua declarada e não resolvida**, e agora vale **por passo do laço**: dez
pedidos cabem no limite da rota e podem ler o gasto antes de qualquer linha de uso existir.

**O portão da API falha por porta ocupada, e a falha se parece com defeito de código.**
`tests/assistente.test.ts` e `tests/chat.test.ts` sobem o dublê de provedor na **mesma porta fixa**,
39333 — ela não pode ser sorteada, porque é escolhida em `tests/setup.ts` antes de o `env` da
aplicação existir. `fileParallelism: false` faz as duas não se cruzarem numa rodada normal, mas
**uma rodada interrompida deixa o processo escutando**, e a rodada seguinte morre nos dois
`beforeAll` com `EADDRINUSE` e 72 testes pulados. Aconteceu duas vezes ao conferir esta entrega, e
o sintoma não aponta para a causa: parece o chat quebrado. Matando o processo órfão, 130 passam.
Quem for mexer nisso: o conserto não é sortear a porta, é o `setup.ts` deixar de precisar conhecê-la
antes da hora.

**O chat não funciona até o operador escolher um modelo de chat em `/ajustes`.** Enquanto não
escolher, o painel recusa com `MODELO_NAO_ESCOLHIDO`; escolhendo um que não saiba chamar ferramenta,
recusa com `MODELO_SEM_FERRAMENTA`.

---

## 2026-09-23 — A política de dados era nossa e estava fixa no código; e a migration que teria derrubado o boot

Segunda sessão do dia. A de manhã tirou do catálogo os modelos que a chamada recusa; esta descobriu
que **um dos motivos de recusa era nosso**.

**O sintoma parecia ser mais um modelo quebrado.** O operador favoritou gratuitos (NVIDIA, Google) e
eles falharam. Medi com a chave dele, no mesmo modelo, variando **uma** coisa: com
`provider: { data_collection: "deny" }` vem **404**, "No endpoints found matching your data policy
(Free model training)"; sem o bloco, **200** e custo zero. A conta dele já permitia endpoints que
treinam — está ligado no painel do provedor. A trava era o nosso pedido: endpoints gratuitos treinam
com os dados, então exigir que não treinem é **exigir um endpoint que não existe**. Vale anotar o
formato do engano, porque ele se repete: pela segunda vez em dois dias o 404 veio do que **nós**
mandamos, não de o provedor estar fora do ar.

**A decisão é que a política é escolha do usuário, não propriedade do produto.** Ela estava fixa numa
linha de `formatar.service.ts`, e a tela de ajustes a anunciava — "o servidor pede ao provedor que
não guarde o texto para treino" — como se fosse garantia oferecida. Era escolha nossa, escondida, e
contrária ao que o operador disse no começo desta frente: que não se importa que o conteúdo dele seja
usado para treino. O que se oferecia como cuidado estava, na prática, tirando dele metade do catálogo
sem avisar.

**Descartei simplesmente remover o `deny`**, que seria a leitura literal do que ele pediu e o diff
menor. Recusada porque apaga uma proteção real para quem não pediu nada: o padrão passaria a ser
"treina" por omissão, e a tela ficaria sem verdade nenhuma a dizer. O interruptor nasce **desligado**,
e o custo disso está escrito na tela: quem deixar como está não alcança os gratuitos. **A consequência
aparece nos dois estados de propósito** — dizer só "protegemos você" foi exatamente o defeito.

**Com o treino permitido não mandamos bloco nenhum**, em vez de mandar um valor permissivo explícito.
Foi o que a medição cobriu: o 200 veio da **ausência** do bloco. Mandar `data_collection: "allow"`
seria afirmar um comportamento do roteamento que eu não medi, e o bloco `provider` é justamente o que
restringe o roteamento — deixá-lo fora é o que abre os gratuitos.

**O Gemma é outro caso e fica em aberto.** Ele devolve **429 com e sem** a política: é saturação do
endpoint gratuito, não recusa por dados. Nada nesta entrega o alcança, e vai continuar falhando para
quem tentar.

**A migration teria derrubado o boot em produção, e só não derrubou o local por acaso.** A coluna é
obrigatória e **sem `@default`** — o padrão mora em `packages/shared`, e duas fontes para o mesmo
padrão divergem em silêncio. O Prisma gerou `ADD COLUMN … NOT NULL` sem default e avisou no próprio
arquivo: *"This is not possible if the table is not empty"*. Aqui passou porque a minha `ai_preference`
está vazia; **em produção não havia como saber**, e `prisma migrate deploy` roda no **boot** — a
falha não apareceria em pipeline nenhum, apareceria como serviço que não sobe, depois do push.

Refiz em dois passos — `ADD COLUMN … NOT NULL DEFAULT false` e `ALTER COLUMN … DROP DEFAULT` — e
**provei em vez de presumir**: criei uma linha, derrubei a coluna, rodei o SQL da migration com a
tabela cheia, e a linha existente ficou com `false`. O estado final do banco continua igual ao
`schema.prisma`. O motivo está em comentário **dentro do SQL**, que é onde a próxima pessoa vai olhar
quando quiser "simplificar" isto para um comando só.

**O dublê de provedor só sabia dizer que uma chamada saiu, não o que ela pediu**, e é por isso que
a política fixa atravessou a Etapa A inteira sem um teste que
pudesse contradizê-la. Ele passou a guardar os
corpos recebidos, e o teste que vale é o de **ausência**: com o treino permitido, o pedido não tem
bloco `provider`. Conferi que ele morde — refixar `deny` derruba esse teste e só ele.

**Continua valendo o que se repete há seis entregas:** a interface não foi verificada à mão. O
interruptor, os dois textos de consequência e o novo parágrafo do topo de `/ajustes` estão
implementados e **não verificados** — `apps/web` não tem runner de teste. A sexta seguida é a
informação; o caso isolado já não é.

---

## 2026-09-23 — O catálogo oferecia modelos que a chamada não aceita, e a mensagem de erro não deixava descobrir isso

A Etapa A subiu ontem e **quebrou na primeira tentativa de uso**: o operador favoritou uma variante
`:batch`, clicou em formatar e recebeu 404. Vale registrar o caminho até o diagnóstico, porque ele é
o argumento de metade do que mudou hoje.

**Eliminei por medição antes de achar a causa.** A mesma chave, o mesmo modelo e a mesma política
`data_collection: "deny"` respondem 200 numa chamada à mão; `origin/master` estava no lugar certo;
as rotas `/ai` existiam em produção — respondiam 401 sem token, não 404; o banco estava de pé. Só
então reproduzi contra o provedor com a variante de lote e li
`"openai/gpt-6-luna-pro:batch cannot be used with the chat/completions endpoint (adapter
OpenAIBatchAdapter)"`. **O 404 vinha do nosso pedido, não da nossa infraestrutura.**

**A primeira decisão é que isso é defeito do catálogo, não da chamada.** A alternativa era tratar o
404 na formatação — detectar o caso e explicar. Foi descartada: a variante de lote não serve para
**nenhuma** chamada que fazemos, então oferecê-la é errado em todo lugar onde ela apareça, e
consertar no ponto de uso deixaria a armadilha montada para o próximo ponto de uso. O filtro é na
origem, e a regra de reconhecer uma variante de lote vive em **um lugar só**,
`modelos.service.ts`, exportada para quem precise — hoje a escolha de modelo por tarefa.

**O provedor não expõe campo que identifique a variante, e isso é o fato desconfortável da entrada.**
Comparei a entrada normal com a `:batch` no `/models`: só `id`, `name` e `pricing` diferem. O único
discriminador disponível é o sufixo do `id`. Casar string com o formato de um terceiro é frágil e
não há alternativa — se o provedor mudar a convenção, o filtro para de filtrar em silêncio. O que
segura é a segunda camada: mesmo passando pelo catálogo, o favorito de lote é recusado na escolha do
modelo com 422 e uma frase acionável. Uma camada sozinha não bastaria de qualquer jeito: **filtrar o
catálogo não desfaz a linha que já está gravada no banco de produção**, e era exatamente essa linha
que o operador tinha.

**A mensagem de erro do provedor era inútil, e isso custou tempo real.** "O provedor de IA respondeu
404" não diz a ninguém o que fazer — foi preciso reproduzir a chamada à mão para saber o que
perguntar ao operador. Agora ela carrega o caminho e a mensagem do corpo. Os limites foram
escolhidos: **200 caracteres** e **só quando o corpo é o JSON esperado**, porque é texto de terceiro
indo para a tela e uma página de erro em HTML despejada na interface é outro tipo de defeito. O
caminho é literal e não carrega chave nem dado do usuário. Há um ganho lateral que vale anotar: o
404 mais provável neste código nem vem do provedor recusar — vem de `OPENROUTER_BASE_URL` apontar
para um caminho que não existe, e agora a mensagem mostra qual.

**A exclusão dos apelidos `…-latest` é a mesma decisão do lote por outro caminho, e ela é mais
difícil de defender.** Os 18 apelidos **funcionam**: chamá-los responde 200. O problema é o nosso
desenho, não o deles — o favorito guarda uma **cópia** de preço e de contexto, tirada no dia em que
se favorita, porque a estimativa de custo não pode buscar o catálogo inteiro dentro da requisição e
a lista precisa abrir com o provedor fora do ar. Sob um apelido, essa cópia fica errada **em
silêncio** no dia em que o alvo muda, e a estimativa passa a orçar outro modelo. A alternativa era
mantê-los e não copiar preço para eles, o que exigiria um segundo caminho de estimativa só para um
punhado de modelos. Preferi tirá-los, e a decisão é **reversível**: voltando, eles precisam de
etiqueta própria na tela dizendo que o preço mostrado é o de hoje. Os 15 de saída não-textual saem
sem controvérsia: a tarefa é texto entra, texto sai.

**Os índices de qualidade ordenam e não filtram, e essa assimetria é deliberada.** Descobri no
caminho que o provedor **não expõe** o campo `categories` que a tela dele mostra — as
"especialidades" não vêm pela API, e não dá para reproduzi-las. O que vem são três índices de
terceiro (inteligência, código, agêntico), presentes em **142 dos 348** modelos. Filtrar por eles
esconderia dois terços do catálogo por falta de medição de um terceiro, que é uma afirmação que
ninguém fez. Pela mesma razão, **quem não tem medição não ganha etiqueta** — desenhar um zero ali
seria inventar uma nota ruim para quem ninguém mediu — e, na ordenação, o não medido vai para o
**fim**, nunca para o meio: tratar ausência como zero enfileiraria um modelo não medido atrás dos
piores medidos.

**As faixas de preço saem da distribuição, não do olho.** Medi antes de escolher: mediana em
US$ 0,325 por milhão de tokens de entrada. Daí saem grátis, até US$ 0,50, até US$ 2 e qualquer. O
teto é pelo preço de **entrada** porque é ele que domina a conta ao formatar uma nota — o corpo
inteiro entra e só a formatação sai. Detalhe que vai morder quem mexer: `0` é o filtro de gratuitos,
então a comparação não pode ser `maxPrice &&` em lugar nenhum, nem no servidor nem no front.

**Voltei atrás numa promessa do plano, e o motivo é o mesmo da cópia.** Eu havia prometido que a
lista "Seus modelos" ganharia as etiquetas novas. Ao implementar, `AiFavorite` deixou de estender
`AiModel` e passou a declarar campo a campo o que o banco guarda — o que impede justamente isso.
Índice é medição volátil; congelá-lo dentro de um favorito seria desinformar com cara de dado. Os
índices existem para **escolher** um modelo no catálogo, não para descrever o já escolhido. O tipo
não muda de forma nesta versão: o que ele passa a fazer é **não herdar** os campos novos, e essa é
a única razão de a herança ter saído.

**`apps/mcp` bumpa sem ter sido tocado, e a regra é essa mesmo.** Ele não importa nada de
`packages/shared/src/ia.ts` e nenhuma tool, resource ou prompt mudou. Mas o contrato que ele declara
como dependência mudou, e ele é deployado hoje construído contra o `0.5.0`. A versão de um pacote
diz contra qual contrato ele foi construído; abrir exceção aqui faria `0.7.0` significar dois
contratos diferentes, e a correspondência não se recupera depois. Mesma decisão e mesma razão da
entrada de 2026-09-22.

Ficou pendente: **o teto de gasto continua não exercitável na prática.** A conta do operador é free
tier com crédito, e modelo gratuito custa zero — o teto corretamente não barra e o gasto do dia não
sobe. Continuam de pé a corrida declarada no teto e o defeito do `diaDoPrazo` no MCP
hospedado, que nada aqui toca.

E fica registrado o que já é padrão e não deveria ser: **esta é a quinta entrega seguida que toca
`apps/web` e fecha sem conferência à mão** — Etapas A, B e C da Fase 5, a Etapa A da frente de IA e
esta. Da vez passada a dívida foi escrita como exceção de uma entrega; cinco vezes seguidas ela não
é exceção, é o modo de operação do projeto. Os portões cobrem o servidor e os tipos; a tela vai ao
ar por inspeção do código. Hoje o que ninguém executou são os chips de preço, o seletor de
ordenação, a etiqueta de raciocínio e os índices na lista.

---

## 2026-09-22 — IA aplicada, Etapa A: o Yu-book vira cliente de um modelo, e o Ollama não sobrevive à Railway

Primeira etapa da **Fase 5 do roteiro de IA aplicada** (`applied-ai-read-trip.md`, PRD em
`prd-ia-no-yu-book.md`). O servidor MCP fez o Yu-book ser **servidor**: ele se expõe para que uma
inteligência de fora o use. Aqui ele vai na direção oposta e passa a ser **cliente** — quem está com
o navegador aberto não tem um cliente MCP por perto. Não é fase de produto e não é etapa do MCP.

**O Ollama saiu do escopo, e a decisão derruba dois requisitos do PRD.** O PRD foi escrito supondo
dois provedores, com o local sendo o padrão para tudo que carrega o corpo de uma nota: é a RN-01, é
o RNF-01, é o O2 e é metade da justificativa da RF-02. A API roda na Railway, **sem GPU**. Um
recurso apoiado em modelo local rodaria na máquina do operador e **não existiria em produção**, que
é onde o app é usado — e a alternativa seria hospedar inferência, que é o NO4 do próprio PRD. Entre
manter a promessa de privacidade e ter a função, escolhemos a função e escrevemos a perda. A
consequência é literal e não tem atenuante: **o corpo da nota sai da máquina em toda tarefa de IA,
sempre**. A mitigação é dupla e nenhuma das duas é técnica o bastante para substituir a promessa
perdida — dizer isso **na tela de ajustes**, em vez de só no PRD, e mandar
`provider: { data_collection: "deny" }` na requisição (conferido contra o provedor: não exclui
modelo gratuito do roteamento). O aviso na tela é a parte que importa: a decisão é do usuário e ele
só decide o que sabe. Isso também é o motivo de `MAX_CONTEUDO_IA` existir separado do `MAX_CONTEUDO`
de 1 MB da nota — o que sai da máquina tem que ter tamanho conhecido.

**Sem dois provedores, a interface de provedor da RF-02 não foi escrita.** A RF-02 pedia uma
interface com duas implementações **porque havia duas**; com uma, ela é cerimônia que ninguém
exercita, e abstração sem segundo caso é abstração desenhada para o caso errado. O que ficou no
lugar é o que realmente dá flexibilidade: a injeção de transporte da RF-09 e `OPENROUTER_BASE_URL`.
Quando houver o segundo provedor, a interface nasce medindo as duas implementações de verdade.

**O NO5 cai por pedido do operador, e a razão dele é melhor que a do PRD.** O PRD dizia "não
implementar teto, alerta de cota nem painel de gastos; fica registrado o custo por chamada, teto
entra se doer". Com provedor local no desenho, custo era hipótese; sem ele, toda formatação de nota
é dinheiro. Teto diário e gasto visível entram agora, antes de doer.

**O NO2 foi revisto, e ele não é código nesta etapa.** Nota gerada por IA passa a ser permitida,
desde que **marcada no dado** — o motivo original do NO2 (texto sintético indistinguível no acervo
destrói a confiança na busca e no grafo de backlinks) é atendido pela marca, não pela proibição. A
marca é da etapa C. Fica registrado aqui para que a etapa C não precise reabrir a discussão, e para
que ninguém gere nota antes de a marca existir.

**Rotas em inglês com prefixo `/ai`, contrariando o exemplo do próprio PRD.** O RF-08 escreve
`GET /assistente/saude` literal. O RNF-08 do mesmo documento repete a regra da casa — domínio em
português, fronteira da API em inglês — e os nove grupos de rota que já existem são todos em inglês.
É lapso de rascunho, e **regra vence exemplo**. O diretório, os arquivos e as funções seguem em
português; só o caminho é inglês. O prefixo `/ai` e não `/assistant` pela mesma razão que o resto é
curto.

**A fronteira do dia é do usuário, e é gravada em vez de calculada.** `ai_usage.local_day` guarda o
dia `AAAA-MM-DD` que valia para a pessoa no momento da chamada, e o fuso mora em `ai_preference`. A
API roda em UTC na Railway e o operador vive em UTC−3: sem isso o teto zeraria às 21h, três horas
cedo, **todo dia e calado** — o pior tipo de defeito de teto, porque ele libera gasto em vez de
barrar. Gravar em vez de calcular na consulta é o que garante que a janela do teto seja a mesma que
a tela mostra, mesmo que a pessoa mude de fuso depois. A primitiva é `diaLocal` em `packages/shared`,
e ela é chamada **só pelo servidor** de propósito: o servidor devolve o dia pronto e o front nunca
recalcula, então não há segunda implementação para divergir — o catálogo de espelhamentos frágeis já
tem entradas demais.

**Custo em µUSD inteiro, em todo lugar.** Não há `Decimal` no schema e `JSON.stringify` lança em
`bigint`; ponto flutuante para dinheiro somado ao longo de um dia é erro acumulado. Milionésimo de
dólar em `Int` resolve os três. O preço de catálogo é guardado **por milhão de tokens** pelo mesmo
motivo: o provedor entrega USD por token como string decimal, e por milhão tudo continua inteiro. A
conversão para dólar existe num lugar só, em `packages/shared` — escrita duas vezes, ela vira um
teto de US$ 0,20 que o servidor lê como US$ 200.000.

**A preferência não é criada na leitura.** `GET /ai/settings` devolve os padrões do `packages/shared`
sem gravar linha nenhuma; quem cria é o `PATCH`. A alternativa — criar no primeiro `GET` — era mais
simples de escrever e foi descartada porque um `GET` que escreve surpreende quem depura, e porque o
padrão passaria a viver em dois lugares. É também a razão de `AiPreference` não ter `@default` no
Prisma: o padrão já existe em `TETO_DIARIO_PADRAO_MICROS` e `FUSO_PADRAO`, e um segundo divergiria
sem nada reclamar. De um jeito ou de outro, a rota nunca devolve 404 por falta de configuração.

**A cascata de custo tem três degraus, e o degrau fica gravado.** `provedor` quando ele informa,
`estimado` quando dá para calcular pelo preço do catálogo, `desconhecido` quando não veio nem custo
nem token. O terceiro é o perigoso: grava zero, e **zero não move o teto**. Um provedor que parasse
de informar custo tornaria o teto decorativo em silêncio — quem olhasse a tela veria gasto zero e
concluiria que não gastou. Por isso as chamadas sem custo informado do dia são contadas e
**mostradas na tela**. Teto que mente é pior que teto nenhum, e a única defesa contra um teto que
mente é ele admitir que não sabe.

**A guarda de wikilink é código, não prompt, e foi corrigida na revisão.** A RN-06 diz que nenhum
prompt que edite conteúdo pode alterar `[[…]]`, porque `note_link` é tabela derivada e reescrever o
texto quebraria o grafo. Pedir isso ao modelo é pedir, não garantir: a resposta é conferida antes de
ser aplicada. A correção da revisão foi o que a conferência compara — era lista ordenada de alvos,
passou a ser **conjunto de alvos normalizados**. `note_link` é um conjunto; comparar por índice
recusaria uma formatação legítima só por ela ter reordenado itens de uma lista, **depois de a
chamada já ter sido paga**. Recusa cara e errada é o pior dos dois mundos.

**Uma violação da INV-04 e um vazamento, os dois encontrados antes do fim.** `desfavoritar` era
checar-depois-agir; a posse passou para a mesma operação que apaga. O vazamento foi mais
interessante: `GET /ai/health` devolvia o rótulo do provedor, que **por padrão é o prefixo da
própria chave**. A primeira correção foi esconder o campo no JSX, e ela não bastava — o corpo da
resposta chega ao navegador, à aba de rede e a qualquer cache no caminho. Esconder no cliente nunca
é redação; a redação pertence ao service.

**O alçapão do valor padrão mordeu duas vezes na mesma sessão.** `function f(x = env.ALGO)` chamada
com `undefined` explícito **reassume o ambiente** — em JavaScript o padrão se aplica ao argumento
ausente e ao `undefined` passado de propósito, e os dois casos são indistinguíveis de dentro. O
efeito prático: o teste de "sem chave configurada" passou a testar outra coisa no dia em que a suíte
ganhou uma chave de mentira, e continuou verde. `saude` passou a receber um objeto e a usar
`"chave" in opcoes`, que distingue "não informei" de "informei que não há". Vale para qualquer
função do projeto que tenha `env` como valor padrão de parâmetro.

**Propagação ao MCP: conferida e nula.** As nove tools, os quatro resources diretos, os dois
templates e os dois prompts foram percorridos — nenhum muda, porque nota, card, board, coluna, link,
tag e workspace **não ganharam campo**. Os seis códigos de erro novos são inalcançáveis pelo MCP: só
saem de `/ai/*`. `tools/list` medido em 3480 bytes com cinco tools e 8551 com nove, inalterado.
`POST /ai/notes/:id/format` **não vira tool**, e o motivo não é o NO3: seria inferência dobrada —
um modelo chamando outro —, cobrada do teto diário do operador, para entregar ao primeiro um texto
que ele não tem onde gravar. `apps/mcp` bumpa mesmo sem mudar comportamento, porque `ERROR_CODES`
mudou e `cliente.ts` consome `ApiErrorBody`: a versão de um pacote diz contra qual contrato ele foi
construído.

**Defeito pré-existente iluminado, e deliberadamente não consertado aqui.** `diaDoPrazo` em
`apps/mcp/src/formato.ts:56` usa `getMonth()`/`getDate()`, que são o fuso **do processo**. O MCP
hospedado roda em UTC: ele relata **todo prazo um dia à frente**, e `diaParaPrazo` grava o prazo
três horas cedo. Medido nesta sessão, fora do escopo desta entrega. O que esta entrega trouxe é a
primitiva do conserto — `diaLocal` em `packages/shared` e o fuso do usuário no domínio, que antes
não existia em lugar nenhum. É a última linha do catálogo de espelhamentos frágeis que ainda não
passa por `shared`, e agora dá para fechá-la.

**Dívida de conferência, na mesma forma da Fase 5 e pelo mesmo motivo: `apps/web` não tem runner de
teste.** Foram conferidos à mão: provedor conectado, catálogo buscável, nota formatada com três
`[[wikilinks]]` intactos e o gasto do dia subindo. **Não** foram: o desfazer em 8 s (CA-05), a
recusa ao editar durante a formatação (RF-15), a ausência de colateral em título, tags e workspace
(RF-13) e a recusa por teto atingido. As duas últimas dependem de gastar dinheiro de verdade — com
modelo gratuito o custo é zero, o teto corretamente nunca barra e o gasto do dia não sobe, então os
dois caminhos não são exercitáveis à mão numa conta sem crédito.

**Corrida no teto, declarada e aceita.** O limite de 10/min da rota, com orçamento de 60 s por
chamada, deixa até dez pedidos passarem pela leitura do gasto antes de a primeira linha de uso
existir. O conserto seria transação com `SELECT ... FOR UPDATE` ou uma coluna de reserva; foi
descartado por ora porque o sistema tem **um usuário e uma tela**, e o estouro máximo é dez chamadas
de uma tarefa só. Fica escrito porque a segunda tarefa (chat, com streaming) muda essa conta.

---

## 2026-09-04 — MCP: a segunda camada da trava de escrita, e o pacote sai da máquina do operador

Fecha as duas limitações da entrega anterior que ainda eram código. Continua sendo a **Etapa 4 das
cinco da proposta de MCP** e a **Fase 3 do roteiro de IA aplicada** — a Etapa 5 não começou. O que
mudou de categoria foi outra coisa: `apps/mcp` deixou de ser um pacote que só roda na máquina do
operador.

**Defesa única falha calada, e esta fase já provou isso três vezes.** O envelope sem rótulo de tipo
e o `client_id` vazio passaram por revisão e por 32 testes. A trava de escrita era a terceira
candidata: existia só no registro, em `criarServidor({ escrita })`, e o registro decide uma vez por
sessão. Duas falhas concretas passavam por ele. A primeira é a tool nova no módulo errado — uma
quinta tool de escrita registrada dentro de `registrarToolsDeNotas` em vez de
`registrarEscritaDeNotas` fica registrada **sempre**, e nada reclama: nem o compilador, nem os
testes, nem a execução. A segunda é o escopo que encolhe com a sessão viva, abaixo. A alternativa
era confiar no registro e escrever isso como convenção no README; foi descartada porque convenção
não derruba build, e o custo da checagem no ponto da chamada é uma palavra por handler.

**O guarda é total nos dois transportes, e no stdio ele não é `return true`.** Foi a decisão menos
óbvia da sessão. A leitura fácil é que a segunda camada existe por causa do HTTP — é lá que há token
e escopo — e que no stdio não há nada a conferir. Errado: no stdio há a pergunta que importa ali,
que é *estou escrevendo onde eu acho que estou*. Uma tool de escrita registrada sem condição, contra
uma API remota, é exatamente o desastre que `YUBOOK_ESCRITA_REMOTA` existe para evitar, e é a falha
1 acontecendo em produção. Por isso `podeEscrever` ramifica por transporte em vez de sair cedo.

**A ordem dentro de `comErroDeEscrita`: o guarda antes de `relatar(...)`.** Não é detalhe de estilo.
O log das tools de escrita é a única trilha de auditoria que chega ao usuário, e um registro de
escrita que não aconteceu é pior que nenhum registro. A recusa também precisa dizer ao modelo que
**nada foi alterado** e que repetir não resolve — sem isso ele tenta de novo, e uma escrita que
"falhou" duas vezes pode ter acontecido duas vezes.

**O furo do rebaixamento de escopo era real, e o achado veio de olhar o provedor com a sessão em
mente.** `exchangeRefreshToken` aceita `scope` no pedido e filtra o concedido — comportamento
correto de OAuth. Mas os escopos congelam na criação da sessão MCP, e o `mcp-session-id` sobrevive à
renovação: um cliente podia renovar pedindo só leitura e seguir usando a mesma sessão com as nove
tools registradas. A correção é encerrar a sessão quando a superfície e o token divergem, e ela é
**simétrica de propósito** — perder ou ganhar `yubook:write` encerra igual. Manter viva a sessão que
ganhou escopo pareceria generosidade, mas produziria um `tools/list` que esconde uma tool já
autorizada, e o catálogo que mente é o problema nos dois sentidos. O 404 é honesto porque a sessão
acabou de verdade: quem responde "desconhecida" acabou de torná-la desconhecida.

**O arnês de teste em memória, e por que ele não usa o `Client` do SDK.** Os testes anteriores
construíam os objetos que a integração deveria fornecer — provavam as peças, não a superfície —, e é
por isso que os dois últimos defeitos da entrega anterior apareceram à mão. O arnês fala JSON-RPC de
verdade contra o servidor por `InMemoryTransport`. O `Client` do SDK foi descartado por um motivo
específico: ele não envia `authInfo` por mensagem, e é exatamente isso que precisa ser controlado
para chamar uma tool de escrita com um token de leitura. `InMemoryTransport.send(msg, { authInfo })`
envia, e o próprio SDK documenta o parâmetro como para cenários de autenticação. O preço foi
escrever a correspondência de resposta por `id` num mapa — o mínimo que um cliente JSON-RPC precisa
ter.

**A lista de tools de escrita é derivada, não escrita à mão.** Sobe o servidor com e sem escrita e
subtrai os dois `tools/list`; os argumentos mínimos saem do `inputSchema`, porque o SDK valida antes
de chamar o handler. A alternativa — um array com os quatro nomes — teria o defeito de esquecer a
quinta tool, que é a falha 1 de novo, agora no teste. O teste que garante isso é o "o conjunto
derivado não é vazio": sem ele, uma derivação quebrada passaria como suíte verde de zero casos.

**`trust proxy` é `1`, e não `true`.** `true` confia na cadeia inteira de `X-Forwarded-For`, e o
cliente escreve esse header: trocaria de balde a cada tentativa, que é o que o limite de 20 logins
por 5 minutos existe para impedir. `1` confia num salto, que é o que a Railway põe na frente. Se
outro proxy entrar no caminho, o número muda junto — o valor é a topologia, não uma configuração
genérica.

**Ficou como dívida:** a `apps/api` usa `trustProxy: true` do Fastify, com o defeito que o `1` acaba
de corrigir no MCP. Foi deixada de fora deliberadamente, para não misturar mudança de
comportamento em produção da API com o primeiro deploy do MCP — este push já muda o que roda em
produção o suficiente.

**`NODE_ENV` e `MCP_TRANSPORTE` no `startCommand`, não como variáveis de serviço.** O primeiro
porque `NODE_ENV=production` de serviço some com as devDeps e quebra o build (`tsc: not found`) —
lição que a API já tinha pago. O segundo é decisão nova: `MCP_TRANSPORTE` como variável de painel é
esquecível, e esquecê-la sobe o processo em `stdio`, onde ele fica mudo, sem porta, sem erro, e o
healthcheck falha sem dizer por quê. No comando é impossível esquecer.

**O primeiro deploy sobe com `MCP_ESCRITA_HABILITADA=0`** — decisão do operador. Hospedado, a trava
por host local não protege mais nada: o alvo é a API de produção, e um pedido mal interpretado pelo
modelo cria dado de verdade no segundo cérebro. Primeiro voo só de leitura; ligar depois é uma
variável no painel, sem deploy de código, e é para isso que o desligamento global existe.

**Pendência:** o aperto de mão OAuth completo com navegador continua sem teste automatizado. O arnês
novo cobre a superfície JSON-RPC e não chega ao fluxo de autorização — que é onde nasceram os dois
defeitos de autenticação desta fase.

---

## 2026-09-01 — Servidor MCP, Etapa 4: o transporte que cria o problema de identidade

Esta é a **Etapa 4 das cinco da proposta de MCP** (`old/proposta-mcp-inicial.md`) e a **Fase 3 do
roteiro de IA aplicada** (`applied-ai-read-trip.md`). Não é fase de produto. As três numerações
continuam sem se converter uma na outra — a entrada de 2026-08-26 explica de onde vem cada uma.

**A lição da etapa é que transporte e autenticação são a mesma coisa.** Em `stdio` a credencial no
`.env` **está certa**: um processo por pessoa, iniciado por ela, e o processo é dela. Sobre HTTP o
mesmo arquivo vira uma identidade só para todo mundo. Não foi a autenticação que ficou fraca; foi o
transporte que retirou a premissa que a sustentava. Por isso o `env.ts` **recusa o boot** em `http`
com `YUBOOK_EMAIL` definida: subir errado aqui é pior que não subir.

**Emitir token próprio, e não repassar o de um terceiro.** A alternativa era delegar a um provedor
externo e aceitar o token dele. Foi descartada porque o Yu-book já tem contas, já tem `POST
/auth/login` e já tem toda a autorização por usuário na API — o servidor MCP é cliente da API, não
do banco, e essa decisão é de duas etapas atrás. Introduzir um segundo emissor de identidade criaria
uma conta que o Yu-book não conhece e a obrigação de mapear uma na outra. O preço aceito: um
servidor de autorização OAuth 2.1 escrito à mão, com registro dinâmico, PKCE e página de
consentimento — a superfície de ataque mais delicada do repositório, e a razão de os testes novos
terem nascido aqui e não nas tools.

**Nenhum estado durável no emissor, por escolha.** Cliente registrado, código de autorização e
refresh token viajam cifrados dentro do próprio identificador (AES-256-GCM mais HS256, tudo em
`node:crypto`). A alternativa era uma tabela no Postgres da API. Foi descartada porque obrigaria o
servidor MCP a falar com o banco, quebrando a decisão de ele ser cliente da API; e porque um mapa em
memória — que foi o que existiu durante metade da sessão — tem o defeito pior de todos: **reiniciar
o processo derrubava todos os tokens vivos**, e um deploy silenciosamente deslogava todo mundo. O
que se paga em troca está declarado abaixo, no teto de 120 s.

**O rótulo de tipo no envelope, e o desvio que ele fechou.** O envelope do código de autorização era
**superconjunto estrutural** do envelope de refresh token: os campos que o refresh exigia estavam
todos lá. Um código apresentado em `grant_type=refresh_token` abria como refresh, e devolvia token
com escopo de escrita — contornando de uma vez o uso único, o `exp` de 60 s e o PKCE. Isso é um
desvio de autenticação real, escrito por nós, encontrado por revisão. A correção não foi conferir
campo a campo, que a próxima estrutura parecida furaria de novo: foi carimbar o **tipo** dentro do
conteúdo cifrado e devolver `null` para qualquer envelope de outro tipo. Vale a lição: em envelope
opaco, compatibilidade estrutural é uma porta, não uma coincidência.

**A janela de graça de 30 s no `refresh` da API, e o que ela custa.** A rotação de refresh token é
atômica e o token novo só existe na resposta. Se a resposta se perde, ou o processo reinicia entre o
commit e a entrega, o cliente reapresenta o anterior de boa-fé — e a regra antiga concluía vazamento
e revogava **todas** as sessões do usuário, inclusive a do navegador, que não fez nada. A janela
cega exatamente a corrida que a rotação existe para pegar: se alguém roubar um refresh e usá-lo
primeiro, a apresentação do legítimo chega segundos depois e agora vira 401 mudo em vez de derrubar
a cadeia roubada. A troca foi decidida com o número na mão — 30 s de cegueira contra deslogar o
operador de todo lugar por uma resposta perdida. Fora da janela, nada mudou. Isto **altera o
INV-06**, já reescrito no catálogo.

**A identidade entrou sem tocar em nenhuma assinatura.** As 16 chamadas de API do servidor não
recebem portador por parâmetro, e passá-lo teria sido uma mudança em cascata em tool, resource e
prompt, com o risco de esquecer uma — e uma esquecida é uma chamada com a identidade errada, que
nenhum tipo pega. A saída foi `AsyncLocalStorage` aberto em `comErro`/`comErroDeResource`, os dois
lugares por onde 100% dos handlers passam, e lido em `cliente.ts`. Variável de módulo não serviria:
duas sessões concorrentes sobrescreveriam o portador uma da outra. Em `stdio` não há contexto e o
cliente cai na conta do ambiente, que ali é a identidade certa.

**A trava de escrita tem eixos diferentes nos dois transportes, e não é engano.** Em `stdio` quem
decide é a URL da API ser local (`YUBOOK_ESCRITA_REMOTA` destrava), porque não existe identidade a
consultar. Em HTTP quem decide é o **escopo do token**, marcado no consentimento — e
`MCP_ESCRITA_HABILITADA=0` é o desligamento global que sobra para quando o servidor estiver
hospedado contra a API de produção. Unificar os dois eixos exigiria inventar um deles onde ele não
faz sentido.

**A sessão é com estado, e isso custa escala horizontal.** `sessionIdGenerator` definido é o que
mantém o SSE aberto; sem ele o SDK desliga a via de volta, e com ela vão o log das escritas — a
única trilha de auditoria que chega ao usuário — e o progresso. Preferiu-se o certo ao genérico: com
duas instâncias isto quebra, porque o POST de uma chamada e o GET do SSE podem cair em máquinas
diferentes. Uma instância, sempre, e se um dia houver duas é em `http.ts` que se olha. A sessão
também precisou de varredura de ociosas e teto duro porque **o SDK não fecha sessão quando o cliente
some**: o vazamento é calado, e sem teto vira negação de serviço.

**Dois defeitos apareceram à mão, no fim, e é o que dá a medida do buraco de teste.** `getClient`
devolvia `client_id: ""` para todo cliente, o que tornava tautológica toda comparação de cliente; e
um POST sem session id com corpo que não fosse `initialize` vazava um `McpServer` por tentativa. Os
32 testes novos cobrem as peças — envelopes, provedor, contexto de identidade —, mas **nenhum
exercita o aperto de mão OAuth completo**, e foi exatamente ali que os dois estavam. A dívida fica
registrada com esse nome.

Pendências assumidas, todas no changelog: o teto real da proteção contra revogação em massa é de
**120 s** e não de 30 — quem manda é a janela de idempotência do MCP, não a graça da API, e fechar
isso exigiria o estado durável que se decidiu não ter; `logout` com refresh de rotações atrás não
revoga nada e exige uma coluna `replacedById` no schema; e `trust proxy` não está configurado, o que
na Railway transforma o limite por IP do `/login` num balde global.

**O que ficou de fora, de propósito, é a Etapa 5 do que falta aqui:** conferir o escopo **dentro** de
cada handler de escrita — hoje a trava é só na montagem da sessão, e um handler novo entra sem ela
sem que nada reclame — e o deploy na Railway.

---

## 2026-08-26 — Servidor MCP, Etapa 3: a escrita, e o que decidiu não existir

O servidor passou a mudar dado. São **três numerações vivas no repositório e elas não se
convertem**: esta é a **Etapa 3 das cinco da proposta de MCP** (`old/proposta-mcp-inicial.md`), que
a Etapa 2 declarou fora do próprio escopo em `old/prd-mcp-resources-e-prompts.md` NO1; é a **Fase 2
do roteiro de IA aplicada** (`applied-ai-read-trip.md`); e **não** é fase de produto — as de produto
vão de 0 a 5, estão fechadas, e a próxima delas segue sendo a agenda. Quem unificar os números
depois vai errar os três.

**Granularidade estreita, por escolha do operador.** Uma escrita por chamada, com o menor schema
que resolve o caso. O schema de uma tool não é assinatura de função: é contrato de conversa com o
modelo, e cada campo a mais é uma liberdade a mais para ele inventar combinação inválida. Duas
ausências no `create_card` são decisão, não esquecimento — `checklist` ficou fora porque obriga o
modelo a inventar identificador estável por item, o campo com mais chance de erro e menos valor numa
criação; `position` ficou fora porque a API ignora posição na criação, o card nasce no fim, e aceitar
o parâmetro seria prometer o que não se cumpre. O preço da escolha está medido: `tools/list` saiu de
3480 bytes com 5 tools para 8517 com 9, e isso se paga em todo turno.

**"Arquivar nota" não existe no domínio, e por isso a tool não podia se chamar `archive_note`.** A
proposta original pedia esse nome. O domínio tem duas remoções com nomes diferentes de propósito:
card se **arquiva** (`archived`, sai do quadro) e nota vai para a **lixeira** (`deletedAt`, some da
busca e dos backlinks). Chamar de `archive_note` inventaria um estado que a tabela não tem. E
`delete_note` seria pior por dois motivos independentes: o modelo lê "delete" como irreversível, e
ou recusa por medo ou executa sem oferecer a volta; e queimaria o nome que a exclusão definitiva
precisaria ter, se um dia for exposta. Ficou `trash_note`, com `restore_note` como par explícito.

**A escrita nasce desligada fora de um host local.** As quatro tools só se registram se
`YUBOOK_API_URL` apontar para localhost; contra a Railway elas somem do `tools/list` e o motivo vai
para o stderr no boot. `YUBOOK_ESCRITA_REMOTA=1` destrava, e destravar custa uma decisão escrita. O
motivo é que a premissa mudou: enquanto o servidor só lia, apontar o `.env` para produção era
inofensivo — a leitura não tem consequência. Com escrita, um pedido mal interpretado cria ou remove
dado de verdade no segundo cérebro, e não existe desfazer deste lado. Daí também o segundo ambiente:
banco `yubook_mcp`, API na 3334, seed recriável. O alvo do erro passou a ser descartável.

**O seed escreve pelos services, não pelo Prisma cru.** É o primeiro seed do projeto, e a tentação
era `prisma.note.create`. Não dá: nota criada pelo service recalcula `note_link` a partir dos
`[[…]]` (INV-17, tabela derivada) e board criado pelo service já nasce com as três colunas padrão
e posições contíguas (INV-11). Inserir direto produziria um banco que **parece** certo e mente sobre
o grafo — exatamente o tipo de ambiente de teste que valida o errado. O usuário, esse nasce por
`register()`, porque o MCP entra por `POST /auth/login` e o `passwordHash` precisa ser o argon2 de
verdade; gravar o hash à mão seria espelhar `ARGON_OPTIONS`, e um espelho divergente quebraria o
login com um erro sem relação aparente com o seed. É o atalho que `tests/apoio.ts` pode tomar (ele
assina o JWT direto) e este não podia.

**A gaveta de links é a única exceção da regra, e está comentada no arquivo.** Os três links entram
por Prisma cru porque `links.service.ts` faz `fetch` da página para descobrir o título, com as
defesas de SSRF de INV-08, e um seed não pode depender de rede. A exceção é segura pelo mesmo
critério que criou a regra: `link` não tem **nada derivado**, ao contrário de `note_link`, que só
existe porque o service o calcula. A regra nunca foi "use o service"; é "não escreva à mão o que
outra coisa deriva".

**O seed cresceu depois da revisão, e o motivo é que ambiente de teste que não alcança um ramo não
o testa — apenas deixa de reprovar.** Vários caminhos existiam no código sem poder ser
exercitados. Entraram duas notas na lixeira (uma para a restauração feliz; a outra formando
colisão de título com uma nota ativa, criada **nessa ordem** porque o índice único é parcial e só
cobre as ativas), um card arquivado, `wipLimit: 3` na coluna "Fazendo", um card com checklist 2/3 e
três links. Dois números vão junto e a diferença precisa estar escrita: o seed cria **16 linhas em
`card`, das quais 15 ativas**, e `list_boards` diz 15 porque `listarBoards` conta `archived:
false`. Os dois estão certos e a diferença **é** INV-13. E a coluna "Fazendo" fica com 4 cards
ativos contra `wipLimit: 3` de propósito: o estado que prova INV-15 é o **estourado**, não o
limite existindo.

**Amostragem (*sampling*) não será usada, e isto é registro, não omissão.** Ela serve para o
servidor pedir emprestado o modelo de quem o chamou — e aqui quem chega pelo MCP **já tem um modelo
do outro lado**, que é o que está lendo a tool. Pedir amostragem seria pedir que gerasse um texto
que ele geraria sozinho, com uma volta a mais no protocolo e dependendo de uma capability que a
maior parte dos clientes não implementa. O argumento que decide, porém, é de privacidade e vem da
direção oposta do projeto: a IA **dentro** do Yu-book (`prd-ia-no-yu-book.md`) roda em modelo local
por exigência (RNF-01), e amostragem faria o corpo da nota atravessar o protocolo para ser
processado por um modelo que não é o escolhido. Revisitar se o transporte virar HTTP e o servidor
sair da máquina do operador: amostragem paga a conta em servidor público e multiusuário.

**Raízes (*roots*) não se aplicam** — `apps/mcp` não abre um único arquivo, é cliente HTTP da API.
Implementar hoje seria código morto. A lição fica guardada para a mesa de trabalho, que vai precisar
de cópia em disco de vários repositórios.

**Log vale mais que progresso, e o motivo é auditoria.** Estas são as primeiras operações do
servidor que mudam dado, e todo diagnóstico deste pacote vai para stderr, que nenhum cliente MCP
mostra: um `notifications/message` por escrita é o único registro que o usuário chega a ver de que
uma nota foi para a lixeira. Progresso, com tools estreitas contra API local, é quase ornamental e
entra assim mesmo, porque o mecanismo é o mesmo de que o backfill de embeddings vai precisar (RF-30
do PRD de IA pede progresso visível e retomada) e construí-lo agora custou zero. O que **não** se
faz é inventar passo artificial para a barra parecer cheia: progresso falso ensina o usuário a
ignorá-lo. Junto veio uma regra que não se quebra — **notificação nunca decide o resultado de uma
tool**: quando o relato é emitido a escrita já aconteceu, e deixar um `sendNotification` lançar
transformaria criação bem-sucedida em `isError`, com o modelo criando o card de novo.

**A revisão pegou uma afirmação falsa que eu tinha escrito, e a lição não é sobre o fato errado.**
A descrição de `trash_note` dizia que os links `[[…]]` não voltam ao restaurar. Voltam:
`restaurar` (`apps/api/src/modules/notes/notes.service.ts`) chama `recalcularLinks` para a saída
**e** `reconstruirEntradas` para a entrada — provado no banco de teste, 1 → 0 → 1 aresta em
`note_link` ao excluir e restaurar. A origem do erro é rastreável e é o que interessa guardar:
generalizei o **título** de INV-19 ("restaurar não os refaz"), que no corpo escopava o "não refaz"
ao **card**, e não li INV-18, que diz o oposto para os links. Duas consequências valem a linha —
duas tools do mesmo servidor passaram a se contradizer, e o texto de confirmação contava como perda
justamente o número que volta.

A lição transferível: **juntar numa frase só o que o desfazer desfaz e o que ele não desfaz foi o
que produziu o erro.** Não é descuido de redação, é a estrutura da frase convidando à
generalização. A confirmação de `trash_note` agora separa os dois em linhas distintas, e o
`invariantes-yu-book` já foi corrigido pelo curador: INV-19 passou a se chamar "Excluir nota
desfaz dois vínculos; restaurar refaz um só", com a instrução explícita de não juntar os dois numa
frase só. INV-40 entrou na mesma passagem, para o id de coluna sem o qual as tools de escrita são
inalcançáveis.

**Limite conhecido descoberto junto:** a volta dos backlinks é **melhor esforço**.
`reconstruirEntradas` peneira candidatos com `contentMd contains "[[" + titulo`, que é sensível a
caixa, enquanto casa o alvo por `lower(immutable_unaccent(title))`. Medido:
`[[Notificações de progresso` acha 1 candidato, `[[notificações de progresso` acha 0. O wikilink
continua funcionando na interface, que resolve normalizado; o que não volta é a linha em
`note_link`. Não foi corrigido nesta etapa — é comportamento da API, não do MCP.

**Quatro bugs preexistentes apareceram no caminho, e um era bloqueante.** `formatarQuadro` não
imprimia o id da coluna, e nenhuma outra superfície do servidor imprimia: sem ele não havia caminho
para descobrir um `columnId`, e `create_card` e `move_card` nasceriam inalcançáveis. O segundo é um
off-by-one de um dia no prazo, em todo card que tem um: o front grava às 23:59:59 do fuso local e o
MCP fatiava o ISO em UTC, o que em UTC-3 cai no dia seguinte — corrigido com `diaDoPrazo` e
`diaParaPrazo`. O terceiro, `ErroDaApi` descartava os `issues`, e erro de validação chegava ao
modelo como "Dados inválidos", frase sem informação que o leva a repetir a chamada igual. O quarto:
os dois prompts afirmavam "este servidor é somente leitura", o que desligaria as tools novas
justamente nos fluxos empacotados. Os quatro são anteriores a esta etapa; o quinto, o de cima, foi
**introduzido e pego dentro dela**, e a diferença importa — dívida antiga se herda, afirmação falsa
sobre o próprio domínio se produz. Vieram junto correções menores da mesma revisão:
`trash_note` subcontava os cards desvinculados, porque `cardsDaNota` filtra `archived: false` e
`excluir` zera o `noteId` de todos — card arquivado perdia o vínculo sem entrar na conta;
`trash_note` numa nota já na lixeira devolvia 404 e ainda emitia passo de progresso de algo que não
aconteceu; `diaParaPrazo` lançava `RangeError: Invalid time value` cru para o modelo diante de uma
data sintaticamente válida e inexistente (`2026-13-45`); e um comentário citava "INV do domínio,
Fase 2", identificador que não existe em lugar nenhum, agora apontando os arquivos.

**Dívida declarada na correção do prazo.** A conversão ficou local em `apps/mcp/src/formato.ts`. A
doutrina do projeto (skill `contrato-compartilhado`) mandaria levá-la para `packages/shared` junto
com o que `apps/web/src/components/PainelCard.tsx` faz, porque são duas implementações da mesma
convenção de "fim do dia local" e é exatamente o tipo de espelho que diverge em silêncio. Não foi
feito, para conter o escopo desta etapa. Fica registrado como o próximo candidato a contrato.

**Dívida assumida: não há tool para listar a lixeira.** A consequência é concreta — `restore_note`
só alcança o que a própria conversa acabou de excluir, porque `search_notes` não enxerga nota
excluída e o id não vem de lugar nenhum depois que a conversa acaba. O operador escolheu o conjunto
de quatro tools sabendo disso. A saída, se incomodar na prática, é uma `list_trashed_notes` sobre
`GET /notes?trash=true`.

**O que deliberadamente não virou tool:** excluir card e excluir nota em definitivo (irreversíveis;
card nem lixeira tem, e o aplicativo já faz as duas com um humano confirmando); criar quadro, coluna
ou workspace (é estrutura — quadro criado por conversa vira quadro paralelo em silêncio, e excluir
coluna exige decidir o destino dos cards, INV-14); e editar nota ou card, que é outro problema, com
concorrência contra o autosave do front e merge de conteúdo.

**Esta etapa foi verificada de verdade, e é a primeira em três que se pode dizer isso.** Além do
typecheck nos quatro pacotes, dos 55 testes da API e do build do MCP, rodaram roteiros sequenciais
completos contra o ambiente local: lixeira → busca não acha → restauração → `get_note` confirmando
o que volta e o que não volta → restauração idempotente. Zero linhas não-JSON no stdout em todos os
roteiros; progresso presente com `_meta.progressToken` e ausente sem ele, com log nos dois casos;
contra a Railway, só as cinco tools de leitura aparecem. E `get_board` contra
`yubook://board/{id}`: 1385 bytes idênticos caractere a caractere, que é a prova de que a superfície
se duplica e a implementação não.

Com o seed ampliado, quatro caminhos que antes só existiam no código foram **exercitados**:
`restore_note` na armadilha de título devolveu 409 `TITULO_DUPLICADO`, usando uma mensagem de
`erros.ts` que existia sem nunca ter rodado; `trash_note` em nota já na lixeira devolveu o aviso com
o id para desfazer, sem 404; `move_card` em card arquivado recusou com "Card arquivado não se move.
Desarquive primeiro." (INV-13); e `create_card` com `dueDate: "2026-13-45"` recusou dizendo que não
é uma data existente. Depois das nove correções, `tools/list` ficou em **8517 bytes** com 9 tools —
196 a menos que antes delas, com só `trash_note` crescendo, e crescendo para desfazer a afirmação
falsa.

**Pendências.** A mais importante: **a trava de ambiente protege contra *remoto*, não contra *o
banco errado*.** Ela olha o host, e `localhost:3333` — o banco de desenvolvimento, o acervo de
trabalho de verdade — passa por ela sem reclamar, com o stderr anunciando `escrita: habilitada (API
local)` com toda a confiança. Não é risco hipotético para quem for configurar: é o **estado atual de
quem já configurou**, porque `3333` era o padrão anterior do `.env.example` e nenhum `.env` existente
foi migrado. A porta é a única diferença entre os dois ambientes e nada a verifica. A saída não é
óbvia — checar a porta seria arbitrário, e o sinal honesto seria o servidor perguntar à API em que
banco ela está —, por isso fica registrada em vez de remendada.

Também aberto: a dívida do `diaDoPrazo` em `packages/shared`, acima; e o limite de caixa em
`reconstruirEntradas`, que é da API e não do MCP. E `docs/applied-ai-read-trip.md`
ainda diz "Fases 0 a 4 entregues" e chama a agenda de "Fase 5 de produto", enquanto o README diz 0 a
5 concluídas e chama a agenda de Fase 6 — o roteiro foi escrito antes de a Fase 5 fechar e precisa
ser reconciliado com o README na próxima passagem por ele.

---

## 2026-08-24 — Fase 5, Etapa C: o editor ao vivo, e o que ele custou

A etapa fecha a Fase 5 e a proposta. Saiu em duas metades: os dois commits de ponto de controle
(`f99c0ad`, correção de dois atalhos; `fe798d6`, botão de copiar) e o editor ao vivo, que veio
depois. Uma entrada só no changelog porque movem o mesmo pacote.

**`@codemirror/lang-markdown` foi recusado, e não foi só por peso.** Ele importa
`@codemirror/lang-html` estaticamente e o avalia em escopo de módulo, então tree-shaking não remove:
viriam as pilhas de HTML, CSS e JavaScript junto, ~175 KB gz contra ~105 do conjunto mínimo. O que
decidiu, porém, foi outra coisa: aquele pacote instala três comportamentos que **mexem no documento
sozinhos** — continuar o marcador de lista no Enter, transformar URL colada em link, completar tag
HTML. O requisito de não reescrever um byte (RNF-08) é inegociável aqui, porque `contentMd` é o que
o MCP lê e o que os wikilinks derivam. Usamos `@lezer/markdown` cru embrulhado num `Language`, que é
exatamente o que aquele pacote faz por dentro, sem as três gentilezas.

**A `<textarea>` ficou, e essa é a decisão mais importante da etapa.** Só o modo novo usa CodeMirror;
`edicao`, `dividido` e `leitura` continuam idênticos, na `<textarea>` de sempre. Resolve quatro
coisas de uma vez: o carregamento sob demanda tem o que mostrar enquanto o chunk não chega, CA-33
sai de graça, existe saída imediata se o editor novo der errado — e **acessibilidade**. O
`contentDOM` do CodeMirror é um `role="textbox"` sem nome acessível, só o viewport existe no DOM, e
esconder marcação tira texto do DOM de propósito. Para quem usa leitor de tela, o modo ao vivo é
pior que a `<textarea>`; manter os três modos antigos não é conservadorismo, **é** a mitigação.

**O índice de decoração é reconstruído com três guardas.** Só o viewport visível; comparação das
linhas ativas antes de redesenhar por movimento de cursor; e `if (view.composing) return`. Esta
última é sobre português: cada acento morto (á, ã, ç) é uma composição, e trocar DOM sob composição
ativa duplica ou perde caractere. Custou pouco e evita um bug que só apareceria em uso real.

**`defaultHighlightStyle` foi descartado.** Traz cores fixas, que não seguiriam os dois temas. As
decorações pintam com as variáveis do `index.css`, então o tema claro e o escuro saem sem um
condicional em JavaScript — mesma regra que vale para o resto do front.

**A chave do `localStorage` do modo foi renomeada** (`yb:modo-nota` → `yb:modo-nota-2`), para migrar
o operador ao modo novo uma vez. Trocar só o default não bastaria: o valor antigo continuaria
valendo e o modo que a etapa inteira existe para construir ficaria escondido de quem já tinha
escolhido `dividido`. A chave velha é varrida na primeira leitura, não lida.

**Três desvios foram corrigidos no PRD, porque ele afirmava o contrário do que foi entregue.**

- **RF-31 saiu do escopo**: o botão de copiar não tem atalho. `Ctrl+Shift+C` é "inspecionar
  elemento" no Chrome e no Firefox e `preventDefault()` não cancela. Decisão do operador.
- **`caret.ts` não foi removido.** D-01 e a §17 item 7 diziam que a Etapa C o removeria — e isso
  pressupunha substituir a `<textarea>`. Como ela ficou, o autocomplete dela continua usando
  `posicaoDoCursor` e `wikilinkEmDigitacao`. As duas afirmações foram corrigidas no PRD.
- **Bloco de código no modo ao vivo não tem realce por token**, só monospace e fundo. Realce dentro
  da cerca exigiria parsers aninhados por linguagem, exatamente o peso recusado acima. É uma redução
  frente à redação de RF-33, e o realce completo continua nos modos que passam por `renderMarkdown`.

**Fora de propósito, e assumido:** `marked` e o parser do Lezer convivem no bundle, então o mesmo
texto pode aparecer levemente diferente entre o editor ao vivo e o modo leitura. Unificar os dois
seria trocar o motor de renderização de leitura, que está fora da Fase 5.

**Ficou pendente, e pesa mais do que nas etapas anteriores: nada disto foi executado.**
`pnpm typecheck` limpo nos quatro pacotes, 55 testes da API verdes (nenhum novo — a API não mudou) e
o build do front ok, mas **nenhum portão do projeto carrega uma `EditorView`**, porque não existe
teste de front aqui. Um editor inteiro foi escrito e nunca rodou uma vez. CA-23 a CA-35 estão
implementados e **não verificados**. É a terceira entrega seguida assim, e a primeira em que o não
verificado é um motor de edição e não um ajuste de tato — a falta de teste de front deixou de ser
uma economia e virou dívida com juros. Vale abrir a discussão antes da Fase 6.

---

## 2026-08-24 — Três decisões do operador fechadas na documentação

Nenhuma linha de código mudou aqui; o que mudou foi o que a documentação afirma. Estavam abertas no
PRD coisas que o operador já tinha decidido, e quem começasse a Etapa C leria que ela estava
bloqueada por uma pergunta respondida.

**D-01 fechada: o editor ao vivo será CodeMirror 6 com decorações.** O operador autorizou a
dependência. Ela é a maior que o projeto já aceitou, e o `CLAUDE.md` proíbe biblioteca de UI e de
ícones — um motor de edição de texto não é nem um nem outro, e a autorização vale para o CodeMirror
6 e para nada além dele; RNF-13 continua de pé. As três alternativas seguem registradas em D-01 com
o motivo da recusa; a que mais doía descartar era o `textarea` com camada espelhada, zero
dependências, que morre na exigência de esconder o `#` (RF-33). Consequências já escritas no PRD, e
não só nesta conversa: a Etapa C remove `apps/web/src/lib/caret.ts` (nenhuma skill ou memória cita o
arquivo) e o caminho de fallback — Etapa C encolhida ao botão de copiar — está fechado.

**Q-01 fechada: a numeração das fases.** Fase 5 é este refino, Google Calendar é a Fase 6, e o
Calendar é hoje o item de **menor prioridade** do roadmap. Já estava aplicada em três lugares
(README, `CLAUDE.md`, estrutura do PRD) e só faltava a questão parar de dizer "confirmar antes".

**A seção "O que falta na Fase 5" do README ensinava a regra errada.** Ela descrevia a Etapa B como
pendente e com a formulação original de RF-18 — "índice de inserção pelo ponto médio do card sob o
ponteiro" —, que é exatamente a regra que oscila e que a entrega de hoje substituiu por contagem
geométrica. Um README que contradiz o próprio topo é ruim; um README que ensina a regra descartada é
pior, porque a próxima leitura a reintroduz achando que simplifica. Reescrita, com a ressalva de
**não verificada à mão** mantida.

Ficou pendente: Q-03 (ordem das etapas) sobrou na lista de questões em aberto e virou letra morta —
a ordem A → B já aconteceu. Não foi mexida por estar fora do pedido.

---

## 2026-08-24 — Fase 5, Etapa B: o arraste do kanban, e o índice que não podia oscilar

Entregue a precisão do arraste. Só `apps/web` mudou; contrato, banco, API e MCP ficaram intactos.
Requisitos em [`old/prd-fase-5-refino.md`](old/prd-fase-5-refino.md) §5.3.

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
[`old/prd-fase-5-refino.md`](old/prd-fase-5-refino.md), um PRD novo que cobre as três etapas da Fase 5.

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
Guia em [`old/proposta-mcp-inicial.md`](old/proposta-mcp-inicial.md).

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
