# Plano — A Anthropic como segundo provedor de IA

Pedido de 2026-10-21. O plano do Claude inclui créditos mensais de API; o Yu-book passa a poder
gastá-los chamando a API da Anthropic direto (platform.claude.com), ao lado do OpenRouter. Ciclo de
sempre: plano da fase → desenvolver → testes pontuais → próxima fase; teste geral no fim.

## Decisões tomadas antes de começar

- **Só a API da Anthropic, por chave do Console.** Os créditos resgatados caem numa organização do
  Console; de lá sai uma chave `sk-ant-…` que vai na env opcional `ANTHROPIC_API_KEY`. Sem ela,
  nada muda (RNF-03). O login da assinatura do claude.ai **não** entra: o token dela não pode
  alimentar app de terceiro, e a API não expõe Projetos nem memória. A rota de "chave própria
  dentro do OpenRouter" também ficou de fora.
- **O provedor segue o modelo.** Cada favorito é de um provedor (`anthropic` ou `openrouter`); a
  tarefa, o agente e o passo de rotina usam o provedor do modelo escolhido. Dá para misturar —
  chat na Anthropic, formatar no OpenRouter. O ponto único da escolha continua sendo
  `modeloPorId` (Etapa D); quem despacha é o passo, pelo `provider` do favorito.
- **Anthropic é o padrão na tela; OpenRouter vira opção com aviso.** O catálogo de Ajustes →
  Modelos abre na Anthropic; escolher um modelo do OpenRouter para uma tarefa ou agente mostra o
  aviso de que aquele gasto sai da conta do OpenRouter, não dos créditos do Claude.
- **SDK oficial, não shim.** `@anthropic-ai/sdk` em `apps/api`, com `baseURL` vinda de
  `ANTHROPIC_BASE_URL` para o dublê de teste. Nada de endpoint "compatível com OpenAI".
- **O formato interno das mensagens não muda.** `MensagemDoProvedor` (forma OpenAI) segue sendo a
  língua do chat, da rotina e do histórico gravado; o adaptador converte na borda — `system` no
  parâmetro próprio, `tool_calls` em blocos `tool_use`, mensagens `tool` seguidas num só `user`
  com blocos `tool_result`.
- **Pensamento só dentro do laço.** Os modelos atuais pensam sempre; os blocos `thinking` voltam
  intactos **dentro** do laço de uma mensagem (o passo devolve o conteúdo nativo e o laço o
  reenvia) e são descartados do histórico gravado. Tirar todos os blocos é forma válida para a
  API; reenviar só uma parte, editada, é o que ela recusa.
- **Custo por tabela, com cache.** A Anthropic devolve tokens, não dólares: o custo é `estimado`
  por uma tabela de preços em `packages/shared` (entrada, saída, leitura e escrita de cache),
  conferida contra a tabela publicada. Modelo sem preço na tabela não entra no catálogo — mesma
  regra do OpenRouter: sem preço, o teto mentiria. O teto diário (INV-47/48) vale para os dois.
- **Busca na web nativa.** Agente com pesquisa ligada, num modelo da Anthropic, usa a ferramenta
  de servidor `web_search` no lugar do plugin do OpenRouter. `open_page` não muda (INV-08).
- **Tela de custo própria.** `/ajustes/claude`: o que o Yu-book gastou na Anthropic, de
  `ai_usage` filtrado por provedor — por dia, modelo e tarefa, com o efeito do cache. O custo
  segundo a própria Anthropic (Admin API) é opcional, atrás de `ANTHROPIC_ADMIN_KEY`, como a
  management key do OpenRouter.

## Fases

| Fase | Entrega | Pacotes |
|---|---|---|
| F1 | Fundação: env e SDK, coluna `provider` em favorito e uso, tokens de cache, tabela de preços, catálogo da Anthropic, favoritar e saúde por provedor | shared, api |
| F2 | Inferência: adaptador da Anthropic (fluxo, ferramentas, pensamento, recusa, erros), despacho no passo e no formatar, busca nativa, custo com cache, dublê de teste | api |
| F3 | Ajustes: catálogo com seletor de provedor (Anthropic padrão), selo de provedor, aviso ao escolher OpenRouter no quadro e no editor de agente | web |
| F4 | Tela de custo do Claude em `/ajustes/claude`: relatório por provedor, cache, e o bloco opcional da Admin API | shared, api, web |
| Final | Teste geral: portões, suítes da API e do MCP, telas no navegador | todos |

Cada fase fecha com `pnpm --filter @yu-book/shared build`, `pnpm typecheck` e, quando toca a API,
os testes da área. O plano técnico de cada fase fica nesta página, na seção dela, quando começa.

## Fora desta frente

- Créditos e saldo da conta: a API pública não tem leitura de saldo de créditos. A tela mostra o
  gasto, não o saldo.
- Recaída automática de um provedor para o outro: crédito acabado recusa com aviso, como o teto.
- `apps/mcp`: é cliente da API e não conhece provedor. Conferir só que nada muda.

## F1 — Fundação

**Objetivo:** o servidor conhece a Anthropic como provedor — lista os modelos dela com preço,
deixa favoritá-los e diz se a chave responde —, sem ainda gerar texto por ela.

- **shared:** `AI_PROVIDERS = ["openrouter", "anthropic"]` em `enums.ts`. `provider` em `AiModel`,
  `AiFavorite` e `AiHealth`. `provider` opcional (padrão `openrouter`, compatível com o web de
  hoje) em `listAiModelsQuerySchema` e `aiFavoriteInputSchema`. `anthropic.ts` novo com
  `PRECOS_ANTHROPIC` (µUSD por milhão: entrada, saída, escrita de cache 5 min, leitura de cache;
  Haiku 5.5 com a faixa acima de 100 mil tokens) e `CUSTO_BUSCA_ANTHROPIC_MICROS` (US$ 10 por mil
  buscas). Tabela copiada da página oficial de preços em 2026-10-21.
- **banco:** enum `AiProvider`; `provider` em `ai_model_favorite` e `ai_usage` (padrão
  `openrouter`, então o que já existe fica certo sem backfill); `cache_read_tokens` e
  `cache_write_tokens` em `ai_usage`; índice `(user_id, provider, local_day)` para a tela da F4.
  O único `(user_id, model_id)` fica: ids da Anthropic não têm barra e não colidem com slugs.
- **api:** envs `ANTHROPIC_API_KEY` (opcional) e `ANTHROPIC_BASE_URL` (dublê). SDK
  `@anthropic-ai/sdk@0.131.0`, versão exata. `anthropic.service.ts`: cliente com host fixo e
  guarda de teste (como `garantirDestinoDeTeste`), tradução dos erros do SDK para os mesmos
  códigos estáveis (`PROVEDOR_INDISPONIVEL`, `PROVEDOR_DEMOROU`, `COTA_EXCEDIDA` — crédito
  acabado chega como 400 "credit balance"), e `saude`. `modelos.service.ts` despacha por
  provedor: o catálogo da Anthropic vem de `GET /v1/models` (exige chave), cruzado com a tabela;
  modelo sem preço fica fora. `favoritar` grava o provedor; `registrarUso` aceita provedor e
  tokens de cache. `GET /ai/health?provider=`.
- **testes:** `anthropic.test.ts` com dublê em `127.0.0.1:39336` — catálogo só com modelos de
  preço conhecido, favoritar grava `anthropic`, saúde com e sem chave, catálogo do OpenRouter
  inalterado.

## F2 — Inferência

**Objetivo:** gerar texto pela Anthropic em toda superfície — formatar nota, chat, agentes e
passos de rotina —, com o provedor seguindo o modelo.

- `anthropic-fluxo.ts`: conversão na borda (`paraAnthropic`: `system` à parte, `tool_calls` em
  `tool_use` com argumentos parseados, mensagens `tool` seguidas num só `user`) e o passo pelo
  fluxo do SDK. Esforço `low` (o Haiku 4.5 não aceita `effort`), cache automático no último
  bloco, busca do servidor com `max_uses: 1` — variante básica `_20250305` em todos os modelos
  (ver "Teste real", abaixo).
- `passo.service.ts` despacha por `modelo.provider` depois do teto. O passo devolve `nativo`
  (o conteúdo da fala como veio), que o chat e a rotina guardam **só em memória** na mensagem
  do laço: o pensamento volta intacto no passo seguinte e some do histórico gravado.
- Recusa (`refusal`) e saída cortada (`max_tokens`) chegam como 200 e já foram pagas: a linha
  de uso leva o custo com `ok: false` (`RECUSA_DO_MODELO`, `RESPOSTA_INVALIDA`).
- `FOLGA_PENSAMENTO_TOKENS = 4096` somada ao `max_tokens` de toda chamada à Anthropic e à
  estimativa do teto (`estimarComBusca` lê o `provider` do favorito, então as três contas —
  passo, 402 de `iniciar` e prévia do agente — continuam iguais).
- Custo `estimado` por `custoDaAnthropic`, com cache e busca; modelo fora da tabela cai no
  preço do favorito com multiplicadores padrão.
- Testes: `anthropic-chat.test.ts` (9) com o dublê respondendo SSE na forma real.

## F3 — Ajustes

- Catálogo com dois botões de provedor (Anthropic primeiro e padrão; OpenRouter com
  `AvisoOpenRouter`). Na Anthropic somem os chips de preço e a caixa de ferramentas (não há
  grátis, e todos chamam ferramenta). Erro do catálogo mostra a frase do servidor — sem chave,
  ela nomeia `ANTHROPIC_API_KEY`.
- `provedorDe(modelo)` passa a ler `provider`: "Anthropic · créditos do Claude" ou
  "via OpenRouter · dono". Cartão, catálogo e editor de agente usam a mesma linha.
- O aviso fica **enquanto durar** a escolha: no quadro de tarefas (as tarefas no OpenRouter) e
  no editor do agente (modelo próprio do OpenRouter), não só no instante da troca.
- Saúde por provedor (`?provider=`, chave de cache debaixo de `CHAVE_SAUDE_IA`). `motivoSemChat`
  (cliente, web e móvel) decide pela chave do provedor do modelo que vai responder — sem isto,
  quem usasse só a Anthropic teria o chat bloqueado por falta da chave do OpenRouter.
- Seção Provedores com as duas conexões; a permissão de treino vale só para o OpenRouter.
- Conferido no navegador, com um usuário descartável no banco de desenvolvimento.

## F4 — Tela de custo do Claude

- **Sem Admin API.** A doc da Anthropic diz que ela não existe para contas individuais do
  Console — é numa delas que caem os créditos do plano. A tela é o registro do Yu-book
  (`ai_usage` com `provider = anthropic`), dita como estimativa, com o Console como fonte oficial.
- `GET /ai/claude/usage?days=` (`uso-claude.service.ts`): totais com tokens de cache, economia
  do cache pela tabela (pode ser negativa: cache escrito e nunca lido), fração do prompt servida
  pelo cache, mês civil no fuso do usuário, hoje, por dia, por modelo, por tarefa, recusas por
  crédito acabado (`COTA_EXCEDIDA`) e do modelo (`RECUSA_DO_MODELO`).
- Créditos mensais informados à mão (`ai_preference.anthropic_monthly_credit_micros`, migration
  `provedor_anthropic_creditos`, até US$ 2 mil): só para comparar com o gasto do mês — a API não
  deixa ler o saldo. Não é teto.
- Web: seção "Custo do Claude" em `/ajustes/claude`, reusando seletor de período, `Indicador`,
  `BarrasPorDia` e o desenho das tabelas do AI usage dash.
- Testes: `anthropic-custo.test.ts` (6). Conferido no navegador com dados semeados.

## Teste geral e revisão

- Portões: `pnpm typecheck` (6 pacotes), API 779/780, MCP 121/121, builds de API, web e móvel.
  A falha única é ambiental e anterior: `web.test.ts` (DNS rebinding) precisa do endereço
  `127.0.0.2`, que o macOS não tem sem `sudo ifconfig lo0 alias 127.0.0.2`.
- Revisão do agente `revisor`, sem violação de invariante; corrigidos na mesma entrega:
  - **busca em todas as voltas na Anthropic** (`buscaNaVolta`): tirar `web_search` de `tools`
    no passo 2 invalidaria o pensamento reenviado — 400 em conta criada desde 2026-08-31;
  - `pause_turn` e `tool_use` cortado por `max_tokens` viram erro com a linha paga;
  - estimativa do teto como cota superior: escrita de cache (1,25×) e faixa longa do Haiku 5.5
    (`precoParaEstimativa`); o formatar não pede cache;
  - o contador de recusas da tela diz "crédito acabado ou limite de uso" (os dois são
    `COTA_EXCEDIDA`, e a lista de códigos é fechada).
- MCP: não acompanha (só lê `timezone` de `/ai/settings`).

## Teste real (2026-10-21, chave da Yuri's Individual Org)

- Saúde, catálogo (11 modelos com preço), laço de duas voltas no Opus 5.5 com `search_notes`
  (cache gravado no passo 1 e lido no 2) e formatar no Haiku 5.5: tudo certo, ~US$ 0,008.
- Busca na web no Opus 5.5 com a variante de filtragem dinâmica (`web_search_20260209`): a
  busca roda de dentro de execução de código; a primeira falhou no código do modelo, a segunda
  esbarrou em `max_uses: 1`, a resposta saiu sem fonte e custou US$ 0,056. Trocado para a
  variante básica `web_search_20250305`, busca direta como o plugin do OpenRouter.
