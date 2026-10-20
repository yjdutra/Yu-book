# Plano — Gaveta de links com pastas, foco ajustável e assistente rápido no celular

Pedido de 2026-10-20. Quatro frentes pequenas, num plano só, executadas em fases com o ciclo de
sempre: plano da fase → desenvolver → testes pontuais → próxima fase; teste geral no fim.

## Decisões tomadas antes de começar

- **Gaveta de links (web):** um campo só no topo, que filtra e, quando o texto é URL, salva como
  favorito ou ver depois — some o formulário fixo do rodapé. As ações do favorito saem do canto
  sobreposto e vão para um "⋯" com o `Menu` de `base/`. **Pastas só em favoritos, um nível só**:
  tiles no começo da grade; clicar abre a pasta, com o caminho "Favoritos › Pasta"; soltar o link
  num tile o põe na pasta, soltar no "Favoritos" do caminho o tira. Excluir pasta devolve os links
  à raiz. Com termo de busca, as pastas somem e os links aparecem achatados, com o nome da pasta.
- **Foco (móvel):** tempo ajustável de foco e das duas pausas, lembrado no aparelho. Pontos por
  pomodoro **proporcionais**: `floor(pontos × minutos / 25)` — 50 min valem dois, 10 min nenhum.
  A conta mora em `packages/shared` e quem aplica é o servidor. O pomodoro genérico já existe
  ("Sem atividade"); ganha entrada própria: atalho no manifesto do PWA e um botão no Início.
- **Card de Atividades (móvel):** título inteiro em cima, quebrando linha; o resto embaixo. O mesmo
  em `LinhaAtividade` ("Hoje no ritmo").
- **Assistente rápido (móvel):** conversa **descartável** — marcada no servidor, fora da lista, e
  apagada pelo relógio depois de 24h (o laço precisa das mensagens da 1ª interação para a 2ª, e o
  app pode morrer antes de apagar). `ai_usage` aponta com `SetNull`, então o teto de gasto não se
  perde. Agente fixo escolhido no aparelho. Ditado em destaque (só preenche, nunca envia). Cartão
  do que foi criado com **Desfazer**. A aba Assistente abre no modo rápido; "Conversas" vira link.
- **Mascote:** gato preto em pixel art simplificado, desenhado à mão em SVG (`shape-rendering:
  crispEdges`), três poses — parado, pesquisando, achou — animadas por CSS, com
  `prefers-reduced-motion` respeitado. Sem a folha de sprites gerada (tremido, fundo embutido).

## Fases

| Fase | Entrega | Pacotes |
|---|---|---|
| F1 | Card de Atividades e `LinhaAtividade` em duas linhas | cliente, movel |
| F2 | Foco com tempo ajustável, pontos proporcionais, atalho do pomodoro | shared, api, movel |
| F3 | Pastas de links no servidor: modelo, migration, rotas, testes | shared, api |
| F4 | Gaveta de links nova: campo único, menu "⋯", pastas com arraste | web |
| F5 | Conversa descartável no servidor: marca, lista, limpeza de 24h | shared, api |
| F6 | Assistente rápido no móvel, com o mascote e o Desfazer | cliente, movel |
| Final | Teste geral: portões, suítes da API e do MCP, telas no navegador | todos |

Cada fase fecha com `pnpm --filter @yu-book/shared build`, `pnpm typecheck` e, quando toca a API,
os testes da área. O plano técnico de cada fase fica nesta página, na seção dela, quando começa.
