---
name: changelog-e-versao
description: Formato do CHANGELOG.md e do histórico de contexto do Yu-book, regras de versionamento semver dos quatro pacotes, a diferença entre a versão do conjunto no heading e a dos package.json, o que se faz com documento movido para docs/old e a convenção de mensagem de commit. Use ao fechar uma entrega, ao registrar o que mudou numa sessão de trabalho, ao decidir bump de versão ou ao propor mensagem de commit.
---

# Changelog, histórico e versão

Dois arquivos, dois propósitos. **`CHANGELOG.md` diz o quê. `docs/historico.md` diz por quê.**
Não misture: mudança sem decisão vai só no changelog; decisão sem mudança de código vai só no
histórico.

## 1. `CHANGELOG.md`

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versões em ordem cronológica
inversa, seções em português e só as que tiverem conteúdo.

```markdown
## [0.2.0] — 2026-09-01

### Adicionado
- Agenda no Google Calendar: botão "agendar" no card e na nota (Fase 6, RF-01 a RF-06).

### Alterado
- `GET /dashboard` passa a incluir o próximo evento agendado.

### Corrigido
- `Ctrl+K` dentro do editor abria a paleta além de inserir o link.

### Removido
- Tabela `company`, morta desde a migration inicial.
```

Regras:

- Uma linha por mudança, no **passado ou presente do indicativo**, descrevendo o efeito para quem
  usa — não o arquivo que mudou.
- Cite o identificador do requisito (`RF-xx`, `RN-xx`) quando existir. É o que liga o changelog aos
  PRDs de fase.
- Seção `Segurança` quando a mudança tiver efeito sobre a superfície de ataque.
- Nada de "refatoração interna" sem efeito observável — isso é histórico, não changelog.

## 2. `docs/historico.md`

Registro narrativo, uma entrada por sessão de trabalho, mais recente no topo:

```markdown
## 2026-09-01 — Fase 6, decisão sobre autenticação do Google

Optamos por conta de serviço em vez de OAuth do usuário. OAuth exigiria tela de consentimento e
refresh token renovado toda semana enquanto o app estiver em "Testing" no Google Cloud.
O preço aceito: conta de serviço não envia convite a terceiros — irrelevante para agenda pessoal.

Ficou pendente: definir o que acontece se o calendário dedicado for apagado no Google.
```

O que entra: decisão tomada e a alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que **não** entra: narrativa de
"o que eu fiz hoje" sem decisão dentro.

## 3. Versão

Quatro pacotes com semver independente: `apps/api`, `apps/web`, `apps/mcp` e `packages/shared`,
cada um no seu `package.json`. O `package.json` da raiz é privado e não acompanha.

| Bump | Quando |
|---|---|
| **major** | Quebra de contrato da API ou do pacote shared que obrigue mudança do outro lado |
| **minor** | Funcionalidade nova compatível — o caso de uma fase entregue |
| **patch** | Correção sem mudança de contrato |

Regras:

- **Mudança em `packages/shared` que altera um schema ou tipo bumpa os quatro pacotes**, porque
  todos consomem o contrato — `apps/api`, `apps/web` e também `apps/mcp`, que declara
  `@yu-book/shared` e importa os tipos direto.
- Uma fase entregue é **um** bump minor, não um por commit.

### 3.1 O heading do changelog não é a versão dos pacotes

**São dois números diferentes e eles já divergem.** O heading nomeia a versão do **conjunto**; o
`package.json` nomeia a do pacote. A `0.2.0` do conjunto foi uma entrega que não bumpou nenhum
pacote deployado (`apps/mcp` nasceu ali, em `0.1.0`), e desde então o heading corre **um minor à
frente**: `## [0.4.0]` é a entrega em que os quatro pacotes foram a `0.3.0`.

Por isso, ao abrir uma entrada nova:

1. Leia o **corpo** da última entrada do `CHANGELOG.md` — ele diz a que versão os pacotes foram.
2. O heading novo é o último heading + o bump, **nunca** o número que está no `package.json`.
3. Diga no corpo, em uma linha, para onde os pacotes vão. É o que mantém os dois números
   reconciliáveis pela próxima pessoa.

Olhar só o `package.json` produz um heading que já existe. Quando os pacotes divergirem entre si,
cite o pacote na linha.

É a regra 3 que decide se **duas etapas da mesma fase cabem numa entrada só**: cabem quando movem o
mesmo conjunto de pacotes, e não cabem quando movem conjuntos diferentes. A Fase 5 ficou em duas
entradas por isso — `[0.4.0]` (Etapa A, os quatro pacotes a `0.3.0`) e `[0.5.0]` (Etapa B, só
`apps/web`, a `0.4.0`). Fundidas, a linha do corpo teria que dizer "os quatro vão a `0.3.0` **e**
`apps/web` vai a `0.4.0`", e é exatamente essa linha que torna os dois números irreconciliáveis
depois. Nenhuma das duas ter sido lançada não muda nada: quem funde perde o registro de qual etapa
moveu qual pacote.

## 4. Commits

Conventional Commits, com escopo em português quando houver:

```
feat(links): título, miniatura e duração para vídeos do YouTube
fix(deploy): NODE_ENV só no runtime, não no build
docs: PRD da estrutura de agentes e skills
chore(deps): sobe o Prisma para 6.4
```

Tipos em uso: `feat`, `fix`, `docs`, `chore`, `perf`, `refactor`, `test`, `deploy`.

O histórico do repositório tem commits fora do padrão (`fixes`, `kambam`, `links`). **Não reescreva
o histórico** para corrigi-los — a convenção vale daqui para a frente.

## 5. Fechamento de entrega

1. Atualize `CHANGELOG.md` com a versão nova e a data.
2. Registre a decisão em `docs/historico.md`, se houve alguma.
3. Bumpe o `package.json` dos pacotes afetados.
4. Atualize `README.md` se o status das fases mudou. **Não** atualize os documentos de
   `docs/old/` — ver §6.
5. **Proponha** a mensagem de commit. Não crie tag nem release — quem executa é o operador.

## 6. `docs/old/` é registro de época

Documento movido para `docs/old/` **congela**. Não se corrige o status das fases, a estimativa nem o
escopo lá dentro: ele vale como o que se pensava naquela data, e reescrevê-lo apaga exatamente a
informação que justifica tê-lo guardado. `docs/old/PROPOSTA-inicial.md` ainda diz "Fases 0, 1 e 2
concluídas" — está certo assim.

O que **se** conserta é o link de quem aponta para ele. Ao mover um documento para `docs/old/`,
procure quem o citava e atualize o caminho:

```bash
grep -rn "PROPOSTA.md" --include="*.md" . | grep -v docs/old/
```

A verdade corrente sobre fases mora no `README.md` e no PRD da fase em andamento.
