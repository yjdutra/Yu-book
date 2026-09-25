---
name: invariantes-yu-book
description: Catálogo verificável das invariantes do Yu-book — comportamentos que parecem erro para quem não os conhece e que quebram em silêncio se alterados. Cobre posse por cadeia no kanban, renumeração de posições, unicidade de título sem acento, wikilinks derivados, cirurgia de cache do autosave, as defesas de saída decididas pela origem do alvo (SSRF onde a URL vem do usuário ou do modelo, com a conexão presa ao IP conferido), escopo por usuário, a precisão do arraste do kanban e a alça única do quadro de modelos, o editor Markdown ao vivo (documento sem modelo intermediário, a textarea como mitigação de acessibilidade, os dois mapas de atalho) as assimetrias deliberadas — tag de nota contra tag de card, e estratégia de ordenação ligada nas colunas e desligada nos cards — o id de coluna impresso num lugar só — hoje em packages/shared —, sem o qual as tools de escrita ficam inalcançáveis, e a superfície de autenticação do transporte HTTP do MCP — rótulo de tipo no envelope cifrado, vida de token derivada e não fixada, identidade por requisição, o mapa de sessões que vaza calado, a trava de escrita em duas camadas e a sessão que se encerra quando o escopo do token muda, e a frente de IA — teto de gasto conferido antes de cada conexão e a cada passo do laço de ferramenta, cascata de custo de três degraus, guarda de wikilink por conjunto, o dia local gravado em vez de calculado, a fronteira do chat com o modelo fechada pelo compilador nos dois sentidos, a marca de conteúdo gerado, gravada só pelo servidor e que nunca some, e o motor de rotina, que decide pelo banco e não pelo Map em memória porque o deploy junta duas instâncias da API, e a agenda de rotina que as duas rodam juntas —, o id relacionado vindo do cliente conferido contra o usuário, e a montagem condicional de painel no front, que nunca entrega aberto: false, o laço do chat que não roda sem superfície visível, o enum cuja escolha só existe se a tela o percorrer, e os filtros de notas na URL, que toda navegação em /n precisa carregar. Use ao revisar qualquer diff, ao escrever teste de regressão e antes de alterar código nas áreas citadas.
---

# Invariantes do Yu-book

Cada item tem identificador estável (`INV-xx`) e aponta o `arquivo:linha` que o implementa. Ao
revisar, cite o identificador e a referência — não a impressão. **Id nunca é reusado**: número que
some da lista é invariante revogada, e o número morre com ela.

Regra de leitura: **se o código parece errado e há um comentário explicando, ele é deliberado.**
Confirme antes de "corrigir".

## O catálogo está em dois arquivos

Abaixo há só os títulos, para você escolher o que ler. **O título não é a invariante** — ele não
diz o que sustenta o comportamento nem onde ele mora. Antes de julgar um diff, abra o arquivo da
área que ele toca:

| O diff toca | Abra |
|---|---|
| `apps/api`, `packages/shared`, `apps/mcp`, migration, SQL | `referencias/servidor.md` |
| `apps/web` | `referencias/front.md` |
| os dois | os dois |

### Índice — servidor e contrato

| Id | Título |
|---|---|
| INV-01 | `userId` vem só do token |
| INV-02 | Id de outro usuário devolve 404, não 403 |
| INV-03 | Posse do kanban resolve por cadeia, na mesma query |
| INV-04 | Escrita condicional em vez de checar-depois-agir |
| INV-05 | `TOKEN_EXPIRED` e `UNAUTHORIZED` são códigos distintos de propósito |
| INV-06 | Refresh token: rotação e consumo atômico; reuso com janela de graça de 30 s |
| INV-07 | Login paga custo constante |
| INV-08 | A origem do alvo decide a defesa de saída; a de fora sai só por `pedirPublico`, presa ao IP conferido |
| INV-10 | Destaque de busca usa caracteres de controle, não HTML |
| INV-11 | Posições são contíguas, sempre |
| INV-12 | Card não atravessa board |
| INV-13 | Card arquivado sai da numeração |
| INV-14 | Excluir coluna com cards exige destino |
| INV-15 | Limite de WIP avisa e não bloqueia |
| INV-16 | Título é único por usuário, sem acento e só entre notas ativas |
| INV-17 | `note_link` é tabela derivada |
| INV-18 | O recálculo de links é condicional, e isso tem consequência |
| INV-19 | Excluir nota desfaz dois vínculos; restaurar refaz um só |
| INV-20 | Tag órfã é apagada sozinha |
| INV-21 | Excluir workspace apaga boards e cards, mas não notas |
| INV-22 | Link duplicado devolve o existente, não erro |
| INV-31 | Duas armadilhas de planner no SQL |
| INV-32 | Listagem de notas nunca carrega o corpo inteiro |
| INV-40 | `formatarQuadro` imprime o id de cada coluna, e é o único lugar que imprime |
| INV-41 | Envelope cifrado carrega rótulo de tipo, obrigatório nas duas pontas |
| INV-42 | A vida do token do MCP é derivada do vencimento do da API, nunca fixada |
| INV-43 | A identidade de quem chamou anda em `AsyncLocalStorage`, não na sessão |
| INV-44 | O par sessão/`McpServer` vaza em silêncio: cinco guardas, nenhuma supérflua |
| INV-45 | A trava de escrita tem duas camadas, e a de baixo vale nos dois transportes |
| INV-46 | Escopo que muda com a sessão viva encerra a sessão, nos dois sentidos |
| INV-47 | O teto de IA corta antes de qualquer conexão sair |
| INV-48 | Três degraus de custo, e o terceiro grava zero sem mover o teto |
| INV-49 | A guarda de wikilink compara conjunto, não lista ordenada |
| INV-50 | `ai_usage.local_day` é gravado, não calculado na consulta |
| INV-51 | `AiUsage.noteId` é `SetNull`, e o registro de gasto sobrevive à nota |
| INV-52 | A fronteira do chat com o modelo é fechada pelo compilador, nos dois sentidos |
| INV-58 | A marca de conteúdo gerado é gravada só pelo servidor, e nunca some |
| INV-59 | Id relacionado vindo do cliente é conferido contra o usuário; a FK só garante que existe |
| INV-60 | O motor de rotina decide pelo banco, nunca pelo `Map`: no deploy a API tem duas instâncias |

### Índice — front

| Id | Título |
|---|---|
| INV-23 | O autosave faz cirurgia de cache, não invalidação |
| INV-24 | `refetchType: "none"` é idioma do projeto |
| INV-25 | Renomear nota invalida tudo |
| INV-26 | O autosave guarda callbacks em ref de propósito |
| INV-27 | Trocar de nota descarta o timer pendente |
| INV-28 | Erro de título duplicado não é reintentado |
| INV-29 | Durante o arraste o estado local vence; fora dele, o servidor |
| INV-30 | O teclado do arraste é remapeado (a origem some com `opacity-0`; o `onKeyDown` compõe com o do sensor) |
| INV-33 | Com filtro de tag ativo no board, o arraste é desligado |
| INV-35 | O índice de inserção do arraste é contagem geométrica |
| INV-36 | Os cards não usam estratégia de ordenação; as colunas usam |
| INV-34 | Tag de nota e tag de card são coisas diferentes |
| INV-09 | Markdown só vira DOM depois do DOMPurify (nos dois caminhos) |
| INV-37 | O documento do editor ao vivo é a string de Markdown |
| INV-38 | Os quatro modos não se unificam: a `<textarea>` é a mitigação de acessibilidade |
| INV-39 | O editor tem dois mapas de atalho, e os dois param o evento |
| INV-53 | Painel montado dentro de `&&` nunca recebe `aberto: false` — ele desmonta |
| INV-54 | Membro de enum que exige escolha do usuário só existe se a tela o percorrer |
| INV-55 | Toda navegação dentro de `/n` carrega o `search`, onde moram os filtros |
| INV-56 | O laço do chat não roda sem superfície visível; na tela do chat, nada alterna o painel |
| INV-57 | No quadro de modelos a alça é o único ativador do arraste; menu e botão ficam fora |

---

## Como usar este catálogo numa revisão

1. Identifique quais arquivos o diff toca.
2. Abra o arquivo de referência da área e selecione as invariantes que cobrem esses arquivos.
3. Para cada uma, verifique se o diff a preserva, e cite `INV-xx` mais `arquivo:linha` ao apontar.
4. Classifique: **violação de invariante** bloqueia; divergência de convenção e observação, não.
5. **Diga o que você não pôde verificar.** O eixo é `apps/web`: **não existe teste de front neste
   projeto**, nenhum portão carrega uma `EditorView`, executa um arraste ou monta um painel. Toda
   invariante do `referencias/front.md` cai aqui — INV-29, INV-30, INV-33, INV-35, INV-36, INV-38,
   INV-39, INV-53, INV-54, INV-55, INV-56 e INV-57 são as que mais custam quando quebram. **INV-54
   é meio-coberta**: o `Record` total cai no typecheck; os `.map` da tela (colunas, menu, "Usado
   por…"), não. Se
   o diff as toca, nomeie-as e diga que faltam: uma revisão que omite isso passa por verde o que
   ninguém executou.
   **INV-40 deixou de estar nesta lista** em 2026-09-23: `apps/mcp/tests/fuso.test.ts:112` executa
   `formatarQuadro` de verdade e assere o id da coluna. Não o cite mais como descoberto.

Se encontrar uma invariante que o catálogo não cobre, emita-a no bloco `## Para a memória` — o
curador decide se ela entra aqui.

---

## Onde a sequência parou

A **Fase 5 fechou** com a Etapa C (botão de copiar, correção dos atalhos e o editor Markdown ao
vivo). Dela nasceram INV-37, INV-38 e INV-39; INV-09 ganhou a cláusula do segundo caminho de
renderização; as referências de INV-26 e INV-27 foram corrigidas. Nada do editor foi executado —
ver o passo 5 acima.

Depois dela, a **Etapa 3 do servidor MCP** (2026-08-26) deu escrita ao `apps/mcp` e trouxe INV-40.
Ela também **corrigiu INV-19**, que descrevia como irreversível algo que restaurar refaz: os
`[[…]]` voltam, o vínculo do card não. O título antigo já tinha induzido uma afirmação errada numa
`description` de tool. Esse é o modo de falha típico deste catálogo — o **título** é lido sozinho e
vira a fonte. Ao escrever um, confira que ele sozinho não afirma mais do que a invariante sustenta.

A **Etapa 4 do servidor MCP** (2026-09-01) deu a ele um segundo transporte e identidade própria, e
trouxe INV-41 a INV-44 — as quatro em `apps/mcp`, as três primeiras cobertas por teste. O
fechamento dela (2026-09-04) acrescentou INV-45 e INV-46, a segunda camada da trava de escrita e a
sessão que morre quando o escopo do token muda; no mesmo dia `apps/mcp` passou a ser deployado, e a
trava por host local deixou de proteger o serviço hospedado — que fala com a API de produção. Ela também
**estreitou INV-06**, que afirmava detecção de reuso incondicional: a janela de graça de 30 s existe
por causa deste servidor MCP, e o custo dela está declarado no comentário do código. Vale a lição
geral do INV-41: **cifra igual mais forma compatível não separa nada.** Um envelope que se abre com
a mesma chave e cabe no formato do outro *é* o outro, e o compilador não vê diferença nenhuma até
alguém pedir o rótulo.

A **Etapa A da frente de IA** (2026-09-22) trouxe INV-47 a INV-51 — todas em `apps/api`, todas
cobertas por `apps/api/tests/assistente.test.ts`, que levou a suíte de 58 para 97 testes. É a
**Fase 5 do roteiro de IA**, não a Fase 5 de produto. Ela **reescreveu INV-08**, que dizia "o único
ponto em que o servidor abre conexão para fora" — afirmação que já era falsa antes desta entrega:
`youtube.service.ts` era o segundo desde a Fase 3. A lição não é sobre SSRF: **invariante que conta
coisas envelhece por aritmética, e em silêncio.** Ninguém reconfere um censo ao acrescentar um
arquivo. O que se registra é o **eixo** que decide o comportamento — aqui, de onde vem o alvo —
porque eixo se confere item a item, e censo não.

A **Etapa B da frente de IA** (2026-09-23) entregou o chat ancorado (§5.3 de
`docs/prd-ia-no-yu-book.md`, a **Fase 3 do PRD de IA**) e trouxe INV-52 e INV-53. Ela **estreitou
INV-47**: "antes de qualquer conexão" virou "antes de **cada** conexão", porque uma mensagem do chat
é até cinco chamadas ao provedor — a unidade que o teto cobra mudou sem o texto da invariante mudar.
E produziu a falha de referência mais cara deste catálogo: **INV-40 apontava para um arquivo
apagado.** `apps/mcp/src/formato.ts` virou `packages/shared/src/formato.ts` e a invariante seguiu
citando o caminho antigo — nenhum typecheck, teste ou revisão acusa uma referência de skill que
morreu. **Arquivo que muda de pacote quebra toda invariante que o cita, e quebra calado**: ao mover
código entre pacotes, grepe o `.claude/` pelo caminho antigo antes de fechar a entrega. A mesma
entrega deu portão a INV-40 pela primeira vez, de carona num teste de fuso — portão ganho de carona
se perde de carona. O que ela **não** teve foi tela conferida à mão, e quem achou o buraco foi o
operador usando o chat: tarefa nova no enum, sem coluna em `/ajustes` (INV-54). Nenhum portão
deste repositório podia achá-la — **não é defeito que teste de API veja, é a interface não
oferecendo um controle.**

A **Etapa 2 do redesenho de UI** (2026-09-24, quinta numeração: não é Etapa B nem fase alguma)
trocou a barra lateral por trilho e painel contextual e pôs os filtros de notas na URL — daí INV-55.
Ela tirou o ouvinte de atalhos de `Aplicacao.tsx` e apagou `Navegacao.tsx`: INV-39 apontava para
linhas que deixaram de existir, a mesma falha calada do INV-40, agora por extração de arquivo.
A **Etapa 3** (2026-09-24) apagou `PainelChat.tsx` e levou o fluxo do chat para um provedor sempre
montado: a limpeza de desmonte que INV-53 citava deixou de proteger o gasto, e a regra virou INV-56.
A **Etapa 4** (2026-09-24) partiu `AjustesPage.tsx` em `components/ajustes/` e trocou a lista de
modelos por um arraste novo: INV-54 mudou de arquivo inteiro, INV-30 ganhou o segundo lugar e
nasceu INV-57. A **Etapa 5** (2026-09-24), a última, pôs gaveta e paleta dentro do `Dialogo`: o
`return null` que INV-53 citava nos dois saiu deles. INV-30 ganhou a composição do `onKeyDown` — o
defeito dos favoritos, e o mesmo ainda aberto no card do kanban — e INV-56 o avesso em `/assistente`.

A **Etapa C da frente de IA** (2026-09-24, §5.5 do PRD de IA — etapa sem fase dele) trouxe a marca
de conteúdo gerado e ligou a escrita do chat: ele passou a **criar** card e nota, a pedido. Daí
INV-58 e INV-59, esta achada de carona — o `workspaceId` da nota nunca tinha sido conferido contra o
usuário, e o modelo passou a escrevê-lo. Ela **estreitou INV-52**: "o chat não tem executor de
escrita" deixou de valer, e a primeira condição trocou de `FERRAMENTAS_DE_LEITURA` para uma lista
explícita, conferida também na execução. O censo foi o que envelheceu — "nove ações", "as quatro de
escrita" —, em skill, agente e `CLAUDE.md` ao mesmo tempo.

A **Etapa D da frente de IA** (2026-09-24, §5.6 do PRD de IA) trouxe os agentes especialistas e
nenhuma invariante nova: **estreitou quatro**. INV-52 ganhou a terceira condição (`permitidas`, sem
padrão) e a vizinha RN-13; INV-59 chegou a agente, nota-base e coluna, com três estreitamentos que
parecem furo; INV-47, a cláusula do contexto que vai em todo passo; INV-56, o quinto ponto e a
troca de `/assistente` por `naTelaDoChat`. Esta última é a lição: **um predicado usado como nome**
— "está no assistente" — morava em três arquivos, e uma rota nova dentro da área mudou o que ele
significava sem mudar uma letra dele. Quando a resposta certa depende de *para quê* se pergunta
(qual painel contextual? o chat está à vista?), são duas funções.

A **Etapa E da frente de IA** (2026-09-24, §5.7 do PRD de IA) trouxe as rotinas — o primeiro
trabalho de fundo da API — e INV-60. Estreitou INV-04 (a condição "não existe outra", que só um
índice garante), INV-47 (o teto por execução; e a conferência mudou para `passoNoProvedor`, o que
envelheceu de uma vez toda referência ao `chat.service.ts`), INV-52 (a rotina só lê), INV-58 (a
união por `via`) e INV-59; INV-54 trocou de lista — a percorrida não é mais o enum inteiro. A
lição é a do INV-60: o plano da etapa registrava "o `Map` exige instância única" como exigência, e
a Railway não a cumpre no deploy. **Premissa de infraestrutura escrita como requisito é invariante
a conferir, não fato** — as migrations do pulso e do índice vieram depois da primeira.

A **emenda da Etapa E** (2026-09-25) deu à rotina entrada por **pedido** e saída em **nota**, e
nenhuma invariante nova: estreitou INV-04 (RN-18 só na entrada por coluna), INV-58 e INV-60 (a
saída é card **ou** nota, e cada tentativa de título é um ponto de criação a conferir) e INV-59 (o
workspace da nota). Tipo novo num eixo multiplica os sítios de cada cláusula que falava do único.

A **Etapa F da frente de IA** (2026-09-25, §5.8 do PRD de IA) agendou as rotinas: um relógio
dentro da API, nas duas instâncias ao mesmo tempo. Nenhuma invariante nova — **estreitou INV-60**
(a linha `pulada` como estado do horário, a guarda de `updatedAt`, a agenda fora do `Set`) e
**INV-04**, que descrevia RN-19 como `findFirst` + `create` — e o comentário do schema dizia "só a
criação grava `em_andamento`": a conversão da `pulada` também grava, pelo mesmo índice. A lição é a do "só": **cláusula de exclusividade é censo
de um**, e envelhece no primeiro sítio novo que faz a mesma coisa por outro caminho.

A **Etapa G da frente de IA** (2026-09-25, §5.9 do PRD de IA) deu ao agente pesquisa externa —
busca na web pelo provedor e `open_page` — e **reescreveu INV-08** pela segunda vez: "só
`titulo.service.ts`… a única superfície de SSRF" era censo de um, e o segundo consumidor veio do
**modelo**, não do usuário. A saída virou `pedirPublico`, e com ela a cláusula nova, a conexão presa
ao IP conferido. Estreitou INV-10 e INV-17 (texto de terceiro), INV-47 e INV-48 (a busca), e INV-52,
cuja primeira condição virou o teto do agente. A lição: **o que conta "quem escolhe o alvo" também
envelhece** — o eixo era certo, a lista de quem escolhe, não.

O que ainda não tem código: **busca semântica** (§5.4). A **Fase 6 de produto** (Google Calendar) segue sendo o item de
**menor prioridade**, e o intervalo até ela é o tempo em que este catálogo mais envelhece: reconfira
as referências antes de confiar nelas. Quando a fase vier, três invariantes ficam na linha de tiro:

- **INV-08.** A agenda abre um ponto de saída novo, e ele nasce com classe a decidir: host do
  Google fixado pelo ambiente cai na segunda classe, mas id de calendário vindo do cliente entra no
  **caminho** da URL. Classifique antes de escrever, pela regra do próprio INV-08.
- **INV-01 a INV-04.** Credencial de terceiro por usuário é dado novo sob escopo: id de calendário
  vindo do cliente cai na mesma regra do `userId`, e a escrita continua sendo condicional.
- **INV-21.** `Event` já existe em `schema.prisma` sem rota nem service. A regra de cascata que a
  agenda escolher (evento morre com o card? com a nota?) entra aqui no mesmo diff.
