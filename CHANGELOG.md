# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[semver](https://semver.org/lang/pt-BR/). Os identificadores `RF-xx`, `RN-xx` e `RNF-xx` resolvem
para os PRDs em [`docs/`](docs/).

`CHANGELOG.md` diz **o quê**. As decisões e os porquês ficam em
[`docs/historico.md`](docs/historico.md).

## [Não lançado]

_Nada pendente._

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
