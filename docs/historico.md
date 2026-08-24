# Histórico de contexto

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo. Aqui ficam as
**decisões** e os porquês; o que mudou fica em [`../CHANGELOG.md`](../CHANGELOG.md).

O que entra: decisão tomada e alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que não entra: relato de "o que
eu fiz hoje" sem decisão dentro.

---

## 2026-08-24 — MCP, Etapas 2 e 4: o agente `mcp` e o portão que estava vermelho

Fechadas as três primitivas do protocolo em `apps/mcp`. Requisitos em
[`prd-mcp-resources-e-prompts.md`](prd-mcp-resources-e-prompts.md).

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
Guia em [`temp/proposta- mcp-inicial.md`](temp/proposta-%20mcp-inicial.md).

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
As decisões de escopo estão em [`../PROPOSTA.md`](../PROPOSTA.md) e os requisitos nos PRDs de fase.

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
