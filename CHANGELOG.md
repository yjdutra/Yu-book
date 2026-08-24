# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento
[semver](https://semver.org/lang/pt-BR/). Os identificadores `RF-xx`, `RN-xx` e `RNF-xx` resolvem
para os PRDs em [`docs/`](docs/).

`CHANGELOG.md` diz **o quê**. As decisões e os porquês ficam em
[`docs/historico.md`](docs/historico.md).

## [Não lançado]

_Nada pendente._

---

## [0.4.0] — 2026-08-24

**Etapa A da Fase 5**: tags de card no kanban e busca na lista de tags da barra lateral. As duas
saíram juntas porque são o mesmo gesto — filtrar uma lista de etiquetas por texto digitado —, e
implementá-las em sessões separadas as faria divergir. A Etapa **B** (precisão do arraste) saiu logo em seguida, na
`0.5.0`; a **C** (copiar nota e editor ao vivo) não começou: a Fase 5 **não** está concluída.

Os quatro pacotes vão a `0.3.0`. `packages/shared` mudou contrato — `CardSummary` e `cardInputSchema`
ganharam `tags` —, e a regra do projeto manda bumpar junto quem consome o contrato: `apps/api`,
`apps/web` e `apps/mcp`. Requisitos em [`docs/prd-fase-5-refino.md`](docs/prd-fase-5-refino.md).

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
