# PRD — Servidor MCP do Yu-book: Resources e Prompts

**Versão:** v0.2 · **Status:** executado · **Autor:** yjdutra · **Data:** 2026-08-22

> Etapas 2 e 4 da [proposta de MCP](proposta-mcp-inicial.md). A Etapa 1 (tools de leitura
> sobre stdio) foi entregue na versão 0.2.0 e está verificada contra produção. Este PRD fecha as
> **três primitivas do protocolo** e conclui o programático do curso de introdução.

---

## 1. Contexto e problema

O servidor MCP do Yu-book expõe hoje quatro tools de leitura. Isso já é útil, mas exercita **uma**
das três primitivas do protocolo — e é justamente a primitiva que qualquer tutorial cobre. Terminar
aqui significa sair do curso sabendo escrever tool e sem ter tomado nenhuma das decisões que
separam quem entendeu o protocolo de quem decorou a sintaxe.

As outras duas primitivas existem porque **quem aciona muda**, e isso muda o que faz sentido expor:

| Primitiva | Quem aciona | Superfície no cliente |
|---|---|---|
| Tool | O modelo decide, no meio da resposta | invisível para o usuário |
| Resource | O usuário anexa, antes de perguntar | o menu do `@` |
| Prompt | O usuário invoca | o menu do `/` |

A consequência prática: uma tool gasta um turno do modelo para buscar dado que o usuário **já sabia**
que queria. Perguntar "o que tem na nota sobre JWT?" hoje custa uma decisão do modelo, uma chamada e
uma volta. Como resource, o conteúdo entra no contexto **antes** da pergunta, e a resposta é imediata.

E um prompt resolve um problema diferente dos dois: o usuário consegue pedir "revise minha semana"
sozinho, e recebe algo mediano. Um prompt escrito e testado por quem conhece o domínio entrega o
mesmo pedido com o recorte certo — quais prazos importam, o que "a semana" significa neste app, o
que ignorar. É conhecimento de domínio empacotado, não instrução genérica.

Este PRD altera código de aplicação apenas para **expor propriedades que a tabela já tem** —
nenhuma migration, nenhuma coluna nova. Ver seção 5.5.

---

## 2. Objetivos

- **O1** — O servidor MCP expõe as três primitivas do protocolo: tools, resources e prompts.
- **O2** — Mencionar uma nota com `@` injeta o conteúdo dela no contexto sem que o modelo gaste um
  turno chamando tool.
- **O3** — O catálogo de notas continua barato de listar quando o acervo crescer de 16 para 500.
- **O4** — Existem dois fluxos de trabalho do Yu-book empacotados como prompt, invocáveis por `/`.
- **O5** — Tool e resource que expõem o mesmo dado compartilham **uma** implementação de formatação.

### 2.1 Métricas de sucesso

- **M1** — Resources diretos: **0 hoje → 4**, listados por `resources/list`.
- **M2** — Resource templates: **0 hoje → 2**, listados por `resources/templates/list`.
- **M3** — Prompts: **0 hoje → 2**, listados por `prompts/list`.
- **M4** — Tamanho de `yubook://notas`: **≤ 20 KB em qualquer acervo**, garantido pelo teto de 200
  itens. Medido sobre a resposta real: 16 notas = 1573 B (98 B/nota); no teto, ~19,2 KB.
- **M5** — Tools: **4 hoje → 5** (entra `get_dashboard`, que os prompts consomem).
- **M6** — Duplicação de formatação entre tool e resource: **zero**. Verificável por inspeção de
  `apps/mcp/src/formato.ts` ser o único lugar que monta texto de nota e de quadro.

---

## 3. Não-objetivos

- **NO1** — Não implementar tools de escrita (`create_card`, `move_card`, `archive_note`). É a
  Etapa 3, e vem depois do Advanced Topics.
- **NO2** — Não implementar transporte HTTP nem autenticação por fluxo de autorização. O transporte
  segue stdio e o login segue por credencial no `.env`.
- **NO3** — Não implementar a Etapa 5 (composição com o conector do GitHub).
- ~~**NO4**~~ — **Revogado em 2026-08-22, a pedido do operador.** Propriedades novas nos contratos
  são permitidas quando viabilizam ou otimizam os serviços. Ver RF-23 e RF-24.
- **NO5** — Não escrever um cliente MCP próprio. O cliente é o Claude Code; a lesson 05 e a 09
  servem para entender o que ele faz, não para reimplementá-lo.
- **NO6** — Não publicar o servidor como pacote npm nem distribuí-lo para terceiros.
- **NO7** — Não expor links (`apps/api` módulo `links`) como resource nesta etapa. A gaveta é uma
  fila de consumo, não material de contexto.

---

## 4. Personas e usuários-alvo

**Yuri (usuário único).** Usa o Claude Code com o servidor conectado por stdio, contra a API de
produção. Acervo atual: 16 notas ativas (8 aula, 6 trabalho, 1 projeto, 1 trilha), 3 na lixeira.

**O modelo (consumidor indireto).** Recebe resources já injetados no contexto e prompts já
montados. Não decide chamar nada quando o usuário usa `@` ou `/`.

---

## 5. Requisitos funcionais

### 5.1 Resources diretos — os conjuntos pequenos e limitados

- **RF-01** — `yubook://notas` devolve o **catálogo** de notas ativas: `id`, `titulo`, `tipo`,
  `workspace` e `atualizadaEm`. **Não devolve corpo nem trecho.** MIME `application/json`.
- **RF-02** — `yubook://boards` devolve os quadros: `id`, `nome`, `workspace`, `colunas` e `cards`
  (contagens). MIME `application/json`.
- **RF-03** — `yubook://tags` devolve as tags com a contagem de notas de cada uma. MIME
  `application/json`.
- **RF-04** — `yubook://workspaces` devolve os workspaces com as contagens de notas, boards e cards.
  MIME `application/json`.
- **RF-05** — Nenhum resource direto devolve conteúdo de nota, descrição de card ou corpo de
  qualquer tipo. Eles são **índices**, não conteúdo.
- **RF-06** — Notas na lixeira não aparecem em `yubook://notas`.

### 5.2 Resource templates — o conteúdo, sob demanda

- **RF-07** — `yubook://nota/{id}` devolve a nota completa: título, metadados, tags, corpo em
  Markdown, notas que a referenciam e cards vinculados. MIME `text/markdown`.
- **RF-08** — `yubook://board/{id}` devolve o quadro: colunas na ordem, com a face dos cards.
  MIME `text/markdown`.
- **RF-09** — O identificador na URI é o **uuid**, não o título. Renomear uma nota não invalida uma
  URI já injetada em algum contexto.
- **RF-10** — URI com id inexistente ou de outra conta devolve erro de resource não encontrado, com
  a mesma mensagem acionável que as tools já produzem.

### 5.3 Tool nova

- **RF-11** — `get_dashboard(workspaceId?)` devolve o agregado da tela inicial: prazos vencidos,
  prazos da semana, notas recentes e o tamanho da fila de links. Uma requisição à API.
- **RF-12** — `get_dashboard` é a fonte dos prompts. Nenhum prompt monta esse recorte por conta.

### 5.4 Prompts

- **RF-13** — `revisao_semanal(workspace?)` devolve mensagens que instruem o modelo a chamar
  `get_dashboard`, e depois a produzir, nesta ordem: **o que já venceu**, **o que vence nos próximos
  7 dias**, **o que foi editado recentemente** e **uma recomendação de por onde começar**.
- **RF-14** — `revisao_semanal` declara explicitamente o que **não** deve fazer: não inventar prazo
  que não veio do dashboard, não sugerir criar nem mover card (não há tool de escrita), e não tratar
  a fila de links como urgente — nada nela expira.
- **RF-15** — `retomar_contexto(assunto)` devolve mensagens que instruem o modelo a chamar
  `search_notes` com o assunto, escolher o resultado mais relevante, ler com `get_note`, e então
  reconstruir o contexto **seguindo o grafo**: as notas que a referenciam e os cards vinculados.
- **RF-16** — `retomar_contexto` instrui o modelo a citar o `id` de cada nota que mencionar, para
  que o usuário consiga abrir ou anexar a nota depois.
- **RF-17** — Todo prompt tem `name`, `description` e argumentos com descrição — a `description` é o
  que aparece no menu do `/`, então descreve **o resultado**, não a implementação.
- **RF-18** — Nenhum prompt embute conteúdo de nota nas mensagens. Prompt é instrução; o conteúdo
  vem de tool ou de resource, e quem decide é o modelo ou o usuário.

### 5.5 Propriedades novas nos contratos

- **RF-23** — `CardSummary` ganha `updatedAt`. A coluna `updated_at` **já existe** na tabela `card`
  (`@updatedAt` no schema) — não há migration, só exposição. Viabiliza responder "o que está
  parado" sobre o quadro inteiro, que hoje exigiria uma requisição por card.
- **RF-24** — `GET /notes/titles` passa a devolver `NoteTitle`, com `workspaceName` e `updatedAt`
  além de id, título e tipo. É a fonte do catálogo `yubook://notas` e do autocomplete de `[[…]]` —
  os dois querem a mesma coisa, um índice barato.
- **RF-25** — Nenhuma migration é criada. Se uma propriedade nova exigir coluna nova, ela vira
  questão em aberto em vez de migration silenciosa: `prisma migrate deploy` roda no boot de
  produção.
- **RF-26** — O servidor MCP tolera uma API **mais velha que o contrato compilado**: campo ausente
  na resposta é omitido, não emitido como `undefined`. Servidor MCP e API têm ciclos de deploy
  independentes.

### 5.6 Implementação

- **RF-19** — Resource e tool que expõem o mesmo dado chamam a **mesma** função de formatação em
  `apps/mcp/src/formato.ts`. `yubook://nota/{id}` e `get_note` produzem texto idêntico.
- **RF-20** — Resources e prompts ficam em `apps/mcp/src/resources/` e `apps/mcp/src/prompts/`,
  seguindo a organização por assunto que `src/tools/` já usa.
- **RF-21** — Todo handler de resource e de prompt é envolvido pela tradução de erro que as tools já
  usam (`comErro` em `src/erros.ts`), para que falha de rede ou de autenticação vire mensagem
  acionável e não exceção crua.
- **RF-22** — Nome de resource, de prompt e de argumento é fronteira, como caminho de rota — mas o
  esquema `yubook://` e os campos do catálogo ficam **em português**, porque não atravessam a API e
  são lidos por quem usa o app. `search_notes` continua em inglês; `yubook://notas` fica em português.

---

## 6. Requisitos não-funcionais

- **RNF-01 Orçamento de contexto** — `yubook://notas` custa no máximo **110 bytes por nota** e é
  limitado a **200 notas**, o que mantém o catálogo abaixo de **20 KB** em qualquer acervo.
  Quando o teto corta, a resposta **declara** o total real — cap silencioso faz o modelo concluir
  que o acervo é só aquilo.

  > **Corrigido na v0.2.** A v0.1 dizia 40 bytes por nota, o que é impossível: o uuid sozinho tem
  > 36 caracteres. Medição real com 16 notas: 98 B/nota. O teto por quantidade substitui o teto
  > por acervo que a v0.1 supunha desnecessário.
- **RNF-02 Uma requisição por resource direto** — cada catálogo resolve com uma chamada à API. Nada
  de N+1.
- **RNF-03 Sem caractere de controle** — nenhum conteúdo devolvido contém `U+0001` ou `U+0002`
  (INV-10). Vale para resource como já vale para tool.
- **RNF-04 stdout é do protocolo** — nenhum código novo escreve em stdout. Diagnóstico em stderr.
- **RNF-05 Não-regressão** — As 5 suítes de integração de `apps/api` continuam passando (47 casos),
  e `pnpm typecheck` passa nos quatro pacotes. Substitui o diff vazio, que o NO4 revogado exigia.
- **RNF-06 Idioma** — código, comentário e descrição em português, conforme `convencoes-yu-book`.

---

## 7. Modelo de dados

Nenhuma entidade nova. O que este PRD define é o **espaço de endereçamento**:

| URI | Tipo | MIME | Origem na API |
|---|---|---|---|
| `yubook://notas` | direto | `application/json` | `GET /notes` (paginado até o fim) |
| `yubook://boards` | direto | `application/json` | `GET /boards` |
| `yubook://tags` | direto | `application/json` | `GET /tags` |
| `yubook://workspaces` | direto | `application/json` | `GET /workspaces` |
| `yubook://nota/{id}` | template | `text/markdown` | `GET /notes/:id` |
| `yubook://board/{id}` | template | `text/markdown` | `GET /boards/:id` |

**A regra que organiza a tabela:** conjunto pequeno e limitado vira resource **direto** (listável);
conteúdo que cresce sem limite vira **template**. Workspaces, boards e tags são inerentemente poucos.
Notas não são — por isso o catálogo lista identificadores e o corpo fica atrás de um template.

---

## 8. Fluxos principais

**Fluxo A — Perguntar sobre uma nota específica**
1. O usuário digita `@` no cliente.
2. O cliente lê `yubook://notas` e mostra os títulos.
3. O usuário escolhe uma; o cliente lê `yubook://nota/{id}`.
4. O conteúdo entra no contexto **antes** da pergunta. O modelo responde sem chamar tool.

**Fluxo B — Descobrir e então ler**
1. O usuário não sabe qual nota quer e pergunta em linguagem natural.
2. O modelo decide chamar `search_notes` e recebe trechos.
3. Se precisar do corpo, chama `get_note` com o id.
4. Mesmo caminho da Etapa 1 — o resource não o substitui, cobre o outro caso.

**Fluxo C — Revisão semanal**
1. O usuário invoca `/revisao_semanal`.
2. O servidor devolve as mensagens já montadas.
3. O modelo chama `get_dashboard` e produz o recorte na ordem definida em RF-13.

**Fluxo D — Retomar um assunto**
1. O usuário invoca `/retomar_contexto` com um assunto.
2. O modelo busca, lê a nota mais relevante e segue o grafo de backlinks e cards.
3. Devolve o estado do assunto, citando os ids.

---

## 9. Regras de negócio

- **RN-01 Índice não carrega conteúdo.** Resource direto devolve identificador e rótulo. Corpo,
  descrição e trecho só saem por template ou por tool. É a mesma regra que fez `GET /notes`
  truncar no banco, aplicada ao endereçamento.
- **RN-02 Identidade é o uuid.** Título muda; id não. Um `[[wikilink]]` quebrado a aplicação
  conserta reescrevendo o texto das outras notas — uma URI já injetada no contexto de alguém não
  tem conserto.
- **RN-03 Uma formatação, duas superfícies.** O mesmo dado exposto como tool e como resource é
  formatado por uma função só. Duas implementações divergem, e a divergência aparece como o mesmo
  recurso com duas caras.
- **RN-04 Prompt não busca dado.** Prompt devolve mensagens. Quem busca é tool ou resource. Um
  prompt que embute dado congela o dado no momento em que foi montado.
- **RN-05 Prompt declara o que não fazer.** Instrução de domínio inclui os limites — o que ignorar,
  o que não inventar, o que não sugerir. É o que separa um prompt testado de uma frase.
- **RN-06 Escopo do usuário vale igual.** Resource obedece ao mesmo escopo por `userId` das tools,
  porque atravessa a mesma API. Id de outra conta é indistinguível de id inexistente.

---

## 10. Critérios de aceitação

- **CA-01** (RF-01…04, M1) — Dado o servidor conectado, quando o cliente envia `resources/list`,
  então os quatro resources diretos aparecem, cada um com `uri`, `name` e `mimeType`.
- **CA-02** (RF-07, RF-08, M2) — Dado `resources/templates/list`, então `yubook://nota/{id}` e
  `yubook://board/{id}` aparecem como templates.
- **CA-03** (RF-01, RF-05, RNF-01, M4) — Dado `resources/read` de `yubook://notas`, então a resposta
  é JSON válido, contém as 16 notas ativas, **nenhuma** com campo de corpo ou trecho, e pesa ≤ 2 KB.
- **CA-04** (RF-06) — Dado que existem 3 notas na lixeira, quando se lê `yubook://notas`, então
  nenhuma delas aparece.
- **CA-05** (RF-19, M6) — Dado um id de nota, quando se lê `yubook://nota/{id}` e se chama
  `get_note` com o mesmo id, então o texto devolvido é idêntico caractere a caractere.
- **CA-06** (RF-10, RN-06) — Dado um uuid válido e inexistente, quando se lê `yubook://nota/{id}`,
  então a resposta é erro com mensagem que instrui a confirmar o id, e não uma exceção crua.
- **CA-07** (RF-13, M3) — Dado `prompts/list`, então `revisao_semanal` e `retomar_contexto` aparecem
  com descrição e argumentos descritos.
- **CA-08** (RF-13) — Dado `prompts/get` de `revisao_semanal` com um workspace, então as mensagens
  devolvidas citam `get_dashboard` e enumeram as quatro seções na ordem, e o argumento aparece
  interpolado.
- **CA-09** (RF-14, RN-05) — Dadas as mensagens de `revisao_semanal`, então elas contêm instrução
  explícita de não sugerir criação ou movimentação de card.
- **CA-10** (RNF-03) — Dado o texto de qualquer resource, quando se procura por `U+0001` ou
  `U+0002`, então não há ocorrência.
- **CA-11** (RNF-04) — Dado o servidor rodando por stdio, quando se lê o stdout do processo, então
  toda linha é JSON-RPC válido.
- **CA-12** (RNF-05) — Ao fim da execução, `git diff --stat -- apps/api apps/web packages` é vazio.

---

## 11. Dependências, restrições e riscos

### Dependências
- API do Yu-book no ar. O ambiente é definido por `YUBOOK_API_URL`; hoje aponta para produção.
- `@modelcontextprotocol/sdk` 1.30, já instalado.
- Nenhuma dependência nova.

### Restrições técnicas
- `GET /notes` é paginado por cursor, com no máximo 100 por página. O catálogo precisa percorrer as
  páginas para ficar completo — e isso é o que RNF-02 limita a um custo aceitável.
- `CardSummary` não expõe `updatedAt`, o que impede calcular "card parado" sem uma requisição por
  card. Resolvido por RF-23.
- O cliente decide como apresentar resources e prompts. O Claude Code pode não expor exatamente o
  menu de `@` e `/` descrito nas lessons 06 e 09; o protocolo é o mesmo, a apresentação varia.

### Riscos

| Risco | Mitigação |
|---|---|
| **O catálogo cresce com o acervo** e um dia estoura o contexto | Teto de 200 itens, com o total real declarado quando corta. Filtro no catálogo fica para quando o teto incomodar |
| **Tool e resource divergem** ao expor a mesma nota | RN-03 e CA-05, que compara os dois textos caractere a caractere |
| **Prompt vira frase genérica** e não se paga | RN-05 obriga declarar limites; CA-09 verifica |
| **O cliente não mostra `@` como nas aulas** e parece que não funcionou | O Inspector lista resources e templates independentemente do cliente — é onde se verifica primeiro |
| **Paginação silenciosamente truncada** faz o catálogo mentir | CA-03 confere a contagem contra o total conhecido |

---

## 12. Entregas e fases

**Onda 1 — resources diretos.** Os quatro catálogos e a leitura por `resources/list`. É o que faz o
`@` funcionar.

**Onda 2 — resource templates.** `yubook://nota/{id}` e `yubook://board/{id}`, reaproveitando
`formato.ts`. Fecha a Etapa 2.

**Onda 3 — `get_dashboard` e prompts.** A tool que os prompts consomem, e depois `revisao_semanal` e
`retomar_contexto`. Fecha a Etapa 4.

**Onda 4 — verificação.** Handshake por stdio conferindo `resources/list`,
`resources/templates/list` e `prompts/list`; medição de CA-03; comparação de CA-05; e o `verificar`
estendido para reportar o tamanho do catálogo.

---

## 13. Questões em aberto

- ~~**Q-01**~~ — **Resolvida em 2026-08-22.** `updatedAt` entrou no `CardSummary` (RF-23). A coluna
  já existia na tabela; foi só expor.
- **Q-04** — `revisao_semanal` ainda não usa "cards parados", porque `GET /dashboard` não devolve
  essa informação — o dado agora existe no `CardSummary`, mas o dashboard não o consome. Ampliar o
  dashboard ou o prompt varrer os quadros? Impacto: mais uma alteração em `apps/api`, ou N
  requisições no prompt. Responsável: operador.
- **Q-05** — A API em produção é mais velha que o contrato: `workspace` e `atualizadaEm` não
  aparecem no catálogo até haver deploy. Publicar agora ou acumular com a Etapa 3? Responsável:
  operador.
- **Q-02** — O catálogo de notas deve incluir as tags de cada nota? Encareceria o item mas
  permitiria filtrar no menu do `@` sem ler nada. Impacto: RNF-01. Responsável: operador, depois de
  usar o `@` por alguns dias.
- **Q-03** — Um terceiro prompt, `conectar_notas`, que encontra notas que deveriam estar ligadas por
  `[[…]]` e não estão? É o que melhor explora o grafo de wikilinks, mas sem tool de escrita ele só
  sugere. Responsável: operador.

---

## 14. Suposições assumidas

- **S-01** — O Claude Code expõe resources e prompts ao usuário de alguma forma equivalente ao `@` e
  ao `/` das lessons 06 e 09. Justificativa: são primitivas do protocolo e o cliente as anuncia; a
  apresentação exata é decisão dele. Se a apresentação diferir, o valor entregue não muda — muda o
  caminho para acioná-lo.
- **S-02** — 500 notas é o horizonte de projeto para o custo do catálogo. Justificativa: o acervo
  hoje tem 16 e cresce por aula assistida; 500 é ordem de grandeza de alguns anos de uso, e é o
  número que a própria proposta usa ao discutir a decisão.
- **S-03** — Expor board como resource **e** como tool não é duplicação indevida. Justificativa: a
  diferença entre as duas primitivas é quem aciona, não o dado — e demonstrar isso sobre o mesmo
  dado é justamente o que torna a distinção concreta.
