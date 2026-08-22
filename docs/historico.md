# Histórico de contexto

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo. Aqui ficam as
**decisões** e os porquês; o que mudou fica em [`../CHANGELOG.md`](../CHANGELOG.md).

O que entra: decisão tomada e alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que não entra: relato de "o que
eu fiz hoje" sem decisão dentro.

---

## 2026-08-22 — Estrutura de agentes, skills e memória

Criada a estrutura `.claude/` do projeto: sete agentes, seis skills, memória persistente por agente
e `CLAUDE.md`. Requisitos em [`prd-agentes-e-skills.md`](prd-agentes-e-skills.md).

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
