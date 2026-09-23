# PRD — IA dentro do Yu-book

**Versão:** v0.1 (draft) · **Autor:** yjdutra · **Data:** 2026-08-24 · **Status:** Etapa A entregue
em 2026-09-22

> **A Etapa A revogou seis afirmações deste documento.** Elas ficam abaixo, marcadas onde estão, em
> vez de reescritas — o que se pensava em 2026-08-24 é parte do registro. São: **RN-01** e
> **RNF-01** (privacidade por modelo local), **RF-02** (interface de provedor com duas
> implementações), **RF-08** (o caminho `/assistente/saude`), **NO5** (nada de teto de custo) e
> **NO2** (nada de nota gerada por IA). O motivo de cada uma está na entrada de 2026-09-22 de
> [`historico.md`](historico.md); o efeito observável, no [`CHANGELOG.md`](../CHANGELOG.md).
>
> A queda do modelo local leva junto o objetivo **O2** e as métricas **M1**, **M3** e **M4**, que o
> pressupunham. Ficam abaixo pelo mesmo motivo: o documento vale como o que se pensava na data.

> Quarta frente do roteiro em [`applied-ai-read-trip.md`](applied-ai-read-trip.md). Começa **depois**
> da Fase 2 do MCP (curso Advanced Topics + tools de escrita) e corre **em paralelo** à mesa de
> trabalho: a mesa é trabalho de fim de semana, este escopo é trabalho de dia de semana.
>
> Este PRD define **o que precisa ser verdade** ao fim de cada fase. O **como** é o plano específico
> de cada fase, gerado em modo plano no momento da execução.

---

## 1. Contexto e problema

O servidor MCP fez o Yu-book ser **servidor**: ele se expõe para que uma inteligência de fora o use.
Isso resolve o caso de quem está no Claude Code ou, no futuro, na mesa de trabalho.

Não resolve o caso oposto, e é o mais comum: **quem está com o Yu-book aberto no navegador não tem
um cliente MCP por perto.** Formatar uma nota bagunçada, encontrar o que se anotou sobre um assunto
sem lembrar as palavras exatas, ou discutir um rascunho — nada disso alcança o MCP, e não é falha
dele. É outra direção: aqui o Yu-book passa a ser **cliente** de um modelo.

Há um terceiro fator que nenhuma das duas direções resolve sozinha: **privacidade**. Toda nota que
entra num prompt enviado para fora sai da máquina. Para um segundo cérebro pessoal — que guarda
anotação de trabalho, de estudo e de projeto — isso é uma escolha de natureza, não um detalhe de
configuração.

A busca semântica, aliás, não é ideia nova: estava na proposta original do projeto como Fase 6, com
`pgvector` e "pergunte às suas notas". Este PRD a resgata junto com o resto.

---

## 2. Objetivos

- **O1** — O usuário resolve tarefas de conteúdo sem sair do Yu-book e sem precisar de cliente MCP.
- **O2** — ~~Tarefa que envolve o conteúdo de uma nota roda **em modelo local**, e a nota não sai
  da máquina.~~ Revogado em 2026-09-22, com a RN-01 e o RNF-01.
- **O3** — O chat responde sobre notas e quadros que o usuário **escolheu anexar**, citando a origem.
- **O4** — O usuário encontra uma nota descrevendo o assunto com as próprias palavras, sem acertar os
  termos que escreveu na época.
- **O5** — Nenhuma chave de provedor alcança o navegador.

### 2.1 Métricas de sucesso

- **M1** — Provedores configurados: **0 hoje → 2** (Ollama e OpenRouter), com roteamento por tarefa.
- **M2** — Chaves de provedor presentes no bundle do front: **0**, verificável por busca no artefato
  compilado.
- **M3** — ~~Tarefas de conteúdo de nota executadas em modelo local: **100%**.~~ Revogada em
  2026-09-22: é **0%**, e por decisão. Ver o O2.
- **M4** — Tempo até o primeiro caractere no chat (streaming): **≤ 3 s** com Ollama local, medido no
  acervo atual.
- **M5** — Conversas persistidas recuperáveis após recarregar a página: **100%**.
- **M6** — Cobertura de embeddings ao fim da Fase 4: **100% das notas ativas**, verificável por
  contagem contra `note`.

---

## 3. Não-objetivos

- **NO1** — Não construir um chat de propósito geral. O chat responde sobre o que foi **anexado**;
  sem contexto anexado ele é um assistente pior que qualquer aba do navegador, e não é para isso que
  existe.
- **NO2** — **Revisto em 2026-09-22, sem código ainda.** Nota gerada por IA passa a ser permitida
  **desde que marcada no dado** — o que o NO2 protegia (texto sintético indistinguível no acervo)
  é atendido pela marca, não pela proibição. A marca é da **Etapa C**; até ela existir, não se gera
  nota. Texto original: não gerar nota do zero por IA, porque o Yu-book guarda o que **você**
  pensou.
- **NO3** — Não expor nenhuma dessas funções pelo servidor MCP. Quem usa o MCP já tem um modelo do
  outro lado — oferecer um segundo seria redundância de verdade.
- **NO4** — Não treinar, afinar nem hospedar modelo. Ollama e OpenRouter são consumidos como estão.
- **NO5** — **Revogado em 2026-09-22**, a pedido do operador. Com provedor local no desenho, custo
  era hipótese; sem ele, toda formatação é dinheiro. A Etapa A entregou **teto diário**, gasto do
  dia visível e a contagem das chamadas sem custo informado. Texto original: não implementar
  controle de custo por orçamento, alerta de cota ou painel de gastos; teto entra se doer.
- **NO6** — Não substituir a busca full-text existente. A semântica **complementa**; a busca por
  palavra continua sendo o caminho padrão.
- **NO7** — Não tornar a IA obrigatória. Com provedor fora do ar, todo o resto do Yu-book funciona
  igual.

---

## 4. Personas e usuários-alvo

**Yuri, escrevendo.** Está com uma nota aberta, no meio do texto. Quer formatar o que colou de
qualquer lugar sem parar para arrumar à mão. Frequência: diária.

**Yuri, procurando.** Sabe que anotou algo sobre um assunto, não lembra como chamou. Hoje tenta
palavras até acertar. Frequência: várias vezes por semana.

**Yuri, pensando.** Tem um rascunho ou uma dúvida e quer discutir de forma superficial, sem abrir a
mesa de trabalho — que é para trabalho. Anexa a nota ou o quadro e conversa sobre aquilo.

Um usuário, um papel. Sem hierarquia, como no resto do projeto.

---

## 5. Requisitos funcionais

### 5.1 Fase 1 — O provedor

- **RF-01** — Existe um módulo `assistente` em `apps/api`, com as duas camadas do projeto:
  `assistente.routes.ts` faz `schema.parse` → chama service → devolve; `assistente.service.ts`
  concentra a regra e a conversa com o provedor.
- **RF-02** — ~~Revogado em 2026-09-22~~, junto com o Ollama: com uma implementação só, a interface
  seria cerimônia que ninguém exercita. O que ficou no lugar é a injeção de transporte do RF-09 e
  `OPENROUTER_BASE_URL`. O texto original: o módulo expõe **uma interface de provedor** com duas
  implementações: **Ollama**
  (local) e **OpenRouter** (nuvem). Trocar de provedor não altera o código que chama.
- **RF-03** — O roteamento é **por tarefa**, não por preferência global: tarefa que carrega conteúdo
  de nota vai para Ollama; tarefa que exige modelo maior vai para OpenRouter. A tabela de roteamento
  é declarada em um lugar só.
- **RF-04** — **Toda chamada a provedor parte do servidor.** O front nunca fala com Ollama nem com
  OpenRouter, e nenhuma variável com prefixo `VITE_` carrega chave.
- **RF-05** — As variáveis de ambiente novas são validadas no boot pelo mesmo `env.ts`, com
  `OPENROUTER_API_KEY` **opcional**: sem ela, o roteamento para nuvem é desabilitado e o resto segue
  funcionando.
- **RF-06** — Toda falha de provedor vira `AppError` com código estável registrado em `ERROR_CODES`
  de `packages/shared`. No mínimo: provedor indisponível, tempo esgotado e cota excedida.
- **RF-07** — Toda chamada tem **teto de tempo** e é cancelável. Provedor lento não prende requisição
  da API.
- **RF-08** — O caminho **entregue é `GET /ai/health`**, não `/assistente/saude`: o RNF-08 deste
  mesmo documento manda a fronteira da API em inglês, e os nove grupos de rota existentes são todos
  em inglês — regra vence exemplo. O requisito em si vale: o endpoint informa quais provedores
  respondem, sem executar
  inferência.
- **RF-09** — A implementação de provedor aceita **injeção da função de transporte**, para que os
  testes de integração exercitem o módulo sem chamar modelo de verdade — mesmo padrão do parâmetro
  `permitido` de `titulo.service.ts`.

### 5.2 Fase 2 — Formatar nota

- **RF-10** — A nota tem um botão de formatar no topo, ao lado do botão de copiar já existente.
- **RF-11** — O resultado é **aplicado direto**, com **desfazer disponível por 8 segundos** — mesmo
  padrão e mesma duração da exclusão na gaveta de links.
- **RF-12** — Desfazer restaura exatamente o texto anterior à formatação, incluindo o que o autosave
  já tiver gravado no intervalo.
- **RF-13** — A formatação altera **apenas** `contentMd`. O título, as tags, o workspace e os campos
  livres não são tocados.
- **RF-14** — O prompt de formatação declara o que **não** fazer: não alterar o sentido, não resumir,
  não remover conteúdo, não inventar seção, e **não modificar nenhum `[[wikilink]]`** — reescrevê-los
  quebraria a tabela derivada `note_link`.
- **RF-15** — Enquanto a formatação está em andamento, o botão indica o estado e a edição segue
  possível. Chegando o resultado com o texto já alterado pelo usuário, a aplicação é **recusada** com
  aviso, não sobrescreve.
- **RF-16** — Falha de provedor deixa a nota intacta e mostra erro dispensável com `role="alert"`,
  como o resto do app.

### 5.3 Fase 3 — Chat ancorado

- **RF-17** — Existe um painel de chat, aberto por atalho, com entrada correspondente em
  `Atalhos.tsx`.
- **RF-18** — O usuário **anexa** notas e quadros ao contexto da conversa, escolhendo em uma lista
  que mostra título e tipo — não o conteúdo.
- **RF-19** — Nota anexada entra no contexto com o corpo completo. Quadro anexado entra com as
  colunas e a **face** dos cards, sem descrição — o mesmo recorte que o MCP já usa.
- **RF-20** — A resposta **cita a origem**: toda afirmação sobre uma nota nomeia a nota e permite
  abri-la.
- **RF-21** — ~~Sem nada anexado, o chat **avisa que responde sobre o que for anexado** e não tenta
  responder sobre o acervo inteiro.~~ **Revogado em 2026-09-23**, com a RN-04 e o CA-09. A Etapa B
  trouxe o **laço de ferramenta**, e ele é exatamente o assistente procurando sozinho: o modelo pede
  `search_notes`, o Yu-book executa, o resultado volta e ele decide se acabou. O que este requisito
  protegia — resposta inventada sobre um acervo que o modelo não viu — passou a ser protegido de
  outro jeito, e melhor: só existe afirmação sobre o que uma ferramenta de leitura devolveu, e a
  RN-05 continua valendo inteira. O anexo pelo `@` não sumiu; deixou de ser a **única** porta.
- **RF-22** — A resposta chega em **streaming**, com o texto aparecendo enquanto é gerado.
- **RF-23** — Conversa e mensagens são **persistidas**, escopadas por usuário, e a conversa é
  recuperável depois de recarregar a página.
- **RF-24** — O usuário renomeia e exclui conversa. Excluir conversa **não** toca em nota nem em card.
- **RF-25** — O painel indica **qual provedor e modelo** respondeu cada mensagem.
- **RF-26** — O contexto anexado é montado por uma função em `packages/shared`, a mesma que o
  servidor MCP usa para montar nota e quadro. Duas implementações divergiriam, e a divergência
  apareceria como o mesmo dado com duas caras.

### 5.4 Fase 4 — Busca semântica

- **RF-27** — A extensão `pgvector` é habilitada por migration, junto da coluna de embedding em
  `note`.
- **RF-28** — Existe um pipeline que gera embedding do conteúdo de uma nota e o grava.
- **RF-29** — Nota criada ou com corpo alterado tem o embedding **marcado como obsoleto** e
  regenerado fora do caminho da requisição — o autosave não espera embedding.
- **RF-30** — Existe um comando de **backfill** que percorre as notas sem embedding, com progresso
  visível e retomada após interrupção.
- **RF-31** — A busca semântica é um caminho **adicional**: quando a busca por palavra não encontra
  resultado exato, a semântica entra; e existe um modo explícito de perguntar em linguagem natural.
- **RF-32** — A resposta em linguagem natural **cita as notas de origem**, com id e título.
- **RF-33** — Nota sem embedding continua encontrável pela busca full-text. Ausência de embedding
  nunca torna uma nota invisível.
- **RF-34** — Nota na lixeira não entra em resultado semântico, como já não entra na busca atual.

---

## 6. Requisitos não-funcionais

- **RNF-01 Privacidade** — **Revogado em 2026-09-22.** A API roda na Railway, sem GPU: o Ollama
  saiu do escopo e **o conteúdo da nota sai da máquina em toda tarefa de IA**. O que resta é dizê-lo
  na tela de ajustes e mandar `provider: { data_collection: "deny" }` na requisição. **Emendado em
  2026-09-23:** esse pedido deixou de ser fixo e virou escolha do usuário em `/ajustes`, desligada
  por padrão — fixá-lo em `deny` torna os modelos gratuitos inalcançáveis, porque os endpoints deles
  treinam com os dados e o roteamento não acha nenhum que atenda. O texto
  original: conteúdo de nota só sai da máquina quando o usuário escolher explicitamente um provedor
  de nuvem para aquela tarefa, e o padrão para tarefa sobre nota é local.
- **RNF-02 Segredo** — Nenhuma chave de provedor no bundle do front, no `localStorage` ou em resposta
  de API. Verificável por busca no artefato compilado.
- **RNF-03 Degradação** — Provedor fora do ar não impede escrever, buscar, arrastar card ou qualquer
  função existente. As funções de IA ficam indisponíveis com aviso; o resto não muda.
- **RNF-04 Orçamento de contexto** — O contexto anexado ao chat é limitado e o limite é **declarado
  ao usuário** quando corta. Nada de corte silencioso.
- **RNF-05 Segurança de saída** — Texto gerado por modelo é tratado como conteúdo não confiável:
  passa pelo mesmo `DOMPurify` de `renderMarkdown` antes de virar DOM.
- **RNF-06 Escopo por usuário** — Conversa, mensagem e embedding seguem a mesma regra do resto:
  `userId` vem só do token, e id de outra conta é indistinguível de inexistente.
- **RNF-07 Acessibilidade** — Estado de geração é anunciado por `aria-live`; erro usa `role="alert"`;
  nenhum estado é comunicado só por cor.
- **RNF-08 Convenções** — Domínio em português, fronteira da API em inglês, imports com `.js`,
  comentário citando `RF-xx`. Sem biblioteca de UI e sem `dark:`.

---

## 7. Modelo de dados

Duas entidades novas na Fase 3 e uma coluna na Fase 4. Nada é removido.

| Entidade | Campos-chave | Notas |
|---|---|---|
| `conversa` | `id`, `user_id`, `titulo`, `created_at`, `updated_at` | Escopada por usuário |
| `mensagem` | `id`, `conversa_id`, `papel`, `conteudo`, `provedor`, `modelo`, `created_at` | Cascata a partir de `conversa` |
| ~~`conversa_anexo`~~ `ai_attachment` | `message_id`, `note_id?`, `card_id?`, `board_id?`, `title` | **Emendado em 2026-09-23:** pende da **mensagem**, não da conversa |
| `note.embedding` | vetor, mais marca de obsolescência | Coluna nova, Fase 4 |

**Emenda de 2026-09-23, na Etapa B.** O anexo passou a pender da **mensagem**. Preso à conversa, o
histórico mente: uma mensagem feita antes de você anexar a nota apareceria depois como se já a
tivesse tido. Ele ganhou também `card_id` — o `@` anexa card, não só nota e quadro — e uma cópia do
`title` no momento do anexo, para que um alvo que vá para a lixeira não transforme a linha do
histórico em três nulos. Os nomes reais das três tabelas são `ai_conversation`, `ai_message` e
`ai_attachment`: a fronteira e a persistência ficam em inglês, como no resto do projeto, e os nomes
em português acima são do rascunho.

**Invariantes do modelo:** excluir conversa apaga suas mensagens e anexos, e **não** toca em nota nem
em card. Excluir a nota anexada **não** apaga a conversa — o anexo é desfeito, como o vínculo
card ↔ nota já faz.

---

## 8. Fluxos principais

**Fluxo A — Formatar uma nota**
1. O usuário abre a nota e clica em formatar.
2. O servidor monta o prompt e chama o provedor local.
3. O texto formatado é aplicado, e um aviso de desfazer aparece por 8 segundos.
4. Se o usuário desfizer, o texto anterior volta e o autosave grava a volta.

**Fluxo B — Discutir um rascunho**
1. O usuário abre o chat e anexa uma nota e um quadro.
2. Pergunta sobre aquilo.
3. A resposta chega em streaming, citando as notas.
4. A conversa fica salva e pode ser retomada depois.

**Fluxo C — Encontrar sem lembrar as palavras**
1. O usuário pergunta em linguagem natural.
2. A busca por palavra não acha correspondência exata.
3. A semântica devolve notas relacionadas, com o motivo da relação e o id de cada uma.

**Fluxo D — Provedor fora do ar**
1. O Ollama não está rodando.
2. `GET /assistente/saude` reporta o provedor indisponível.
3. Os botões de IA aparecem desabilitados com o motivo; escrever, buscar e arrastar seguem normais.

---

## 9. Regras de negócio

- **RN-01 Local por padrão para conteúdo.** **Revogada em 2026-09-22**, com o RNF-01 e pelo mesmo
  motivo: não há modelo local em produção. Toda tarefa de conteúdo vai para a nuvem, e o usuário é
  avisado disso na tela antes de usar.
- **RN-02 A chamada sai do servidor.** O front nunca fala com provedor. É a mesma lição do
  `VITE_API_URL`: o que o front conhece, o bundle publica.
- **RN-03 IA não escreve nota sozinha.** Toda alteração de conteúdo por modelo é iniciada pelo
  usuário e reversível por ele.
- **RN-04 O chat responde sobre o anexado.** **Revogada em 2026-09-23**, com o RF-21 e o CA-09. O
  laço de ferramenta substitui "pedir contexto" por "ir buscar". A regra que sobrevive, e que é a
  que importava, é a RN-05.
- **RN-05 Toda afirmação cita origem.** Resposta que fala de uma nota nomeia a nota.
- **RN-06 Wikilink é intocável por modelo.** Nenhum prompt que edite conteúdo pode alterar `[[…]]` —
  `note_link` é tabela derivada e reescrever o texto quebraria o grafo.
- **RN-07 Texto de modelo é conteúdo não confiável.** Sanitizado como qualquer entrada, sem exceção.
- **RN-08 Embedding é derivado.** Perder todos os embeddings não perde nenhum dado: o backfill os
  reconstrói a partir das notas.
- **RN-09 A IA é opcional.** Nenhuma função existente passa a depender de provedor.

---

## 10. Critérios de aceitação

- **CA-01** (RF-04, RNF-02, M2) — Dado o bundle do front compilado, quando se busca por
  `OPENROUTER`, por `sk-` e pelo host do Ollama, então não há ocorrência.
- **CA-02** (RF-05) — Dado o ambiente **sem** `OPENROUTER_API_KEY`, quando a API sobe, então ela
  sobe normalmente e `GET /assistente/saude` reporta só o provedor local.
- **CA-03** (RF-08, RNF-03) — Dado o Ollama parado, quando se abre o Yu-book, então escrever, buscar
  e arrastar card funcionam, e os botões de IA aparecem desabilitados com o motivo.
- **CA-04** (RF-09) — Dado o transporte injetado por um dublê, quando a suíte de integração roda,
  então o módulo `assistente` é exercitado sem nenhuma chamada de rede a provedor.
- **CA-05** (RF-11, RF-12) — Dada uma nota formatada, quando se desfaz dentro de 8 segundos, então o
  conteúdo volta a ser exatamente o anterior, comparado caractere a caractere.
- **CA-06** (RF-13) — Dada uma nota formatada, quando se comparam título, tags, workspace e `meta`
  antes e depois, então são idênticos.
- **CA-07** (RF-14, RN-06) — Dada uma nota com três `[[wikilinks]]`, quando ela é formatada, então os
  três permanecem com o mesmo alvo, e `note_link` não muda.
- **CA-08** (RF-15) — Dado que o usuário edita a nota enquanto a formatação está em andamento, quando
  o resultado chega, então ele é recusado com aviso e o texto do usuário permanece.
- **CA-09** (RF-21, RN-04) — ~~Dado o chat sem nada anexado, quando se faz uma pergunta sobre o
  acervo, então a resposta pede que se anexe algo, em vez de responder.~~ **Revogado em
  2026-09-23**, com os dois. O critério que ocupou o lugar dele: dado o chat sem nada anexado,
  quando se pergunta sobre o acervo, então o assistente chama uma ferramenta de leitura e a
  resposta nomeia o que encontrou.
- **CA-10** (RF-23, M5) — Dada uma conversa com mensagens, quando se recarrega a página, então a
  conversa aparece íntegra.
- **CA-11** (RF-26) — Dado um id de nota, quando se compara o contexto montado pelo chat com o texto
  de `yubook://nota/{id}`, então são idênticos.
- **CA-12** (RNF-05, RN-07) — Dada uma resposta de modelo contendo `<script>` e `<iframe>`, quando
  ela é renderizada, então nenhum dos dois chega ao DOM.
- **CA-13** (RF-29) — Dada uma nota salva pelo autosave, quando se mede o tempo da requisição de
  salvamento, então ele não cresce por causa de embedding.
- **CA-14** (RF-33) — Dada uma nota sem embedding, quando se busca por uma palavra exata do corpo
  dela, então ela aparece nos resultados.
- **CA-15** (RF-30, M6) — Dado o backfill concluído, quando se contam notas ativas e notas com
  embedding, então os dois números são iguais.
- **CA-16** (RNF-06) — Dada uma conversa de outra conta, quando se tenta acessá-la, então a resposta é
  404, não 403.

---

## 11. Dependências, restrições e riscos

### Dependências
- **Ollama** instalado e rodando na máquina do operador, com um modelo de instrução e um de embedding.
- **OpenRouter**, com chave — opcional por RF-05.
- **pgvector** disponível no Postgres, na Fase 4. Em produção é plugin da Railway; confirmar antes.
- Fase 2 do MCP concluída (curso Advanced Topics + tools de escrita), por decisão de sequenciamento.

### Restrições técnicas
- **O trabalho assíncrono entra aqui, e contraria uma decisão registrada.** A proposta original
  rejeitou fila de jobs porque "não há trabalho assíncrono real". O backfill de embeddings cria esse
  trabalho. A decisão precisa ser tomada e escrita na Fase 4 — não pode entrar por inércia.
- **O servidor passa a ter um segundo ponto de conexão para fora.** Hoje é só `titulo.service.ts`, e
  a invariante INV-08 diz "único ponto". O provedor cria o segundo, e o Ollama é um endereço de
  laço — exatamente o que a guarda de SSRF existente recusa. É outro caminho de código, e a exceção
  precisa ser deliberada e documentada, não implícita.
- Desktop-only e usuário único seguem valendo; nada aqui muda isso.
- Sem linter e sem CI: os portões continuam sendo `pnpm typecheck` e a suíte da API.

### Riscos

| Risco | Mitigação |
|---|---|
| **A formatação estraga uma nota** e o usuário não percebe a tempo | Desfazer de 8 s (RF-11), escopo restrito a `contentMd` (RF-13), wikilinks intocáveis (RF-14) e os testes CA-05 a CA-07 |
| **O chat vira ChatGPT pior**, sem valor próprio | RF-21 e RN-04: sem contexto anexado, ele recusa em vez de improvisar |
| **Modelo local entrega qualidade baixa** e a função não se paga | RF-03 permite rotear a tarefa para nuvem sem mudar chamada; a decisão é por tarefa, reversível |
| **Embedding vira dívida silenciosa** — notas novas sem vetor, busca incompleta | RF-33 garante que a full-text continua achando; CA-15 conta e compara |
| **A Fase 4 puxa infraestrutura** que o projeto rejeitou por decisão | Está declarada como restrição, não descoberta no meio; e é a última fase, então pode ser cortada sem desfazer nada |
| **Custo de nuvem escapa** sem ninguém olhar | RF-25 registra provedor e modelo por mensagem; teto entra se doer (NO5) |

---

## 12. Entregas e fases

Cada fase gera **seu próprio plano** em modo plano, na execução. Cada uma entrega valor sozinha e
nenhuma exige a seguinte.

**Fase 1 — O provedor.** O encanamento: módulo, interface, roteamento por tarefa, ambiente, erros,
saúde e injeção para teste. Não entrega funcionalidade visível; entrega a fundação que as três
seguintes usam. É a menor.

**Fase 2 — Formatar nota.** A primeira função visível, e a que prova a fundação ponta a ponta com o
menor risco. Reaproveita o autosave, o botão de copiar e o padrão de desfazer da gaveta de links.

**Fase 3 — Chat ancorado.** A maior das três primeiras. Traz streaming, duas entidades novas e a
montagem de contexto compartilhada com o MCP.

**Fase 4 — Busca semântica.** A mais pesada e a última. `pgvector`, pipeline de embeddings, backfill
e trabalho assíncrono. Resgata a Fase 6 da proposta original.

**Propagação obrigatória, em todas as fases:** mudança de domínio exige verificar se a superfície do
MCP acompanha. Conversa e embedding provavelmente **não** entram no MCP (NO3), mas a decisão precisa
ser declarada, não presumida — o agente `mcp` roda no modo de propagação e diz item por item.

---

## 13. Questões em aberto

- **Q-01** — Qual modelo local de instrução e qual de embedding? Impacto: qualidade da formatação e
  do resultado semântico, e tamanho do download. Resolver na Fase 1, testando com o acervo real.
- **Q-02** — O `pgvector` está disponível no plugin de Postgres da Railway? Impacto: se não estiver,
  a Fase 4 precisa de outro caminho ou sai do escopo. Verificar **antes** de começar a Fase 4.
- **Q-03** — Como o backfill roda sem introduzir uma fila de jobs? Impacto: decide se a Fase 4 é
  simples ou traz infraestrutura nova. Responsável: operador, na Fase 4.
- **Q-04** — A conversa deve poder virar nota? Aproveitaria que nota já é a entidade forte do
  projeto, mas conflita com NO2, que proíbe texto sintético no acervo. Responsável: operador, depois
  de usar o chat.
- **Q-05** — ~~O limite de contexto do chat é por número de anexos, por bytes, ou os dois?~~
  **Resolvida em 2026-09-23, na Etapa B: os dois, e cada um resolve uma coisa.** O corte que vale é
  por **caracteres**, no mesmo `MAX_CONTEUDO_IA` de 60 000 que a formatação já usa, e ele corta por
  anexo inteiro — meia nota no contexto é o tipo de entrada que faz o modelo afirmar o contrário do
  que a nota diz. O limite por **quantidade** (`MAX_ANEXOS_POR_MENSAGEM`, 10) existe só para não
  montar dez consultas ao banco antes de descobrir que não caberiam. Quando corta, a tela diz quais
  ficaram de fora (RNF-04): nada de corte silencioso.

---

## 14. Suposições assumidas

- **S-01** — O Ollama roda na mesma máquina que a API em desenvolvimento. Justificativa: é o cenário
  do operador; em produção na Railway não haverá Ollama, e as funções locais ficarão indisponíveis
  por RNF-03 até que se decida outra coisa. **Esta é a suposição mais consequente do documento** —
  ela significa que, hoje, as funções de IA são de desenvolvimento local, não de produção.
- **S-02** — O acervo continuará na ordem de dezenas a poucas centenas de notas durante estas quatro
  fases. Justificativa: 16 hoje, crescendo por aula assistida. Se passar de milhares, o backfill e o
  índice vetorial mudam de tamanho.
- **S-03** — "Formatar" significa aplicar estrutura de Markdown ao texto existente — títulos, listas,
  ênfase, blocos de código — sem reescrever frases. Justificativa: é o que RF-14 delimita, e é o que
  torna o desfazer suficiente como rede de proteção.
