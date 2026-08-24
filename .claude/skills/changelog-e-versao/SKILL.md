---
name: changelog-e-versao
description: Formato do CHANGELOG.md e do histórico de contexto do Yu-book, regras de versionamento semver dos três pacotes e a convenção de mensagem de commit. Use ao fechar uma entrega, ao registrar o que mudou numa sessão de trabalho, ao decidir bump de versão ou ao propor mensagem de commit.
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
- Agenda no Google Calendar: botão "agendar" no card e na nota (Fase 5, RF-01 a RF-06).

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
## 2026-09-01 — Fase 5, decisão sobre autenticação do Google

Optamos por conta de serviço em vez de OAuth do usuário. OAuth exigiria tela de consentimento e
refresh token renovado toda semana enquanto o app estiver em "Testing" no Google Cloud.
O preço aceito: conta de serviço não envia convite a terceiros — irrelevante para agenda pessoal.

Ficou pendente: definir o que acontece se o calendário dedicado for apagado no Google.
```

O que entra: decisão tomada e a alternativa descartada, com o motivo; problema encontrado e como foi
resolvido; dívida assumida conscientemente; pendência que sobrou. O que **não** entra: narrativa de
"o que eu fiz hoje" sem decisão dentro.

## 3. Versão

Três pacotes com semver independente: `apps/api`, `apps/web` e `packages/shared`, cada um no seu
`package.json`. O `package.json` da raiz é privado e não acompanha.

| Bump | Quando |
|---|---|
| **major** | Quebra de contrato da API ou do pacote shared que obrigue mudança do outro lado |
| **minor** | Funcionalidade nova compatível — o caso de uma fase entregue |
| **patch** | Correção sem mudança de contrato |

Regras:

- **Mudança em `packages/shared` que altera um schema ou tipo bumpa os quatro pacotes**, porque
  todos consomem o contrato — `apps/api`, `apps/web` e também `apps/mcp`, que declara
  `@yu-book/shared` e importa os tipos direto. A regra dizia "os três" enquanto `apps/mcp` não
  existia.
- Uma fase entregue é **um** bump minor, não um por commit.
- O changelog nomeia a versão do conjunto. Quando os pacotes divergirem, cite o pacote na linha.

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
4. Atualize `README.md` e `PROPOSTA.md` se o status das fases mudou.
5. **Proponha** a mensagem de commit. Não crie tag nem release — quem executa é o operador.
