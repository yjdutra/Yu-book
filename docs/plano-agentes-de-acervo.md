# Plano geral — agentes de acervo no Yu-book

> Plano geral aprovado pelo operador em 2026-09-24, ao fim da sessão que entregou o redesenho de
> UI/UX. Registra **o que** e **por quê** das cinco etapas seguintes da frente de IA. O **como** de
> cada etapa é decidido no plano próprio dela, no momento de executar — este documento é o mapa,
> não a planta.

---

## Como trabalhar com este plano (leia primeiro)

**O fluxo é fixo, e é do operador.** Para **cada** etapa abaixo:

1. **Modo plano.** Explore o código que a etapa toca, desenhe o plano da etapa e **aguarde a
   aprovação** do operador. Use este documento como base, mas o plano da etapa é que manda — se a
   exploração mostrar que algo aqui está errado, diga no plano, não siga às cegas.
2. **Executar** o plano aprovado, inteiro. Sem perguntar "começo por X?" e sem criar subetapas que
   o plano não previu. Documentação e PRD entram **dentro** da etapa, não como passo à parte.
3. **Fechar** a etapa como o projeto fecha: portões (`pnpm --filter @yu-book/shared build`,
   `pnpm typecheck`, testes da API e do MCP quando tocados), `revisor`, `versionador` e `curador`
   — chamados sem o operador precisar pedir. Commit só pelo `publicador`, e **push só com ordem
   explícita** (push para `master` é deploy em produção).
4. **Modo plano** de novo, para a etapa seguinte.

**UI/UX é requisito, não acabamento.** Funcionar não basta: cada tela desta frente tem de ser
agradável de usar e seguir o visual do redesenho de 2026-09-24 — moderno, bonito, elegante. Na
prática, isso quer dizer:

- carregar a skill `design-system-yu-book` antes de qualquer componente, e usar os primitivos de
  `apps/web/src/components/base/` (Botao, BotaoIcone, Bloco, Aviso, Dialogo, Menu, Etiqueta, Toast)
  e os tokens (`bg-superficie`, `shadow-e1..e4`, `rounded-cartao`, gradiente de IA
  `accent-500 → ia-500`, `animate-surgir`) — nada de estilo copiado à mão;
- cada funcionalidade nova tem **lugar claro na casca** (trilho, painel contextual, painel do
  assistente) — não vira um botão perdido;
- estados vazios que convidam à ação, esqueletos sem salto, erro inline com `Aviso`, animação com
  `prefers-reduced-motion`, teclado completo, foco visível e devolvido;
- o plano de cada etapa descreve a UI com o mesmo detalhe que descreve dados e API — layout,
  fluxo de uso, estados — e a conferência de interface à mão entra no checklist de fechamento.

---

## Contexto

O Yu-book virou cliente de modelo na Etapa A (provedor OpenRouter, teto de gasto diário, `/ajustes`)
e ganhou um chat com laço de ferramentas na Etapa B (até `MAX_PASSOS_DO_LACO` chamadas por mensagem,
as nove ações do acervo definidas uma vez em `packages/shared/src/ferramentas.ts`). O redesenho de
UI/UX deu ao assistente um painel lateral, a rota `/assistente` e o quadro de modelos por tarefa.

O operador quer **agentes especialistas que trabalham sobre o acervo** — o exemplo guia é a produção
de posts para o LinkedIn:

- um **especialista em LinkedIn**, que já carrega o guia de como escrever posts, exemplos e o índice
  dos últimos posts publicados;
- um **agente de marketing**, com o posicionamento, as palavras-chave e o público;
- um **revisor**;
- conversar com cada um diretamente, e também rodar uma **rotina**: ler a coluna de ideias de um
  quadro, escrever o post, passar pelo marketing e pelo revisor, e deixar o resultado na coluna
  "Aguardando publicar" — **nunca publicar sozinho**;
- depois, agendar a rotina (por exemplo, duas vezes por semana);
- e buscar ideias de posts fora do acervo.

### Decisões já tomadas na conversa que originou este plano

- **Agente de acervo, não de código.** Estes agentes leem e escrevem nota e card e consultam
  fontes externas por ferramentas definidas. Agente que mexe em repositório, roda shell ou guarda
  credencial de repositório **não** mora no Yu-book: é a mesa de trabalho, que roda num executor
  isolado (local ou sandbox sob demanda), nunca no serviço exposto na internet.
- **A mesa pode vir a usar o Yu-book como painel.** A conversa concluiu que duplicar interface,
  chat, modelos e teto numa segunda aplicação seria desperdício; o caminho provável é o Yu-book ser
  o painel e a execução de código acontecer fora dele. **Isso contraria o roteiro**
  (`docs/applied-ai-read-trip.md`, "O que ela não é") e ainda não foi decidido — quando for, exige
  entrada com motivo em `docs/historico.md`. Não é escopo deste plano.
- **Nada de raspar o LinkedIn.** Os termos de uso proíbem, e o risco é a conta onde o operador
  publica. A pesquisa externa usa busca web por API, fontes abertas e a gaveta de links.
- **Agentes e skills em formato portável.** Definição em Markdown com frontmatter, no espírito dos
  `.claude/agents/*.md` e `SKILL.md` do Agent SDK — o que se escreve no caderno pode ser reaproveitado
  pela oficina.

---

## Numeração

`CLAUDE.md` avisa que há várias numerações no repositório e que elas **não se convertem**. Este plano
**não cria uma numeração nova**: as cinco etapas continuam a sequência de letras da frente de IA
(Etapa A = PRD de IA fases 1 e 2; Etapa B = fase 3).

| Etapa | Conteúdo | Observação |
|---|---|---|
| **C** | marca de conteúdo gerado | já prevista pelo NO2 revisto do PRD de IA |
| **D** | agentes especialistas | nova |
| **E** | rotinas (pipelines) com "rodar agora" | nova |
| **F** | agendamento | nova; contraria decisão registrada |
| **G** | pesquisa externa | nova |

A **busca semântica** (Fase 4 do PRD de IA, RF-27 a RF-34) **continua pendente e fora desta
sequência** — não foi descartada; decide-se depois onde ela entra.

Os requisitos novos (RF/RN/RNF/CA) das Etapas D a G entram no próprio `docs/prd-ia-no-yu-book.md`,
em seções novas, **escritos dentro do plano de cada etapa** (não como passo separado). Comentário de
código cita "RF-xx do PRD de IA", como já é regra.

---

## Etapa C — A marca de conteúdo gerado

**Por que primeiro.** Tudo o que vem depois escreve no acervo. O NO2 do PRD de IA foi revisto em
2026-09-22: nota gerada por IA é permitida **desde que marcada no dado**, e "até ela existir, não se
gera nota". Sem a marca, o acervo perde a distinção entre o que o operador escreveu e o que a IA
escreveu.

**Escopo esperado.**

- **Dado:** marca de origem em nota e card (ex.: campo que diga "gerado por IA", com qual
  agente/modelo e quando; e se foi editado por humano depois). Migration aditiva.
- **Fronteira:** `packages/shared` (schemas de nota e card, e o que o MCP imprime em
  `formato.ts` — lembrar que editar texto ali muda o MCP e o chat ao mesmo tempo).
- **Escrita pelo chat:** as ferramentas de escrita existentes (`create_card` etc.) passam a gravar a
  marca quando quem escreve é o modelo. Avaliar ferramenta de **criar nota** pelo chat (Q-04 do PRD:
  "conversa vira nota") — é o primeiro uso natural da marca.
- **UI/UX:** a marca é visível **sem depender de cor** (RNF-09): etiqueta com o ícone de IA na lista
  de notas, no cabeçalho do editor, no card do kanban e na busca; filtro "geradas por IA" na lista;
  a ação "virar nota" na barra de ações de cada resposta do chat (o espaço já foi reservado ao lado
  do "Copiar" em `components/assistente/Conversa.tsx`). Editar à mão uma nota gerada muda a marca
  para "gerada e revisada" — decidir no plano.

**Pronto quando:** nada gerado entra no acervo sem marca, e a marca é visível em toda superfície.

**Como ficou (2026-09-24).** A exploração desmentiu três premissas acima, e o plano da etapa as
corrigiu:

- o chat **não escrevia**: as ações de escrita não tinham executor e o prompt dizia que ele só lia.
  Não havia "ferramenta existente" a marcar — a etapa **ligou** `create_card` e a nova
  `create_note` no chat, por decisão do operador, e deixou mover, apagar e restaurar fora;
- o caminho que já gravava texto de modelo era o **MCP** (`create_card`), que passou a informar o
  cliente e a marcar `via mcp`;
- o **RNF-09** citado é das fases de produto; o PRD de IA ganhou o seu, com o mesmo sentido.

Formatar com IA **não** marca (decisão do operador). "Gerada e revisada" ficou decidido: editar à
mão título ou corpo registra a revisão sem apagar a origem. Requisitos em
`prd-ia-no-yu-book.md`, seção 5.5 (RF-35 a RF-42, RN-10 a RN-12, RNF-09, CA-17 a CA-22).

---

## Etapa D — Agentes especialistas

**Objetivo.** Criar, editar e conversar com agentes que já carregam premissas.

**O que é um agente** (proposta a validar no plano):

- nome, ícone/cor, descrição curta (o que ele faz — é o que aparece nos seletores);
- **instruções** (prompt de sistema) em Markdown;
- **notas-base fixas**: notas do acervo que entram sempre no contexto dele — guia de posts,
  exemplos, posicionamento, palavras-chave. Premissa mora **no acervo**, editada no editor que já
  existe, ligada por `[[wikilink]]`;
- **fontes vivas**: consultas que ele sempre faz ao ser acionado — por exemplo, "os títulos e temas
  dos cards da coluna *Publicado* do quadro LinkedIn" como índice dos últimos posts, para não se
  repetir;
- **modelo** (reaproveitar o catálogo e os favoritos de `/ajustes`) e **ferramentas permitidas**
  (subconjunto das ações do acervo; a lista define o que ele pode — texto de instrução nunca
  concede ferramenta);
- formato de armazenamento compatível com Markdown + frontmatter (portabilidade para o Agent SDK).
  Decidir no plano se o agente é uma entidade própria ou um novo `kind` de nota — o `kind` reaproveita
  editor, busca e wikilinks e segue a decisão central do projeto ("uma entidade forte").

**Relação com o que existe.** `AI_TASKS` (`formatar`, `chat`) já é um registro rudimentar de agentes
(modelo + propósito + regra de ferramentas). Decidir no plano se `formatar` e `chat` viram os dois
primeiros agentes "de sistema" ou continuam à parte.

**UI/UX (o centro desta etapa).**

- **Área "Agentes"** com lugar na casca (provavelmente dentro de Assistente no trilho, com os
  agentes no painel contextual): galeria de cartões com ícone, nome, descrição, modelo e as
  notas-base como etiquetas.
- **Editor de agente** agradável: instruções num editor Markdown (reaproveitar o do projeto), as
  notas-base escolhidas por busca com `@`/wikilink, as fontes vivas por seletor de quadro e coluna,
  modelo pelo catálogo, ferramentas como interruptores com explicação do que cada uma permite, e uma
  **pré-visualização do contexto** (o que o agente vai receber, com estimativa de tokens e de custo
  por mensagem — o operador precisa ver o preço das premissas).
- **Conversar com um agente**: seletor de agente no Compositor do painel e da rota `/assistente`;
  a conversa guarda qual agente respondeu; o cabeçalho mostra o agente com identidade visual própria.
- Modelos prontos para começar ("Especialista em LinkedIn", "Marketing", "Revisor") que o operador
  duplica e ajusta — estado vazio que ensina.

**Como ficou (2026-09-24).** O operador escolheu **tabela própria** (`AiAgent`), e não um `kind` de
nota — a portabilidade saiu por exportação em Markdown com frontmatter; o agente é **fixo por
conversa**; e a área mora **dentro de Assistente** (`/assistente/agentes`), sem item novo no trilho.
`formatar` e `chat` continuaram fora do registro de agentes: o chat sem agente é o "Assistente". A
única fonte viva desta etapa é a coluna de quadro. Requisitos em `prd-ia-no-yu-book.md`, seção 5.6
(RF-43 a RF-53, RN-13 a RN-15, RNF-10, CA-23 a CA-28).

**Riscos.** Custo de contexto (notas-base entram em **todo** turno — mostrar e limitar); o teto de
gasto continua conferido a cada passo do laço (INV da frente de IA); DOMPurify em toda saída de
modelo (INV-09); as ferramentas definidas uma vez em `packages/shared` seguem a regra de propagação
para o MCP.

---

## Etapa E — Rotinas (pipelines) com "rodar agora"

**Objetivo.** Encadear agentes numa sequência fixa, disparada à mão.

**Desenho proposto.**

- A rotina é **orquestrada pelo código**, passo a passo — não é o modelo decidindo a quem delegar.
  Previsível, barata e depurável. (Delegação decidida pelo modelo pode vir depois, fora deste plano.)
- **Definição de rotina:** entrada (ex.: próximo card da coluna *Ideias* do quadro LinkedIn),
  sequência de passos (agente + instrução do passo: "escreva", "ajuste ao posicionamento",
  "revise"), saída (card novo na coluna *Aguardando publicar*, com o texto final na descrição, a marca
  da Etapa C e as observações de cada passo registradas).
- **Idempotência:** a ideia consumida sai da coluna de entrada ou é marcada — rodar duas vezes não
  gera dois posts da mesma ideia.
- **Registro de execuções:** cada execução guarda passos, modelo, tokens, custo, duração e erro.
  Sem ninguém olhando, é isso que substitui "ver acontecendo".
- **Nunca publica fora do Yu-book.** O resultado para em "Aguardando publicar".

**UI/UX.**

- Editor de rotina **visual**: os passos como cartões encadeados (entrada → agente → agente →
  agente → saída), reordenáveis por arraste com equivalente por teclado — reaproveitar o padrão de
  arraste do quadro de modelos (`components/ajustes/QuadroDeModelos.tsx`, INV-57: alça única).
- Botão **"Rodar agora"** com o progresso **ao vivo**, passo a passo (streaming como no chat: qual
  agente está trabalhando, o texto chegando), e cancelamento.
- **Histórico de execuções** com linha do tempo por execução e o texto de cada passo — ver o que o
  marketing mudou e o que o revisor apontou.
- O card gerado mostra de onde veio (rotina, execução) e leva ao histórico.

**Riscos.** Uma execução é várias chamadas; o teto precisa valer **por execução inteira** além do
diário. Execução longa não pode depender da aba aberta (decidir no plano: disparo pelo servidor com
progresso por fluxo, retomável na tela).

---

## Etapa F — Agendamento

**Objetivo.** Rodar uma rotina sozinha em horários definidos (ex.: terça e quinta às 8h).

**Decisão a registrar antes.** O roteiro diz que o Yu-book não tem trabalho assíncrono "por
decisão". O argumento para mudar: a rotina só toca o acervo, o pior caso continua sendo o do caderno
(um card ruim numa coluna), e o teto diário já existe. **Registrar em `docs/historico.md` com o
motivo** dentro do plano desta etapa.

**Escopo esperado.**

- Disparador: serviço de cron da própria Railway chamando a API (ou agendador interno — decidir no
  plano, pesando custo e confiabilidade), com autenticação de máquina e idempotência por janela
  (o mesmo horário não roda duas vezes).
- Fuso do usuário (já existe para o teto diário) decide o horário.
- Falha avisa: execução com erro aparece no Início e no histórico; nada falha calado.

**UI/UX.** Agenda amigável na própria rotina (dias da semana e horário, sem expressão cron à vista),
"próximas execuções" listadas, pausar e retomar com um clique, e o Início mostrando o que rodou
desde a última visita ("2 posts aguardando revisão").

---

## Etapa G — Pesquisa externa

**Objetivo.** Ideias de posts vindas de fora do acervo.

**Escopo esperado.**

- **Ferramenta de busca na web** para agentes: plugin de busca do OpenRouter ou API de busca
  (Tavily, Exa, Brave) — decidir no plano por custo e qualidade. Ferramenta com **domínios
  permitidos**, custo contado no teto, e fontes citadas (RN-05 do PRD: toda afirmação cita origem).
- **Gaveta de links como fonte**: a fila "ver depois" (posts e artigos que o operador salvou) vira
  entrada de uma rotina que propõe ideias na coluna *Ideias*. Zero risco, reaproveita o que existe.
- **Fontes abertas opcionais**: RSS de blogs e newsletters da área, Hacker News, Reddit.
- **Sem raspagem do LinkedIn** (ver decisões).
- Saída de rede escolhida por modelo exige as defesas de SSRF do projeto (skill `invariantes-yu-book`:
  defesas decididas pela origem do alvo).

**UI/UX.** Uma rotina "Garimpar ideias" pronta; as ideias chegam como cards com a fonte citada e um
resumo; aceitar ou descartar com um gesto; palavras-chave de pesquisa editáveis junto do agente de
marketing.

---

## Ordem e dependências

```
C (marca) ──► D (agentes) ──► E (rotinas) ──► F (agendamento)
                  └──────────────────────────► G (pesquisa externa; usa D, e E para a rotina de garimpo)
```

- **C** é pré-requisito de tudo que escreve.
- **D** sozinha já entrega valor: conversar com o especialista em LinkedIn.
- **E** antes de **F**: primeiro rodar à mão e confiar no resultado, depois agendar.
- **G** pode vir antes de **F** se o operador preferir — decidir ao planejar.

## O que fica fora deste plano

- Agentes de código, execução de repositório, shell, credenciais de repositório (a mesa).
- Publicar no LinkedIn ou em qualquer rede automaticamente.
- Delegação decidida pelo próprio modelo entre agentes.
- A busca semântica da Fase 4 do PRD de IA (pendente, sequência à parte).
