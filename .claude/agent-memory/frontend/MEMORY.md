# Memória — frontend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- API falsa por `page.route`: allow-origin = origem do app (5174 no móvel) + allow-credentials;
  OPTIONS com `continue`. Sem login, falseie o refresh do boot (`packages/cliente/src/auth.tsx:27`).
- Captura com login real: usuário de teste `visual-agenda-*@exemplo.test` no banco local.
- Chat sem modelo: API extra com `OPENROUTER_BASE_URL` num dublê (`openrouter.service.ts:139`);
  passo a passo, um proxy que solta o SSE com atraso.
- Turno parado ou com erro: `page.route` no GET da conversa, `route.fetch()` e fulfill sem a resposta.

## O que já nos mordeu

- Web e móvel no mesmo navegador dividem o cookie `yb_refresh` (`auth.routes.ts:10`): Sair num
  derruba o outro. Login: 10 a cada 5 min (`:58`); capture num contexto só.
- `getByRole` enxerga atrás do `Dialogo` `aria-modal`: escope por `getByRole("dialog")`.
- Foco após trocar rota: espere o commit e confira `document.activeElement.isConnected`.
- `refetchOnWindowFocus: false` nos dois apps (`apps/web/src/main.tsx:15`): `visibilitychange` não relê.
- `pkill -f` com o padrão no próprio comando mata o shell (saída 144): mate pelo PID de `ss -ltnp`.
- Navegar sem link: `history.pushState` + `dispatchEvent(new PopStateEvent("popstate"))`.

## Decisões em vigor

- Vazamento de `shared` no bundle se confere por grep da frase literal em `dist/assets/`.
- "Nada visível mudou": `cmp` do `index-*.css` contra o `dist` de antes, e capturas pixel a pixel.
- Tamanho de bundle vira registro; tempo de build não.
- Baseline 2026-10-09, fim da Fase 5 da agenda: web `index-*.js` 631.187 B; móvel `index-*.js`
  430.191 B e `ConversaPage-*.js` 160 kB (CSS antes da revisão: web 83.818 B, móvel 61.818 B).
