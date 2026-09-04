---
name: invariantes-yu-book
description: Catálogo verificável das invariantes do Yu-book — comportamentos que parecem erro para quem não os conhece e que quebram em silêncio se alterados. Cobre posse por cadeia no kanban, renumeração de posições, unicidade de título sem acento, wikilinks derivados, cirurgia de cache do autosave, defesas de SSRF, escopo por usuário, a precisão do arraste do kanban, o editor Markdown ao vivo (documento sem modelo intermediário, a textarea como mitigação de acessibilidade, os dois mapas de atalho) as assimetrias deliberadas — tag de nota contra tag de card, e estratégia de ordenação ligada nas colunas e desligada nos cards — o id de coluna que o servidor MCP imprime num lugar só, sem o qual as tools de escrita ficam inalcançáveis, e a superfície de autenticação do transporte HTTP do MCP — rótulo de tipo no envelope cifrado, vida de token derivada e não fixada, identidade por requisição, o mapa de sessões que vaza calado, a trava de escrita em duas camadas e a sessão que se encerra quando o escopo do token muda. Use ao revisar qualquer diff, ao escrever teste de regressão e antes de alterar código nas áreas citadas.
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
| INV-08 | Defesas de SSRF na leitura de título |
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
| INV-30 | O teclado do kanban é remapeado (e o vão usa `opacity-0`) |
| INV-33 | Com filtro de tag ativo no board, o arraste é desligado |
| INV-35 | O índice de inserção do arraste é contagem geométrica |
| INV-36 | Os cards não usam estratégia de ordenação; as colunas usam |
| INV-34 | Tag de nota e tag de card são coisas diferentes |
| INV-09 | Markdown só vira DOM depois do DOMPurify (nos dois caminhos) |
| INV-37 | O documento do editor ao vivo é a string de Markdown |
| INV-38 | Os quatro modos não se unificam: a `<textarea>` é a mitigação de acessibilidade |
| INV-39 | O editor tem dois mapas de atalho, e os dois param o evento |

---

## Como usar este catálogo numa revisão

1. Identifique quais arquivos o diff toca.
2. Abra o arquivo de referência da área e selecione as invariantes que cobrem esses arquivos.
3. Para cada uma, verifique se o diff a preserva, e cite `INV-xx` mais `arquivo:linha` ao apontar.
4. Classifique: **violação de invariante** bloqueia; divergência de convenção e observação, não.
5. **Diga o que você não pôde verificar.** Não existe teste de front neste projeto, e nenhum portão
   carrega uma `EditorView` nem executa um arraste. INV-29, INV-30, INV-33, INV-35, INV-36, INV-38 e
   INV-39 só se confirmam à mão. **INV-40 também**: a suíte de `apps/mcp` passou a falar JSON-RPC
   e cobre a superfície das tools (INV-45), mas o `fetch` dela é substituído, então nada executa a
   formatação — o id de coluna some sem um teste cair. Se o diff as toca, nomeie-as e diga que
   faltam: uma revisão que omite isso passa por verde o que ninguém executou.

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

A próxima é a **Fase 6** (Google Calendar), declarada pelo operador como o item de **menor
prioridade**. O intervalo até lá é o tempo em que este catálogo mais envelhece: reconfira as
referências antes de confiar nelas. Quando a fase vier, três invariantes ficam na linha de tiro:

- **INV-08.** Hoje o `titulo.service.ts` é o **único** ponto em que o servidor abre conexão para
  fora. A agenda cria um segundo, e a frase "único ponto" precisa ser reconferida junto — não
  reescrita por conveniência.
- **INV-01 a INV-04.** Credencial de terceiro por usuário é dado novo sob escopo: id de calendário
  vindo do cliente cai na mesma regra do `userId`, e a escrita continua sendo condicional.
- **INV-21.** `Event` já existe em `schema.prisma` sem rota nem service. A regra de cascata que a
  agenda escolher (evento morre com o card? com a nota?) entra aqui no mesmo diff.
