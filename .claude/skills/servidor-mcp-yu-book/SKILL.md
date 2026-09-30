---
name: servidor-mcp-yu-book
description: Decisões de projeto do servidor MCP do Yu-book (apps/mcp) — os dois transportes (stdio e StreamableHTTP) com uma montagem só, de onde vem a identidade em cada um e por que a escrita é liberada por eixos diferentes (URL local no stdio, escopo do token em HTTP), o servidor de autorização OAuth 2.1 próprio sem estado durável, cliente da API e não do banco, orçamento de contexto das tools, resource direto versus template, a formatação que saiu deste pacote para packages/shared e hoje serve também o chat da API, de onde vem o fuso horário do usuário e por que na leitura ele recua e na escrita falha alto, a description como contrato de conversa com o modelo, o origin que toda tool cuja escrita grava marca de IA (de geração ou de conclusão) manda, a rota nova que exige a API no ar antes do MCP e o campo novo que o formatador lê com ?., os anexos de card que aparecem no texto sem URL e não viram tool, log e progresso sem deixar notificação decidir o resultado, e a propagação obrigatória quando o domínio muda. Use antes de criar ou alterar qualquer tool, resource ou prompt, antes de expor qualquer operação que mude dado, antes de tocar em transporte, sessão, autenticação, formatação de texto ou qualquer conversão de data, e sempre que uma feature de apps/api ou packages/shared mudar o domínio.
---

# O servidor MCP do Yu-book

`apps/mcp` expõe o Yu-book como servidor MCP, é sempre cliente HTTP da API — nunca do banco — e
**é deployado** (quarto serviço na Railway, em HTTP): hospedado, essa API é a de **produção**.

Boa parte das decisões aqui é **o contrário do que um exemplo genérico de MCP faria**. Isso é
deliberado. Não "corrija" para o padrão sem ler o porquê.

## 0. Dois transportes, e a diferença é quem é você

Desde a Etapa 4 há **dois**, com uma montagem só: `criarServidor` (`src/servidor.ts`) registra as
mesmas tools, resources e prompts para ambos — dois caminhos de registro divergiriam calados.

| | `stdio` | `http` (StreamableHTTP, com sessão) |
|---|---|---|
| Quantos processos | um por pessoa | um serviço, muitos clientes |
| Quem é você | o dono do processo | quem apresentou o token |
| De onde vem a credencial | `YUBOOK_EMAIL`/`YUBOOK_PASSWORD` no `.env` | OAuth 2.1, do navegador |
| O que libera a escrita | a URL da API ser local | o escopo do token |

**A pergunta que decide quase tudo aqui é "de quem é esta requisição?".** Em stdio ela não existe: o
processo é seu, e a conta no ambiente **é** a identidade. Sob HTTP um processo atende muitos
clientes, e credencial no ambiente seria uma identidade só para todo mundo — por isso o `env.ts`
**recusa subir** em HTTP se `YUBOOK_EMAIL` existir, e o `cliente.ts` recusa de novo a chamada que
chegar sem contexto. Duas trancas para a mesma porta, de propósito.

**A identidade viaja por requisição, em `AsyncLocalStorage`** — aberto em `comErro` e
`comErroDeResource` (`src/erros.ts`), que já envolvem todo handler que existe, e lido em
`src/cliente.ts`. Nenhuma assinatura de tool mudou. Portador guardado na sessão seria o erro:
INV-43 tem o porquê.

**Este servidor emite token; não repassa token de terceiro.** É servidor de autorização completo —
registro dinâmico, PKCE, login e consentimento próprios (`src/auth/`) —, e o token que emite carrega
o `accessToken` da API **cifrado dentro**: corpo de JWT é base64, não cifra, e em claro o cliente
ganharia uma credencial que fala direto com a `apps/api`, contornando todo escopo daqui.

O que custou caro está no catálogo, e se lê antes de tocar em `src/auth/` ou `src/http.ts`:
**cifra igual mais forma compatível não separa nada** (INV-41, um desvio de autenticação real), **os
dois relógios se derivam, não se igualam** (INV-42), o mapa de sessões vaza calado (INV-44) e escopo
que encolhe encerra a sessão (INV-46). O mecanismo do fluxo está em **`referencias/identidade-http.md`**.

## 1. A regra de sobrevivência: stdout é o protocolo

**Em stdio o stdout é o canal JSON-RPC.** Um `console.log` esquecido injeta lixo no meio de uma
mensagem e o cliente desconecta com um erro que não parece ter relação com log. Sob HTTP o stdout é
só stdout — mas **o mesmo código roda nos dois**, então a regra mais restritiva vence: todo
diagnóstico vai para **stderr**, sempre. Assim não há um caminho seguro e outro traiçoeiro.

`src/verificar.ts` é a única exceção legítima: utilitário de linha de comando, fora do servidor.

## 2. Cliente da API, nunca do banco

O servidor fala HTTP com `apps/api` (`src/cliente.ts`). Não importa o Prisma e não importa os
services.

Custa uma requisição a mais e herda de graça: escopo por `userId` vindo só do token, posse por
cadeia no kanban, 404 no lugar de 403, códigos de erro estáveis. Acessar o banco direto exigiria
reimplementar esse escopo fora dos services — e erro ali não dá exceção, vaza dado em silêncio.

Efeito colateral: apontar para outro ambiente é trocar `YUBOOK_API_URL` — no `.env` local, na
variável do serviço quando hospedado —, sem uma linha de código.

Sob HTTP muda só **de quem** é o `Bearer`: `src/auth/sessao-api.ts` faz login, refresh e logout
contra as mesmas rotas do front, com o cookie `yb_refresh` à mão. **A `apps/api` não muda uma linha.**

## 3. Orçamento de contexto

Quem paga a conta de uma resposta grande é a **janela de contexto do modelo**, que é muito menor e
mais cara que a rede.

- **Buscar é barato, ler é caro e explícito.** `search_notes` devolve só trecho; `get_note` devolve
  o corpo, de uma nota, de propósito.
- **A resposta é texto compacto, não JSON.** JSON de vinte resultados gasta cerca de um terço dos
  tokens em chaves e aspas repetidas, sem dizer nada ao modelo.
- **Nada de cap silencioso.** Se a resposta corta uma lista, ela **declara** o total real. Cap
  silencioso faz o modelo concluir que aquilo é tudo o que existe. Ver `TETO_DO_CATALOGO`
  em `src/resources/catalogos.ts`.
- **Medir antes de afirmar.** Número sem medição é chute com aparência de rigor: "~40 bytes por
  nota" virou requisito antes de alguém medir ~100 — o uuid sozinho tem 36 caracteres.

## 4. Tipos: sempre os do SDK

`CallToolResult` e `ReadResourceResult` vêm de `@modelcontextprotocol/sdk/types.js`. **Nunca escreva
o equivalente à mão** — o SDK exige uma assinatura de índice que um tipo caseiro não tem, e o
typecheck recusa com um erro longo e pouco óbvio. Já cometido duas vezes: antes de declarar
interface para o retorno de um handler, procure no SDK.

## 5. As três primitivas — a diferença é quem aciona

| Primitiva | Quem aciona | Onde vive |
|---|---|---|
| Tool | O modelo decide, no meio da resposta | `src/tools/` |
| Resource | O usuário anexa, antes de perguntar (`@`) | `src/resources/` |
| Prompt | O usuário invoca (`/`) | `src/prompts/` |

**Tool e resource sobre o mesmo dado não são duplicação.** `get_board` e `yubook://board/{id}`
devolvem o mesmo texto de propósito: a superfície é que se duplica, nunca a implementação.

**Tool é a única primitiva que escreve**, e a escrita tem regras próprias — §9 a §11. Resource e
prompt não mudam dado, e não passam a mudar. Quarta via, que não é primitiva: a **via de volta**
(log e progresso), em `src/notificacoes.ts` (§11).

## 6. Resource: direto ou template

**Conjunto pequeno e limitado é listável; conteúdo que cresce sem limite não é.**

- **Direto** (`yubook://notas`, `//boards`, `//tags`, `//workspaces`) — devolve **índice**:
  identificador e rótulo. Nunca corpo, nunca trecho, nunca descrição. MIME `application/json`.
- **Template** (`yubook://nota/{id}`, `yubook://board/{id}`) — devolve o conteúdo.
  MIME `text/markdown`.

**O identificador na URI é o uuid, não o título.** Renomear uma nota reescreve os `[[…]]` das outras
notas, mas não há como reescrever uma URI já injetada no contexto de alguém.

O esquema `yubook://` e os campos do catálogo ficam **em português** — não atravessam a API. Nome de
tool fica em **inglês**, como caminho de rota (`search_notes`, `get_board`).

## 7. Uma formatação, e ela não mora mais aqui

Tudo que monta texto de nota, card, quadro ou dashboard vive em
**`packages/shared/src/formato.ts`** desde a Etapa B da IA. Tool, resource e chat chamam a **mesma**
função, e a consequência é que **editar um formatador não é mais uma mudança contida em
`apps/mcp`**: muda também o que o chat da API imprime (§4.6 de `contrato-compartilhado`).
Verificação: ler `yubook://nota/{id}` e chamar `get_note` com o mesmo id devem produzir texto
**idêntico caractere a caractere**.

### 7.1 O dia de um prazo vem do usuário, e o recuo nunca é o processo

Os formatadores que imprimem data — prazo, e desde a Etapa C o dia da marca em `formatarNota` —
**exigem** um `fuso`, sem padrão; quem o obtém é `fusoDoUsuario` (`src/fuso.ts:43`), que pergunta
`GET /ai/settings` — a `ai_preference.timezone` que decide a janela do teto de IA. Ler o fuso do
**processo** (`getMonth()`, `new Date("…T23:59:59")`) acerta por acaso em stdio e erra sempre
hospedado, relatando todo prazo um dia à frente, calado.

**A assimetria é decidida, e você a escolhe ao escrever a tool.** Tool que só **lê** e imprime data
usa `exigir: false` — recuar para `FUSO_PADRAO` custa no máximo uma linha com o dia de outro fuso.
Tool que **escreve** data (`create_card` com `dueDate`) usa `exigir: true`, e busca o fuso **antes**
do POST (`src/tools/kanban-escrita.ts:37-47`): ali o fuso vira o instante gravado no banco, e recuar
gravaria prazo errado em silêncio.

Sem cache, deliberadamente — o argumento e o custo medido estão em `src/fuso.ts:5-31`, e ele
responde pelo nome à proposta de um mapa por credencial. **Não acrescente `TZ` ao
`apps/mcp/railway.json`**: hoje a variável é **inerte** (§4.5 de `contrato-compartilhado`).

## 8. Prompt: instrução, não dado

- **Prompt não busca dado.** Devolve mensagens; quem busca é tool ou resource. Prompt que embute
  dado congela o dado no instante em que foi montado.
- **Prompt declara o que NÃO fazer.** É o que separa instrução testada de frase solta. Sem limites,
  o modelo preenche as lacunas e devolve algo plausível e errado. Ver `src/prompts/revisao.ts`:
  não inventar prazo, não sugerir ação que não existe como tool, não tratar a fila de links como
  urgência.
- A `description` aparece no menu do `/` — descreve **o resultado**, não a implementação.

## 9. Escrita: nasce desligada, e o nome carrega o domínio

Tools que mudam dado vivem em `src/tools/*-escrita.ts`, longe das de leitura: risco diferente.
**Tool cuja escrita grava marca de IA manda `origin`** (`src/autor.ts`) — as que criam e
`complete_card`, esta pela rota própria, a única que o aceita: sem ele, o ato vira humano (INV-58, INV-63).

**O que libera a escrita é outro em cada transporte, e são eixos diferentes de propósito.** Quem
recebe a decisão pronta é `criarServidor({ escrita })` — elas ou são registradas na montagem
ou não existem naquela sessão, e não há como registrá-las no meio. Quem a toma:

- **stdio — a URL da API.** `env.escritaLiberada` é verdadeiro só contra host local, e
  `YUBOOK_ESCRITA_REMOTA=1` destrava a um custo de decisão escrita. Faz sentido ali porque não há
  identidade: o único risco é escrever em produção sem querer.
- **http — o escopo do token**, `yubook:write`, concedido na caixa do consentimento, mais o
  desligamento global `MCP_ESCRITA_HABILITADA`. **A trava por host local não participa deste
  caminho**, e isso não é engano: ali a pergunta é *quem autorizou o quê*, não *contra qual banco*.
  `OpcoesDoServidor`, em `src/servidor.ts`, documenta a decisão no código.

Os dois vão para o stderr no boot, em mensagens que ramificam por transporte (`src/index.ts`).
**Tool de escrita recém-criada que não aparece no `tools/list` quase sempre é uma das duas travas.**

**A trava tem duas camadas, e tool nova entra nas duas**: o módulo condicional, que é o que o
cliente enxerga, e `comErroDeEscrita` (`src/erros.ts:134`), que repergunta no ponto da chamada e
vale nos **dois** transportes. O argumento está no cabeçalho de `src/autorizacao.ts` (INV-45).

**Nome de tool não inventa estado que a tabela não tem.** O domínio tem duas remoções com nomes
diferentes: card se **arquiva** (`archived`, sai do quadro, renumera a coluna — INV-13); nota vai
para a **lixeira** (`deletedAt`). Não existe "arquivar nota", e por isso não existe `archive_note`.
`delete_note` foi recusado por dois motivos independentes — argumento inteiro na entrada de
2026-08-26 de `docs/historico.md`.

**Dois critérios decidem o que não vira tool**, e valem para a próxima também: operação
**irreversível** fica no aplicativo, com um humano confirmando (excluir card, excluir nota em
definitivo); **estrutura** é escolha de dono, não de conversa (criar quadro, coluna ou workspace).
Editar nota ou card é outro problema, não o mesmo maior: concorre com o autosave do front. O
inventário e as consequências assumidas estão em `apps/mcp/README.md` (§"O que deliberadamente não
vira tool").

**Nem amostragem (*sampling*) nem raízes (*roots*)**: quem chega pelo MCP já traz modelo, e este
servidor não abre arquivo. Não as implemente sem reler o argumento em `apps/mcp/README.md`.

## 10. A `description` de uma tool de escrita é contrato de conversa

Ela não descreve a função: ela **fecha as portas por onde o modelo inventa**. Numa tool de leitura,
descrição fraca custa uma chamada inútil; numa de escrita, custa dado errado no segundo cérebro.

- **Declare o que a tool NÃO faz.** É a mesma regra da §8 para prompts, e aqui pesa mais.
  `create_card` precisa dizer que não cria coluna, quadro nem checklist — senão o modelo tenta.
- **Declare o que parece erro e não é.** Precedente: `move_card` teve de ensinar que número maior
  que a coluna é **ajustado para o fim, não recusado** (INV-11). Sem isso o modelo lê o sucesso
  como falha e tenta de novo com outro número.
- **Separe o que o desfazer desfaz do que não desfaz, e não junte os dois numa frase.** Juntar foi
  o que produziu uma afirmação errada em `trash_note` e obrigou a corrigi-la: os `[[…]]` **voltam**
  ao restaurar, o vínculo dos cards **não** (INV-19). Some a isso que o título fica livre enquanto
  a nota está na lixeira, então a volta pode falhar por duplicata (INV-16).
- **Diga de onde vem cada id.** `columnId` só existe na saída de `get_board` (INV-40).
- **Preencha `annotations`** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).
  São dica para o cliente, não garantia: `destructiveHint: true` só em `trash_note`.

**O contrapeso: não descreva o que o modelo não pode agir.** A `description` é cobrada em **todo
turno**, não por chamada. Transformação silenciosa que o modelo não tem como evitar sai do texto —
a normalização de tags do servidor (minúsculas, corte em 24, fusão de repetidas) saiu por isso
(`packages/shared/src/ferramentas.ts:190`). O critério é a pergunta: *sabendo disto, o modelo faria
algo diferente?* Se não, é custo puro. Vale o §3: **meça o `tools/list`**, não estime.

## 11. A via de volta: log e progresso

Tudo em `src/notificacoes.ts`; nenhuma tool emite notificação à mão. **REGRA QUE NÃO SE QUEBRA:
notificação nunca decide o resultado de uma tool** — toda emissão vive em `try/catch`
(`:57,71,89`). Essa e as outras decisões da via de volta estão argumentadas no cabeçalho daquele
arquivo (`:9-46`): leia-as lá, não são repetidas aqui.

O que **não** está no código e custa caro descobrir:

- **A capability `logging` se declara no construtor do `McpServer`** (`src/servidor.ts:51`) — outro
  arquivo. Sem ela `sendLoggingMessage` não lança nem avisa: só não faz nada, e o log das escritas
  some calado. Declarar depois não adianta: o handler de `logging/setLevel` só é registrado ali.
- **Log sempre por `server.server.sendLoggingMessage`, nunca por `extra.sendNotification` com
  `notifications/message`** — a segunda **lança** sem a capability. Numa tool de escrita, a
  diferença é entre um log perdido e uma escrita relatada como falha.
- **Passo só conta quando é trabalho real.** `trash_note` tem dois porque lê a nota antes de apagar;
  não registra nenhum quando sai cedo por a nota já estar na lixeira.

## 12. Erro é texto que o modelo vai tentar contornar

Toda falha passa por `comErro` ou `comErroDeResource` (`src/erros.ts`), que traduz o código estável
da API em instrução acionável. Ramifica-se por `code`, nunca por `message`. **A tradução genérica
supõe quem escolheu o valor**: `TITULO_DUPLICADO` manda renomear a *outra* nota, certo em
`restore_note`; em `create_note` o título é do modelo, e a tool intercepta (`notas-escrita.ts:55`).

Resource **lança** em vez de devolver `isError` — o cliente precisa distinguir "não encontrei" de
"aqui está, e está vazio".

## 13. Tolerar uma API mais velha que o contrato

O servidor MCP e a API têm **ciclos de deploy independentes** — dois serviços, dois Watch Paths —,
então o MCP fala com uma API que pode ser semanas mais velha que o contrato que ele compilou. Campo
novo ausente na resposta é **omitido**, não emitido como `undefined` (`src/resources/catalogos.ts`).
**O formatador de `shared` também tolera, e ali pesa mais:** roda **depois** da escrita, e lançar
diria ao modelo que falhou um card já criado — ele criaria outro. Campo array novo se lê com `?.`
apesar do tipo (`files`, `packages/shared/src/formato.ts:344-347`).
**Rota nova não se tolera:** rota inexistente volta `NOT_FOUND` (`apps/api/src/app.ts:98-99`) e o
modelo ouve "não existe esse id". Tool em rota nova (`complete_card`) exige a API no ar antes.

## 14. Propagação — o que fazer quando o domínio muda

**Este é o motivo pelo qual existe um agente para este pacote.** Mudança de domínio em `apps/api` ou
`packages/shared` não quebra o MCP: ela o deixa **desatualizado em silêncio**. Nenhum teste falha,
nenhum typecheck reclama — a tool simplesmente para de contar a verdade inteira.

Diante de um campo, entidade ou filtro novo no domínio, percorra:

- [ ] **`packages/shared/src/formato.ts`** — o campo novo deve aparecer no texto de nota, card,
      quadro ou dashboard? Não é mais arquivo deste pacote: o chat da API imprime o mesmo (§7).
- [ ] **Tools** — alguma tool deveria aceitá-lo como filtro? Alguma deveria devolvê-lo?
- [ ] **Resources diretos** — o campo pertence ao **índice** (identifica ou rotula) ou ao conteúdo?
      Se for conteúdo, **não entra** no catálogo. **Template novo?** Só se for conjunto que cresce
      sem limite e tiver endereço próprio.
- [ ] **Prompts** — algum fluxo existente fica melhor, ou pior, com o campo novo?
- [ ] **Orçamento** — o item ficou mais caro? Meça, não estime (§3).
- [ ] **Tools de escrita** — a mudança altera o que alguma **faz** ou **deixa de fazer**? A
      `description` mente até ser reescrita (§10), nas duas superfícies (§4.6 do contrato).
- [ ] **`annotations`** — o risco da operação mudou? `destructiveHint` acompanha o domínio.
- [ ] **Log e progresso** — passo real novo, ou passo que deixou de existir? (§11)
- [ ] **Transporte** — a mudança vale nos dois? Regra que dependa de **quem** está chamando só tem
      resposta em HTTP; em stdio há uma conta só. Escopo novo entra no consentimento (§0).
- [ ] **`src/verificar.ts`** — vale reportar no diagnóstico?

Se a resposta for "nada muda", **diga isso explicitamente**. Silêncio é indistinguível de
esquecimento. **As funções da frente de IA — chat, agentes, rotinas, `open_page` — não viram tool**
(NO3, RF-53, RF-62 e RF-74 do PRD de IA): quem usa o MCP já traz o próprio modelo. O que propaga é o **dado** que gravam —
a marca, com agente e rotina, chega às tools por `formato.ts`; o `runId` não é impresso. **Anexo
também não vira tool:** a face conta, o detalhe dá nome, tipo e tamanho, **nunca a URL** — assinada,
vence em 1 h (`formato.ts:354-368`) —, e a `descricao` de `get_board` cresceu com isso (§4.6 do contrato).

## 15. Como verificar

`pnpm --filter @yu-book/mcp test` é o **quarto portão** e não precisa de banco nem de API no ar:
pelo arnês em memória (`tests/arnes.ts`) fala JSON-RPC e, com o `fetch` dublado, executa a
formatação. Sem portão: o **texto** das `description` e o tamanho do `tools/list` (§4.6 de
`contrato-compartilhado`). Cobertura, comandos e ambiente em **`referencias/verificacao.md`**.
