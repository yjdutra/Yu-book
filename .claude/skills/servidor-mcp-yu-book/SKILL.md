---
name: servidor-mcp-yu-book
description: Decisões de projeto do servidor MCP do Yu-book (apps/mcp) — cliente da API e não do banco, orçamento de contexto das tools, resource direto versus template, identidade por uuid, uma formatação para duas superfícies, e a propagação obrigatória quando o domínio muda. Use antes de criar ou alterar qualquer tool, resource ou prompt, e sempre que uma feature de apps/api ou packages/shared mudar o domínio.
---

# O servidor MCP do Yu-book

`apps/mcp` expõe o Yu-book como servidor MCP. **Não é deployado**: roda na máquina do operador,
iniciado pelo cliente MCP, e fala HTTPS com a API.

Boa parte das decisões aqui é **o contrário do que um exemplo genérico de MCP faria**. Isso é
deliberado. Não "corrija" para o padrão sem ler o porquê.

## 1. A regra de sobrevivência: stdout é o protocolo

O transporte é stdio. **O stdout é o canal JSON-RPC.** Um `console.log` esquecido injeta lixo no meio
de uma mensagem e o cliente desconecta com um erro que não parece ter relação com log.

Todo diagnóstico vai para **stderr**, sem exceção. `src/verificar.ts` é a única exceção legítima —
é utilitário de linha de comando, não faz parte do servidor.

## 2. Cliente da API, nunca do banco

O servidor fala HTTP com `apps/api` (`src/cliente.ts`). Não importa o Prisma e não importa os
services.

Custa uma requisição a mais e herda de graça: escopo por `userId` vindo só do token, posse por
cadeia no kanban, 404 no lugar de 403, códigos de erro estáveis. Acessar o banco direto exigiria
reimplementar esse escopo fora dos services — e erro ali não dá exceção, vaza dado em silêncio.

Efeito colateral que se aproveita: trocar entre ambiente local e produção é trocar
`YUBOOK_API_URL` no `.env`. Nenhuma linha de código.

## 3. Orçamento de contexto

Quem paga a conta de uma resposta grande é a **janela de contexto do modelo**, que é muito menor e
mais cara que a rede.

- **Buscar é barato, ler é caro e explícito.** `search_notes` devolve só trecho; `get_note` devolve
  o corpo, de uma nota, de propósito.
- **A resposta é texto compacto, não JSON.** JSON de vinte resultados gasta cerca de um terço dos
  tokens em chaves e aspas repetidas, sem dizer nada ao modelo.
- **Nada de cap silencioso.** Se a resposta corta uma lista, ela **declara** o total real. Cap
  silencioso faz o modelo concluir que aquilo é tudo o que existe. Ver `TETO_DO_CATALOGO`
  em `src/resources/catalogos.ts`.
- **Medir antes de afirmar.** Um número de orçamento escrito sem medição é chute com aparência de
  rigor. Já aconteceu: "~40 bytes por nota" circulou num comentário e chegou a virar requisito antes
  de alguém conferir — a medição real deu ~100, porque o uuid sozinho tem 36 caracteres.

## 4. Tipos: sempre os do SDK

`CallToolResult` e `ReadResourceResult` vêm de `@modelcontextprotocol/sdk/types.js`. **Nunca escreva
o equivalente à mão** — o SDK exige uma assinatura de índice que um tipo caseiro não tem, e o
typecheck recusa com um erro longo e pouco óbvio.

Este erro já foi cometido duas vezes, com semanas de intervalo. Se você está prestes a declarar uma
interface para o retorno de um handler, procure o tipo no SDK primeiro.

## 5. As três primitivas — a diferença é quem aciona

| Primitiva | Quem aciona | Onde vive |
|---|---|---|
| Tool | O modelo decide, no meio da resposta | `src/tools/` |
| Resource | O usuário anexa, antes de perguntar (`@`) | `src/resources/` |
| Prompt | O usuário invoca (`/`) | `src/prompts/` |

**Tool e resource sobre o mesmo dado não são duplicação.** `get_board` e `yubook://board/{id}`
devolvem o mesmo texto de propósito: a superfície é que se duplica, nunca a implementação.

## 6. Resource: direto ou template

**Conjunto pequeno e limitado é listável; conteúdo que cresce sem limite não é.**

- **Direto** (`yubook://notas`, `//boards`, `//tags`, `//workspaces`) — devolve **índice**:
  identificador e rótulo. Nunca corpo, nunca trecho, nunca descrição. MIME `application/json`.
- **Template** (`yubook://nota/{id}`, `yubook://board/{id}`) — devolve o conteúdo.
  MIME `text/markdown`.

**O identificador na URI é o uuid, não o título.** Renomear uma nota reescreve os `[[…]]` das outras
notas, mas não há como reescrever uma URI já injetada no contexto de alguém.

O esquema `yubook://` e os campos do catálogo ficam **em português** — não atravessam a API. Nome de
tool fica em **inglês**, como caminho de rota (`search_notes`, `get_board`).

## 7. Uma formatação, duas superfícies

Tudo que monta texto de nota, card, quadro ou dashboard vive em **`src/formato.ts`**, e tool e
resource chamam a mesma função. Duas implementações divergem, e a divergência aparece como o mesmo
recurso com duas caras.

Verificação: ler `yubook://nota/{id}` e chamar `get_note` com o mesmo id devem produzir texto
**idêntico caractere a caractere**.

## 8. Prompt: instrução, não dado

- **Prompt não busca dado.** Devolve mensagens; quem busca é tool ou resource. Prompt que embute
  dado congela o dado no instante em que foi montado.
- **Prompt declara o que NÃO fazer.** É o que separa instrução testada de frase solta. Sem limites,
  o modelo preenche as lacunas e devolve algo plausível e errado. Ver `src/prompts/revisao.ts`:
  não inventar prazo, não sugerir ação que não existe como tool, não tratar a fila de links como
  urgência.
- A `description` aparece no menu do `/` — descreve **o resultado**, não a implementação.

## 9. Erro é texto que o modelo vai tentar contornar

Toda falha passa por `comErro` ou `comErroDeResource` (`src/erros.ts`), que traduz o código estável
da API em instrução acionável. Ramifica-se por `code`, nunca por `message`.

Resource **lança** em vez de devolver `isError` — o cliente precisa distinguir "não encontrei" de
"aqui está, e está vazio".

## 10. Tolerar uma API mais velha que o contrato

O servidor MCP e a API têm **ciclos de deploy independentes**. O servidor roda local com o contrato
recém-compilado; a API em produção pode ser semanas mais antiga.

Campo novo ausente na resposta é **omitido**, não emitido como `undefined`. Ver o catálogo em
`src/resources/catalogos.ts`.

## 11. Propagação — o que fazer quando o domínio muda

**Este é o motivo pelo qual existe um agente para este pacote.** Mudança de domínio em `apps/api` ou
`packages/shared` não quebra o MCP: ela o deixa **desatualizado em silêncio**. Nenhum teste falha,
nenhum typecheck reclama — a tool simplesmente para de contar a verdade inteira.

Precedente real: `updatedAt` existia na tabela `card` desde sempre e nunca chegava à superfície. Só
apareceu quando um prompt precisou dele.

Diante de um campo, entidade ou filtro novo no domínio, percorra:

- [ ] **`src/formato.ts`** — o campo novo deve aparecer no texto de nota, card, quadro ou dashboard?
- [ ] **Tools** — alguma tool deveria aceitá-lo como filtro? Alguma deveria devolvê-lo?
- [ ] **Resources diretos** — o campo pertence ao **índice** (identifica ou rotula) ou ao conteúdo?
      Se for conteúdo, **não entra** no catálogo.
- [ ] **Resource template novo?** Só se for conjunto que cresce sem limite e tiver endereço próprio.
- [ ] **Prompts** — algum fluxo existente fica melhor, ou pior, com o campo novo?
- [ ] **Orçamento** — o item do catálogo ficou mais caro? Meça, não estime.
- [ ] **`src/verificar.ts`** — vale reportar no diagnóstico?

Se a resposta for "nada muda", **diga isso explicitamente**. Silêncio é indistinguível de
esquecimento.

## 12. Como verificar

O inspetor oficial serve para explorar. Para **provar**, fale JSON-RPC direto no stdin — é o que
permite medir bytes, comparar saídas e validar invariantes:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/list","params":{}}' \
  '{"jsonrpc":"2.0","id":4,"method":"prompts/list","params":{}}' \
| node --env-file=apps/mcp/.env apps/mcp/dist/index.js
```

Sempre confira que **toda linha do stdout é JSON válido** — é a invariante do transporte.

```bash
pnpm --filter @yu-book/shared build    # se o contrato mudou
pnpm --filter @yu-book/mcp typecheck
pnpm --filter @yu-book/mcp build
pnpm --filter @yu-book/mcp verificar   # confirma ambiente, login e volume
```
