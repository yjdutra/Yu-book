# PRD — Yu-book: estrutura `.claude` de agentes, skills e memória

**Versão:** v0.3 (draft) · **Autor:** yjdutra · **Data:** 2026-08-22 · **Status:** rascunho

> Este PRD não entrega funcionalidade de produto. Entrega a **infraestrutura de trabalho** que os
> agentes usam para construir o Yu-book sem redescobrir o projeto a cada sessão. Os PRDs de fase
> (`docs/prd-fase-*.md`) descrevem o que o Yu-book faz; este descreve como ele é construído.

---

## 1. Contexto e problema

O Yu-book chegou ao fim da Fase 4 com um volume de conhecimento tácito que não cabe mais na cabeça
de quem abre o repositório — humano ou agente. O código carrega decisões que parecem erro para quem
não as conhece: a posse de um card resolve pela cadeia `card → column → board.userId` e id alheio
devolve **404, não 403**; `porSimilaridade` repete o termo inline de propósito porque movê-lo para
um CTE faz o planner perder o índice; `normalizarTitulo` em `packages/shared` precisa espelhar
exatamente `lower(immutable_unaccent(title))` do índice do Postgres, e divergir não gera erro — gera
wikilink quebrado em silêncio.

Hoje `.claude/` contém um único arquivo, `settings.json`, com uma permissão. Não há `CLAUDE.md`, não
há agentes, não há skills. Cada sessão de trabalho recomeça do zero: relê os PRDs, redescobre que o
domínio é nomeado em português enquanto a fronteira da API é em inglês, e arrisca "padronizar" o que
era decisão.

O custo é assimétrico. Uma sessão desinformada não produz um erro visível — produz um `dark:` que
reintroduz o flash de tema, uma invalidação de cache que devolve o autosave de 1 para 6 requisições
por pausa, ou um `console.log` que ninguém revisa porque **não existe ESLint, Prettier nem CI neste
repositório**. Os únicos portões automáticos são `pnpm typecheck` e `pnpm --filter @yu-book/api test`.

O problema secundário é o oposto: memória e skills que crescem sem controle passam a custar contexto
em toda sessão e a contradizer o código. Um registro obsoleto é pior que registro nenhum, porque é
seguido com confiança.

---

## 2. Objetivos

- **O1** — Um agente especialista abre uma tarefa da sua área e produz código aderente às convenções
  do Yu-book **sem reler os quatro PRDs de fase**.
- **O2** — As invariantes do projeto ficam registradas em forma verificável, com identificador
  estável, de modo que uma revisão possa apontar a violação e não a opinião.
- **O3** — O que cada agente aprende entre sessões sobrevive à sessão, e é submetido a um crivo antes
  de virar registro permanente.
- **O4** — A memória e as skills têm limite de tamanho e política de expurgo declarados, de modo que
  crescer exige decisão explícita.
- **O5** — Cada entrega passa a deixar rastro versionado: o que mudou, em que versão, e por quê.

### 2.1 Métricas de sucesso

- **M1** — Agentes registrados: **0 hoje → 9**, todos carregando sem erro de parsing.
- **M2** — Skills do projeto: **0 hoje → 7**, cada uma com `SKILL.md` e descrição acionável.
- **M3** — Tamanho de cada `MEMORY.md` após curadoria: **≤ 2 KB e ≤ 60 linhas**. Medido por
  `wc -c -l`.
- **M4** — Suítes de teste de integração: **5 hoje → 7**, com `auth` e `organizacao` cobertas,
  dentro de 30 dias da aprovação deste PRD.
- **M5** — `CHANGELOG.md`: **não existe hoje → existe**, cobrindo retroativamente as Fases 0 a 4.
- **M6** — `CLAUDE.md`: **não existe hoje → existe**, com **≤ 60 linhas**, apontando para as skills
  em vez de duplicá-las.

---

## 3. Não-objetivos

- **NO1** — Não instalar ESLint, Prettier ou Biome. A ausência é decisão vigente do projeto; os
  agentes trabalham com ela, não contra ela.
- **NO2** — Não criar pipeline de CI, GitHub Actions ou hooks de git. O portão continua sendo
  `pnpm typecheck` e `pnpm --filter @yu-book/api test` rodados sob demanda.
- **NO3** — Não implementar a Fase 5 (Google Calendar) nem qualquer funcionalidade de produto. Este
  PRD não altera uma linha de `apps/` ou `packages/`.
- **NO4** — Não construir servidor MCP próprio. O curso de MCP é estudo paralelo; se resultar em
  servidor, entra por PRD próprio.
- **NO5** — Não configurar hooks em `settings.json` (`PreToolUse`, `PostToolUse` etc.).
- **NO6** — Não mover a skill `gerar-prd` de `~/.claude/skills/` para o projeto. Ela é genérica e
  serve outros repositórios; duplicá-la cria duas verdades.
- **NO7** — Não criar agente de segurança dedicado. SSRF, cadeia de tokens e escopo por usuário são
  invariantes catalogadas e cobradas pelo `revisor`; o `/security-review` nativo continua disponível.
- **NO8** — Não resolver as dívidas técnicas que o `zelador` cataloga. Catalogar é o escopo aqui;
  resolver é decisão sua, tarefa a tarefa.

---

## 4. Personas e usuários-alvo

**Yuri (operador).** Único humano. Abre uma sessão, delega a um agente, revisa e aprova. Não quer
repetir contexto. Frequência: diária durante fase ativa.

**Os nove agentes (consumidores).** Cada um recebe um recorte do projeto. Três escrevem código de
aplicação (`backend`, `frontend`, `testes`), dois só leem e relatam (`revisor`, `zelador` em modo
padrão), dois escrevem apenas documentação e configuração (`versionador`, `curador`).

**Hierarquia:** o `curador` é o único agente com permissão de escrita em `.claude/`. Nenhum outro
agente edita a própria memória, a própria definição ou uma skill. Essa assimetria é o crivo.

---

## 5. Requisitos funcionais

### 5.1 Estrutura de arquivos

- **RF-01** — A estrutura vive inteiramente sob `.claude/`, nos caminhos:
  `.claude/agents/<nome>.md`, `.claude/skills/<nome>/SKILL.md`,
  `.claude/agent-memory/<nome>/MEMORY.md`.
- **RF-02** — `CLAUDE.md` fica na raiz do repositório e é versionado.
- **RF-03** — Todos os arquivos de `.claude/` são versionados no git. Nenhum entra no `.gitignore`.
- **RF-04** — Todo conteúdo é escrito em português do Brasil, espelhando o idioma dos PRDs, dos
  comentários do código e do README.

### 5.2 Agentes — comuns a todos

- **RF-05** — Cada agente tem `name`, `description`, `tools`, `model: inherit` e um corpo de
  instruções em `.claude/agents/<nome>.md`.
- **RF-06** — O `description` declara **quando usar** e **quando não usar**, em frases que um
  orquestrador consiga discriminar sem ler o corpo.
- **RF-07** — Cada agente tem um diretório de memória em `.claude/agent-memory/<nome>/MEMORY.md`,
  criado com um cabeçalho e a seção vazia, nunca ausente.
- **RF-08** — Nenhum agente, exceto o `curador`, escreve em `.claude/`. A restrição é declarada no
  corpo do agente.
- **RF-09** — Todo agente que descobre algo digno de registro emite, ao fim da resposta, um bloco
  delimitado `## Para a memória` com itens em uma linha cada. O agente **não** persiste o bloco.
- **RF-10** — Todo agente que altera código executa `pnpm typecheck` antes de reportar conclusão, e
  relata a saída real. Agente que altera `apps/api` executa também
  `pnpm --filter @yu-book/api test`.

### 5.3 Agente `backend`

- **RF-11** — Especialista em `apps/api`. Cobre rotas Fastify, services, Prisma, SQL cru, migrations
  e o contrato com `packages/shared`.
- **RF-12** — Pré-carrega as skills `convencoes-yu-book`, `contrato-compartilhado` e
  `migracao-prisma`.
- **RF-13** — Respeita a separação de duas camadas: `*.routes.ts` faz `schema.parse` → chama service
  → devolve; `*.service.ts` concentra regra e acesso ao Prisma. Rota que importa `prisma` é
  violação.
- **RF-14** — Não introduz código de erro fora de `ERROR_CODES` em `packages/shared/src/errors.ts`
  sem antes adicioná-lo lá.

### 5.4 Agente `frontend`

- **RF-15** — Especialista em `apps/web`. Cobre componentes React, TanStack Query, Tailwind v4,
  @dnd-kit e o design system manual.
- **RF-16** — Pré-carrega `convencoes-yu-book`, `contrato-compartilhado` e `design-system-yu-book`.
- **RF-17** — Não instala biblioteca de componentes (shadcn, Radix, Headless UI, Material) nem
  biblioteca de ícones. Ícone novo é SVG desenhado em `apps/web/src/components/Icones.tsx`.
- **RF-18** — Não usa a variante `dark:` do Tailwind em nenhuma circunstância. Cor nova exige
  entrada no bloco `@theme` **e** em `:root[data-tema="claro"]` de `apps/web/src/index.css`.
- **RF-19** — Atalho de teclado novo exige entrada correspondente em
  `apps/web/src/components/Atalhos.tsx`, que é a fonte única dos atalhos documentados.

### 5.5 Agente `revisor`

- **RF-20** — Somente leitura. Ferramentas: `Bash, Read, Grep, Glob, Skill`. Sem `Edit` e sem
  `Write`.
- **RF-21** — Pré-carrega `invariantes-yu-book` e `convencoes-yu-book`.
- **RF-22** — Revisa mudanças contra o catálogo de invariantes, citando o identificador da
  invariante violada e o `arquivo:linha`.
- **RF-23** — Distingue três severidades: **violação de invariante** (quebra comportamento
  documentado), **divergência de convenção** (destoa da casa) e **observação** (nem uma coisa nem
  outra). Só a primeira bloqueia.
- **RF-24** — Aponta, não corrige. Nenhuma sugestão vem em forma de patch aplicável.

### 5.6 Agente `testes`

- **RF-25** — Escreve e mantém testes em `apps/api/tests/`. Pré-carrega `invariantes-yu-book` e
  `convencoes-yu-book`. A infraestrutura de teste (Vitest, `apoio.ts`, banco real, `fileParallelism`)
  é descrita no corpo do próprio agente, não em skill — é conhecimento de um consumidor só.
- **RF-26** — Não altera código de `apps/api/src`, `apps/web/src` ou `packages/shared/src` para
  fazer um teste passar. Divergência entre teste e código é **reportada**, não acomodada.
- **RF-27** — Cada teste descreve conceitualmente o que verifica, em português, no nome do caso.
- **RF-28** — Usa exclusivamente os auxiliares de `apps/api/tests/apoio.ts` para criar usuário,
  subir a app, chamar rota e limpar. Não cria caminho paralelo de setup.

### 5.7 Agente `zelador`

- **RF-29** — Varre o repositório em busca de duas classes de achado: **resquício de
  desenvolvimento** (`console.log`, import morto, variável não usada, componente/hook sem
  referência, arquivo temporário, rota órfã) e **dívida técnica declarada** (entidade modelada sem
  uso, promessa de PRD não cumprida, duplicação de constante entre arquivos).
- **RF-30** — Opera em **modo relatório por padrão**. Só remove quando o chamador pedir remoção
  explicitamente, e um item por vez.
- **RF-31** — Carrega uma lista de exclusão — *código que parece morto e não é* — e nunca reporta um
  item dela como resquício. A lista inclui, no mínimo: os modelos `Company` e `Event` do
  `schema.prisma`, o parâmetro `permitido` de `titulo.service.ts`, e os comentários que documentam
  decisões de planner do Postgres.
- **RF-32** — Não refatora, não renomeia e não altera comportamento.

### 5.8 Agente `versionador`

- **RF-33** — Mantém `CHANGELOG.md` na raiz, no formato **Keep a Changelog** (seções `Adicionado`,
  `Alterado`, `Corrigido`, `Removido`), com versões em ordem cronológica inversa.
- **RF-34** — Mantém `docs/historico.md`, um registro narrativo por sessão de trabalho: o que foi
  feito, que decisão foi tomada e por quê. O `CHANGELOG.md` diz **o quê**; o histórico diz **por
  quê**.
- **RF-35** — Versiona os três pacotes em **semver** independente: `apps/api`, `apps/web` e
  `packages/shared`, cada um no seu `package.json`.
- **RF-36** — Propõe mensagens de commit em **Conventional Commits** (`feat(escopo):`,
  `fix(escopo):`, `docs:`, `chore:`), resgatando a convenção que os commits recentes já usam
  parcialmente.
- **RF-37** — Preenche o `CHANGELOG.md` retroativamente para as Fases 0 a 4, a partir dos PRDs de
  fase e do histórico do git, marcando-as como uma única versão `0.1.0` já entregue.
- **RF-38** — Não cria tag git nem publica release. Propõe; quem executa é o operador.

### 5.9 Agente `publicador`

> Acrescentado na v0.2, em 2026-08-22, a pedido do operador. A separação em relação ao
> `versionador` é de risco, não de assunto: um edita markdown, o outro publica em produção.

- **RF-38a** — Responsável por commit, push e deploy. Somente leitura em arquivo: ferramentas
  `Bash, Read, Grep, Glob, Skill`, sem `Edit` e sem `Write`.
- **RF-38b** — Executa os portões (`pnpm typecheck` e, se `apps/api` mudou, a suíte da API) **antes**
  de commitar, e relata a saída real. Portão vermelho interrompe.
- **RF-38c** — **Nunca executa `git push` sem pedido explícito no turno.** No Yu-book, push para
  `master` é deploy em produção sem etapa de aprovação. Autorização para commitar não é autorização
  para publicar.
- **RF-38d** — Nunca reescreve histórico publicado: sem `rebase`, sem `push --force`, sem
  `reset --hard`.
- **RF-38e** — Recusa-se a commitar se `git status` mostrar qualquer `.env`.
- **RF-38f** — Antes do push, avisa o que o push dispara, conhecendo as Watch Paths: mudança em
  `packages/shared` ou `pnpm-lock.yaml` reconstrói **os dois** serviços; migration nova é aplicada em
  produção no boot; `VITE_API_URL` do front é lido em tempo de build.
- **RF-38g** — Depois de publicar, confirma `/health` e `/health/db` em produção, e reporta
  `degraded` imediatamente.
- **RF-38h** — Não escreve `CHANGELOG.md` nem `docs/historico.md` — verifica que o `versionador` já
  passou e avisa quando não passou.

### 5.10 Agente `mcp`

> Acrescentado na v0.3, em 2026-08-24. Preenche uma lacuna do desenho original: `apps/mcp` existia
> sem dono. E cobre um risco que nenhum portão pega — mudança de domínio não quebra o servidor MCP,
> deixa-o desatualizado **em silêncio**.

- **RF-38i** — Especialista em `apps/mcp`. Escreve **apenas** dentro desse pacote; se a superfície do
  MCP precisar de um campo que a API não expõe, reporta ao operador em vez de alterar `apps/api`.
- **RF-38j** — Pré-carrega `servidor-mcp-yu-book`, `convencoes-yu-book` e `contrato-compartilhado`.
- **RF-38k** — Opera em dois modos: **A**, criar ou alterar uma primitiva a pedido; **B**,
  verificar propagação depois que o domínio mudou.
- **RF-38l** — No modo B, percorre a lista de propagação da skill item por item e, **quando nada
  precisa mudar, declara isso explicitamente**. Silêncio é indistinguível de esquecimento.
- **RF-38m** — O `revisor` cobra a mesma verificação como observação quando o diff toca
  `packages/shared/src`, para que a propagação seja pega mesmo se ninguém chamar o agente `mcp`.

### 5.11 Agente `curador`

- **RF-39** — Único agente com escrita em `.claude/`. Não altera código de aplicação.
- **RF-40** — Persiste os blocos `## Para a memória` emitidos pelos demais agentes, aplicando a
  doutrina de destino (RN-01).
- **RF-41** — Audita cada `MEMORY.md` contra o código vigente e **remove** o registro que o código
  já contradiz, em vez de corrigi-lo.
- **RF-42** — Mantém cada `MEMORY.md` dentro do limite de RNF-01, promovendo a skill o que virou
  estável e descartando o resto.
- **RF-43** — Decide promoção: memória recorrente e prescritiva vira skill; regra que todo agente
  precisa saber vira linha em `CLAUDE.md`; porquê que pertence a uma linha específica vira
  comentário no código — e nesse caso o curador **abre a tarefa**, não escreve o comentário.
- **RF-44** — Registra as próprias decisões de curadoria em `.claude/agent-memory/curador/MEMORY.md`,
  para que a doutrina seja aplicada de forma estável entre sessões.

### 5.12 Skills

- **RF-45** — `convencoes-yu-book` — nomenclatura de domínio em português e fronteira de API em
  inglês; imports internos com extensão `.js`; comentário explica o porquê e cita `RF-xx`/`RN-xx`
  quando aplicável; 2 espaços, aspas duplas, ~100 colunas; `strict` e `noUncheckedIndexedAccess`
  ligados; ausência deliberada de linter.
- **RF-46** — `contrato-compartilhado` — o que vai para `packages/shared` e o que não vai; obrigação
  de reexportar em `src/index.ts`; obrigação de rodar `pnpm --filter @yu-book/shared build` antes de
  typecheckar os apps; `ERROR_CODES` como union type; e o catálogo dos espelhamentos frágeis
  (`normalizarTitulo` ↔ índice SQL, `moverNoBoard` ↔ renumeração do servidor, `normalizarUrl` ↔
  unicidade de link).
- **RF-47** — `invariantes-yu-book` — catálogo verificável, com identificador estável por
  invariante, cobrindo no mínimo: posse por cadeia e 404 em vez de 403; renumeração contígua em
  transação; título único sem acento e só entre notas ativas; `note_link` como tabela derivada;
  cirurgia de cache no autosave; autosave apoiado em refs; defesas de SSRF; destaque de busca por
  caracteres de controle; escopo por `userId` vindo só do token.
- **RF-48** — `migracao-prisma` — criar e nomear migration; os objetos SQL que vivem fora do Prisma
  (`pt_unaccent`, `immutable_unaccent`, trigger de `search_vector`, índice único parcial); o fato de
  `prisma migrate deploy` rodar no boot de produção; `count(*)` retornando `bigint`; SQL cru sempre
  parametrizado e com cast explícito.
- **RF-49** — `design-system-yu-book` — rampa `ink-*`/`accent-*` como semântica e não como cor;
  proibição do `dark:`; obrigação de definir cor nos dois temas; ícones 16×16 `currentColor` em
  `Icones.tsx`; `GuardaDesktop` abaixo de 1024px; estado nunca comunicado por cor sozinha; e a
  invariante da seção recolhível — o resumo precisa revelar o filtro que continua ativo.
- **RF-50a** — `servidor-mcp-yu-book` — decisões do servidor MCP: cliente da API e não do banco,
  orçamento de contexto, resource direto versus template, identidade por uuid, uma formatação para
  duas superfícies, tolerar API mais velha que o contrato, e a lista de propagação.
- **RF-50** — `changelog-e-versao` — formato do `CHANGELOG.md`, formato do `docs/historico.md`,
  regra de bump semver por pacote e a convenção de commit.
- **RF-51** — Cada `SKILL.md` tem frontmatter com `name` e `description`, e a `description` declara
  os gatilhos de acionamento em linguagem que o modelo consiga casar com um pedido do usuário.

### 5.13 `CLAUDE.md`

- **RF-52** — `CLAUDE.md` contém apenas o que quebra o projeto se ignorado: identificação do
  monorepo e dos três pacotes; a regra de nomenclatura PT/EN; a obrigação de buildar `shared` antes
  de typecheckar; os comandos de verificação; a ausência de linter; e ponteiros para as skills.
- **RF-53** — `CLAUDE.md` não duplica conteúdo de skill. Um item que já está numa skill vira, no
  máximo, uma linha de ponteiro.

---

## 6. Requisitos não-funcionais

- **RNF-01 Tamanho da memória** — Cada `.claude/agent-memory/<nome>/MEMORY.md` tem no máximo **2 KB
  e 60 linhas**. Estourar o limite obriga o curador a promover ou descartar, não a expandir.
- **RNF-02 Tamanho do `CLAUDE.md`** — Máximo **60 linhas**.
- **RNF-03 Tamanho de skill** — Cada `SKILL.md` tem no máximo **300 linhas**. Conteúdo maior é
  quebrado em arquivo de referência no diretório da skill, carregado sob demanda.
- **RNF-04 Idioma** — Todo arquivo produzido por este PRD é escrito em português do Brasil.
- **RNF-05 Verificabilidade** — Todo item de skill que descreve uma invariante aponta o
  `arquivo:linha` que a implementa, para que a auditoria do curador possa confirmá-la ou refutá-la.
- **RNF-06 Não-regressão** — A execução deste PRD não altera nenhum arquivo em `apps/`,
  `packages/`, `prisma/` ou `pnpm-lock.yaml`. Verificável por `git diff --stat`.
- **RNF-07 Isolamento de escrita** — Um agente que não seja o `curador` não declara `Write` com
  destino em `.claude/`. A restrição é textual, não mecânica.
- **RNF-08 Custo de contexto** — A soma de `CLAUDE.md` mais a memória de um único agente não passa
  de **4 KB**, para que o custo fixo por sessão seja desprezível diante do código lido.

---

## 7. Modelo de dados

A "entidade" aqui é o arquivo. Três tipos, com ciclo de vida distinto.

| Artefato | Caminho | Escrito por | Ciclo de vida |
|---|---|---|---|
| Definição de agente | `.claude/agents/<nome>.md` | curador | Estável; muda por decisão |
| Skill | `.claude/skills/<nome>/SKILL.md` | curador | Estável; versionada em git |
| Memória | `.claude/agent-memory/<nome>/MEMORY.md` | curador | Volátil; auditada e expurgada |
| Contexto mínimo | `CLAUDE.md` | curador | Estável; ≤ 60 linhas |
| Changelog | `CHANGELOG.md` | versionador | Cresce por entrega |
| Histórico | `docs/historico.md` | versionador | Cresce por sessão |

**Frontmatter de agente:**

```yaml
---
name: <nome>
description: >
  Quando usar. Quando não usar.
tools: Bash, Read, Grep, Glob, Edit, Write, Skill
model: inherit
---
```

**Estrutura de `MEMORY.md`:**

```markdown
# Memória — <agente>

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas
- ...

## O que já nos mordeu
- ...

## Decisões em vigor
- ...
```

---

## 8. Fluxos principais

**Fluxo A — Tarefa de funcionalidade**
1. O operador delega ao `backend` ou ao `frontend`.
2. O agente carrega as skills pré-declaradas e lê a própria memória.
3. Implementa, roda `pnpm typecheck` e — se tocou a API — a suíte de testes.
4. Reporta o resultado real e emite `## Para a memória` se descobriu algo.
5. O bloco fica na transcrição. Nada é persistido ainda.

**Fluxo B — Revisão antes de fechar**
1. O operador chama o `revisor` sobre o diff.
2. O revisor confronta o diff com `invariantes-yu-book`, citando identificador e `arquivo:linha`.
3. Classifica cada achado em violação, divergência ou observação.
4. O operador decide o que corrigir; a correção volta ao agente especialista.

**Fluxo C — Fechamento de marco**
1. O `zelador` varre e entrega o relatório de resquício e dívida.
2. O `versionador` atualiza `CHANGELOG.md`, `docs/historico.md` e os três `package.json`, e propõe a
   mensagem de commit.
3. O `curador` audita as memórias, persiste os blocos pendentes, expurga o obsoleto e promove o que
   estabilizou.

**Fluxo D — Curadoria de um registro novo**
1. O curador lê o bloco `## Para a memória`.
2. Aplica a doutrina (RN-01) e escolhe um destino.
3. Se o destino for memória, verifica o limite de RNF-01 antes de escrever.
4. Se escrever estourar o limite, promove ou descarta primeiro — nunca amplia o limite.
5. Registra a decisão na própria memória.

---

## 9. Regras de negócio

- **RN-01 Doutrina de destino.** Todo conhecimento tem **um** destino, escolhido nesta ordem:
  **skill** se for prescritivo e estável (*"como se faz aqui"*); **`MEMORY.md`** se for descoberto e
  volátil (*"o que aprendemos, onde fica"*); **`CLAUDE.md`** se um agente que o ignore quebrar o
  projeto na primeira ação; **comentário no código** se sumir junto com o código que descreve.
  Registro em dois destinos é duplicação, e a duplicação é resolvida removendo do destino mais fraco.
- **RN-02 Expurgo, não correção.** Memória que o código contradiz é **removida**. Se o fato novo
  merece registro, ele entra como registro novo — assim a memória nunca carrega uma correção que
  ninguém consegue datar.
- **RN-03 Limite não negocia.** Estourar RNF-01 obriga promoção ou descarte. O limite não é elevado
  para acomodar conteúdo.
- **RN-04 Separação de escrita.** Só o `curador` escreve em `.claude/`. Só o `versionador` escreve
  em `CHANGELOG.md` e `docs/historico.md`. Só `backend`, `frontend` e `testes` escrevem código — e
  `testes` apenas em `apps/api/tests/`.
- **RN-05 Teste não acomoda código.** Divergência entre teste e implementação é reportada ao
  operador. O agente de testes não ajusta a expectativa para o verde.
- **RN-06 Relatório antes de remoção.** O `zelador` nunca remove no mesmo turno em que descobre. A
  remoção é um segundo pedido, explícito e item a item.
- **RN-07 Dívida não é lixo.** Entidade modelada e não usada, promessa de PRD não cumprida e código
  mantido por decisão não são resquício. Vão para o relatório de dívida, com a decisão pendente
  nomeada.
- **RN-08 A convenção vence o hábito.** Diante de conflito entre o padrão do mercado e o padrão
  observável no repositório, vale o do repositório. Divergir exige pedir a decisão ao operador.

---

## 10. Critérios de aceitação

- **CA-01** (RF-01, RF-03) — Dado o repositório após a execução, quando se roda `git status`, então
  `.claude/agents/`, `.claude/skills/` e `.claude/agent-memory/` aparecem como novos arquivos
  rastreados, nenhum ignorado.
- **CA-02** (RF-05, M1) — Dado o comando `/agents`, quando executado, então os nove agentes aparecem
  listados, sem erro de parsing de frontmatter.
- **CA-02a** (RF-38a) — Dado `.claude/agents/publicador.md`, quando se lê o frontmatter, então
  `tools` não contém `Edit` nem `Write`.
- **CA-03** (RF-07) — Dado cada um dos nove agentes, quando se verifica
  `.claude/agent-memory/<nome>/MEMORY.md`, então o arquivo existe, com cabeçalho e seções vazias.
- **CA-04** (RNF-01) — Dado qualquer `MEMORY.md`, quando se roda `wc -c -l`, então o resultado é
  ≤ 2048 bytes e ≤ 60 linhas.
- **CA-05** (RNF-02, M6) — Dado `CLAUDE.md`, quando se roda `wc -l`, então o resultado é ≤ 60.
- **CA-06** (RNF-06) — Dado o fim da execução deste PRD, quando se roda
  `git diff --stat -- apps packages pnpm-lock.yaml`, então a saída é vazia.
- **CA-07** (RF-20) — Dado `.claude/agents/revisor.md`, quando se lê o frontmatter, então `tools`
  não contém `Edit` nem `Write`.
- **CA-08** (RF-31) — Dado que o `zelador` varre o repositório, quando encontra os modelos `Company`
  e `Event` sem uso, então os reporta na seção de dívida técnica com a decisão pendente nomeada, e
  **não** na seção de resquício.
- **CA-09** (RF-33, RF-37, M5) — Dado `CHANGELOG.md` após a execução, quando se lê, então existe uma
  entrada `0.1.0` cobrindo as Fases 0 a 4, com as seções do formato Keep a Changelog.
- **CA-10** (RF-47, RNF-05) — Dado `invariantes-yu-book`, quando se toma qualquer invariante do
  catálogo, então ela cita um `arquivo:linha` existente no repositório.
- **CA-11** (RF-09) — Dado um agente que descobriu um fato novo, quando termina a resposta, então a
  resposta contém um bloco `## Para a memória`, e nenhum arquivo em `.claude/agent-memory/` foi
  modificado por ele.
- **CA-12** (RF-51) — Dada cada uma das seis skills, quando se lê o frontmatter, então `name` casa
  com o nome do diretório e `description` cita ao menos um gatilho de acionamento.
- **CA-13** (RN-01) — Dado um registro presente em uma skill, quando se procura o mesmo conteúdo em
  `CLAUDE.md` ou em algum `MEMORY.md`, então ele não aparece — no máximo uma linha de ponteiro.

---

## 11. Dependências, restrições e riscos

### Dependências

- Claude Code com suporte a subagentes em `.claude/agents/` e skills em `.claude/skills/`.
- Os quatro PRDs de fase em `docs/`, que são a fonte dos identificadores `RF-xx`/`RN-xx` citados
  pelas invariantes.
- A skill `gerar-prd` em `~/.claude/skills/`, mantida fora do repositório (NO6).

### Restrições técnicas

- Sem linter e sem CI (NO1, NO2): a verificação é `pnpm typecheck` e a suíte da API, rodadas sob
  demanda.
- Os testes de integração falam com um Postgres real via `DATABASE_URL` e rodam com
  `fileParallelism: false`. Um agente que os invoque precisa do banco no ar.
- `packages/shared` precisa estar compilado para que os apps typecheckem.

### Riscos

| Risco | Mitigação |
|---|---|
| **Memória vira depósito** e o custo de contexto cresce a cada sessão | RNF-01 com limite duro e RN-03, que proíbe elevar o limite |
| **Skill contradiz o código** depois de um refactor | RNF-05 obriga citar `arquivo:linha`, o que torna a auditoria do curador mecânica |
| **Sete agentes viram burocracia** e o operador para de usá-los | Ondas de entrega (seção 12): os quatro de uso diário primeiro; os de fechamento de marco depois |
| **O `zelador` remove carga útil** confundindo dívida com lixo | RF-31 (lista de exclusão), RN-06 (relatório antes de remoção) e RN-07 (dívida ≠ lixo) |
| **Dois agentes escrevem o mesmo arquivo** e se sobrescrevem | RN-04 separa a escrita por dono; nenhum arquivo tem dois donos |
| **A convenção PT/EN é "corrigida"** por um agente bem-intencionado | RF-45 a torna explícita e RN-08 dá a regra de desempate |

---

## 12. Entregas e fases

**Onda 1 — fundação.** `CLAUDE.md`, as seis skills, o `curador` e sua memória. Sem isto, os demais
agentes não têm o que carregar.

**Onda 2 — uso diário.** `backend`, `frontend`, `revisor`, `testes`, com as respectivas memórias
inicializadas vazias.

**Onda 3 — fechamento de marco.** `zelador`, `versionador` e `publicador`. O `versionador` executa, no mesmo
passo, o preenchimento retroativo do `CHANGELOG.md` (RF-37) e a criação de `docs/historico.md`.

**Onda 4 — validação.** Roda `pnpm typecheck`, confere `git diff --stat` contra RNF-06, mede os
limites de CA-04 e CA-05, e verifica CA-10 amostrando invariantes do catálogo.

---

## 13. Questões em aberto

- ~~**Q-01**~~ — **Resolvida em 2026-08-22.** `memory: project` é campo suportado e mapeia para
  `.claude/agent-memory/<nome>/`, exatamente a estrutura prevista em RF-07.
- ~~**Q-02**~~ — **Resolvida em 2026-08-22.** `skills:` é campo suportado e injeta o conteúdo
  completo da skill no contexto do subagente na inicialização; o subagente continua podendo invocar
  skills não listadas pela ferramenta `Skill`.
- **Q-03** — O `zelador` deve varrer `docs/` em busca de PRD desatualizado — o README, por exemplo,
  afirma "cinco migrations" quando existem seis? Impacto: amplia o escopo do agente de código para
  documentação. Responsável: operador.
- **Q-04** — O que fazer com a tabela `company`, morta desde a migration inicial? Já era decisão
  pendente registrada em `PROPOSTA.md`; o `zelador` a herda como item de dívida, mas a decisão
  continua sua. Responsável: operador.

---

## 14. Suposições assumidas

- ~~**S-01**~~ — **Confirmada em 2026-08-22** contra a documentação oficial, na versão 2.1.143.
  `memory` aceita `user`, `project` ou `local`; `skills` recebe uma lista de nomes de skill. Deixa
  de ser suposição.
- **S-02** — As Fases 0 a 4 correspondem a uma única versão `0.1.0` no changelog retroativo, e não a
  cinco versões separadas. Justificativa: os três `package.json` estão em `0.1.0` e nunca houve
  release; reconstruir cinco versões seria inventar histórico que não existiu.
- **S-03** — O `revisor` complementa o `/code-review` nativo em vez de substituí-lo. Justificativa: o
  nativo cobre correção genérica e não conhece o domínio; a divisão estava no briefing.
- **S-04** — O limite de 2 KB por memória é adequado ao volume atual do projeto. Justificativa: é
  ordem de grandeza compatível com "onde ficam as coisas + o que nos mordeu" para um repositório de
  ~7 mil linhas de front e uma API de sete módulos. Reavaliar se a Fase 6 (busca semântica) entrar.
