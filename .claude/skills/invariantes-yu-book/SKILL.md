---
name: invariantes-yu-book
description: Catálogo verificável das invariantes do Yu-book — comportamentos que parecem erro para quem não os conhece e que quebram em silêncio se alterados. Cobre posse por cadeia no kanban, renumeração de posições, unicidade de título sem acento, wikilinks derivados, cirurgia de cache do autosave, defesas de SSRF e escopo por usuário. Use ao revisar qualquer diff, ao escrever teste de regressão e antes de alterar código nas áreas citadas.
---

# Invariantes do Yu-book

Cada item tem identificador estável (`INV-xx`) e aponta o arquivo que o implementa. Ao revisar,
cite o identificador e o `arquivo:linha` — não a impressão.

Regra de leitura: **se o código parece errado e há um comentário explicando, ele é deliberado.**
Confirme antes de "corrigir".

---

## Segurança e escopo

**INV-01 — `userId` vem só do token.** Nenhuma query aceita id de usuário vindo do body, da query
string ou de parâmetro de rota. `request.userId` é preenchido exclusivamente por
`apps/api/src/lib/authenticate.ts`. Toda query filtra por ele.

**INV-02 — Id de outro usuário devolve 404, não 403.** Existência de recurso alheio não é revelada.
Documentado em `apps/api/src/modules/kanban/kanban.service.ts:36` (RNF-15).

**INV-03 — Posse do kanban resolve por cadeia, na mesma query.** `card` e `board_column` **não têm
coluna `user_id`**. A posse vem de `card → column → board.userId`, dentro do próprio `where` — nunca
"busca primeiro, confere depois". Adicionar `user_id` a essas tabelas é mudança de modelo, não
conveniência.

**INV-04 — Escrita condicional em vez de checar-depois-agir.** Mutação usa
`updateMany`/`deleteMany` com o escopo no `where` e testa `count === 0` para lançar 404. Elimina a
corrida entre checagem e efeito.

**INV-05 — `TOKEN_EXPIRED` e `UNAUTHORIZED` são códigos distintos de propósito.** O primeiro dispara
o refresh no front; o segundo derruba a sessão. Fundir os dois cria laço de login.
`apps/api/src/lib/authenticate.ts`.

**INV-06 — Refresh token roda com rotação, detecção de reuso e consumo atômico.** Cada refresh
revoga o apresentado; um token revogado que reaparece derruba **todas** as sessões do usuário; a
atomicidade vem de `updateMany({ where: { id, revokedAt: null } })` com checagem de `count`.
`apps/api/src/modules/auth/auth.service.ts`.

**INV-07 — Login paga custo constante.** Email inexistente ainda calcula um argon2 descartável, para
que o tempo de resposta não revele quais emails existem.

**INV-08 — Defesas de SSRF na leitura de título.** É o único ponto em que o servidor abre conexão
para endereço vindo de fora. `apps/api/src/modules/links/titulo.service.ts`: orçamento total de
2000 ms (`:14`), máximo de 512 KB e só HTML (`:15`), máximo de 3 saltos (`:16`), `redirect: "manual"`
com **revalidação de IP a cada salto** (`:156`), e `destinoPermitido` (`:74`) exigindo que todos os
registros A/AAAA sejam públicos. Falhar aqui **nunca** impede o link de ser salvo.

**INV-09 — Markdown só vira DOM depois do DOMPurify.** `renderMarkdown` em
`apps/web/src/lib/markdown.ts:83` sanitiza; é a única razão de `dangerouslySetInnerHTML` ser
aceitável. Nunca contorne.

**INV-10 — Destaque de busca usa caracteres de controle, não HTML.** `HL_START` e `HL_END` são
os caracteres de controle `U+0001` e `U+0002` (`packages/shared/src/busca.ts:9-10`), para que
nenhuma nota consiga forjar marcação. O front nunca renderiza HTML de resultado de busca.

---

## Integridade de dados

**INV-11 — Posições são contíguas, sempre.** `position` é reescrito como `0,1,2…` num único
`UPDATE … FROM (VALUES …)` dentro de transação: `renumerarCards`
(`apps/api/src/modules/kanban/kanban.service.ts:82`), `renumerarColunas` (`:92`) e
`renumerarFavoritos` (`apps/api/src/modules/links/links.service.ts`). Não existe empate nem buraco.
Posição fora do intervalo é **clampada**, não recusada.

**INV-12 — Card não atravessa board.** Mover para coluna de outro board é recusado com 422.

**INV-13 — Card arquivado sai da numeração.** Arquivar renumera os que ficam; desarquivar devolve ao
**fim** da mesma coluna. Arquivado não move, não aparece em busca, não conta em contador nem em prazo.

**INV-14 — Excluir coluna com cards exige destino.** Sem `moveCardsTo` nem `deleteCards`, a API
recusa com 409 `COLUNA_COM_CARDS` (`kanban.service.ts:367`). Cards movidos vão para o fim do destino
preservando a ordem relativa.

**INV-15 — Limite de WIP avisa e não bloqueia.** A API armazena `wipLimit` e **nunca o valida**. É
sinalização visual. Coberto por teste explícito em `apps/api/tests/kanban.test.ts`.

**INV-16 — Título é único por usuário, sem acento e sem caixa, só entre notas ativas.** Garantido
pelo índice parcial `note_title_unico_idx`
(`apps/api/prisma/migrations/20260814004639_notas_fase_1/migration.sql:24`) sobre
`lower(immutable_unaccent(title)) WHERE deleted_at IS NULL`. A lixeira pode conter título repetido —
e por isso restaurar pode falhar com 409.

**INV-17 — `note_link` é tabela derivada.** Nunca editada diretamente: é recalculada a partir dos
`[[…]]` do conteúdo. Renomear uma nota reescreve os `[[antigo]]` das que apontavam para ela, apenas
no padrão exato entre colchetes.

**INV-18 — O recálculo de links é condicional, e isso tem consequência.** Só roda quando o conjunto
de alvos muda (`mesmosLinks`, `apps/api/src/modules/notes/notes.service.ts:192`). Por causa dessa
otimização, criar, renomear e restaurar precisam chamar `reconstruirEntradas` (`:177`) para religar
quem já apontava para aquele título — inclusive quando a nota-alvo nasce **depois** do `[[…]]`.

**INV-19 — Excluir nota desfaz vínculos e restaurar não os refaz.** O soft delete apaga os
`note_link` nos dois sentidos e zera o `noteId` dos cards. Restaurar traz tags e conteúdo, mas o
card continua desvinculado (RN-07).

**INV-20 — Tag órfã é apagada sozinha.** Toda operação que desassocia roda `limparTagsOrfas`. Tags
são sempre `trim().toLowerCase()`. Renomear tag para nome existente **funde** as duas, não dá erro.

**INV-21 — Excluir workspace apaga boards e cards, mas não notas.** FK de nota é `SET NULL`; a de
board é `CASCADE`. É por isso que `Workspace` carrega `boardCount` e `cardCount` — a confirmação
precisa dizer quanto se perde.

**INV-22 — Link duplicado devolve o existente, não erro.** Proteção contra clique duplo. A unicidade
é sobre a URL já normalizada. Só favoritos têm ordem manual; "ver depois" ordena por `createdAt desc`
e tentar mover dá 422.

---

## Desempenho e comportamento do front

**INV-23 — O autosave faz cirurgia de cache, não invalidação.** `useAtualizarNota`
(`apps/web/src/lib/notas.ts:190`) compara o `NoteDetail` em cache com a resposta e invalida só o que
mudou de fato; salvamento de corpo — o caso comum, a cada 800 ms — invalida **nada**, apenas costura
a resposta nas listas (`costurarNasListas`, `:153`). Levou o autosave de 6 requisições por pausa para
1. Trocar isso por `invalidateQueries` amplo é regressão de desempenho, não simplificação.

**INV-24 — `refetchType: "none"` é idioma do projeto.** Marca `search` e `dashboard` como obsoletos
sem refazer a requisição (`notas.ts:124,230`). Aparece também em `kanban.ts` e `links.ts`.

**INV-25 — Renomear nota invalida tudo.** Se o título mudou, invalida `titles` e **todas** as notas,
porque o servidor reescreveu `[[…]]` em outras notas (RN-03).

**INV-26 — O autosave guarda callbacks em ref de propósito.** `apps/web/src/lib/useAutosave.ts:31-34`.
O objeto de mutation do TanStack tem identidade nova a cada render; sem as refs, o efeito de debounce
reagenda para sempre e **o autosave nunca dispara**. Constantes: 800 ms de debounce (`:10`), 5 s de
reintento (`:11`), máximo 3 tentativas (`:12`).

**INV-27 — Trocar de nota descarta o timer pendente.** Sem isso, o conteúdo da nota anterior vaza
para a nova.

**INV-28 — Erro de título duplicado não é reintentado.** É erro de entrada do usuário; reintentar
martela a API.

**INV-29 — Durante o arraste, o estado local vence; fora dele, o servidor vence.**
`apps/web/src/components/Quadro.tsx:80`. Remover essa guarda faz o card saltar de volta no meio do
arraste.

**INV-30 — O teclado do kanban é remapeado.** `Espaço` pega e solta, `Esc` cancela
(`Quadro.tsx:90`), porque `Enter` está reservado para abrir o card. O `PointerSensor` exige 4 px de
deslocamento (`:85`) para que clique continue sendo clique.

**INV-31 — Duas armadilhas de planner no SQL.** `porSimilaridade`
(`apps/api/src/modules/notes/search.service.ts:274`) repete o termo inline de propósito: movê-lo para
um CTE faz o planner perder o índice (comentário em `:282`). E `left(content_md, N::int)` precisa do
cast porque o Prisma envia número como `bigint`.

**INV-32 — Listagem de notas nunca carrega o corpo inteiro.** O trecho é truncado **no banco** em 600
caracteres. Trazer `contentMd` para a lista multiplica o tráfego por página.

---

## Como usar este catálogo numa revisão

1. Identifique quais arquivos o diff toca.
2. Selecione as invariantes que cobrem esses arquivos.
3. Para cada uma, verifique se o diff a preserva, e cite `INV-xx` mais `arquivo:linha` ao apontar.
4. Classifique: **violação de invariante** bloqueia; divergência de convenção e observação, não.

Se encontrar uma invariante que o catálogo não cobre, emita-a no bloco `## Para a memória` — o
curador decide se ela entra aqui.
