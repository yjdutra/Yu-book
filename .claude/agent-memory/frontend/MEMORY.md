# Memória — frontend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Captura sem login: `page.route("**/auth/refresh")` devolve `AuthResponse` falso com allow-origin
  do app (5174 no móvel) e allow-credentials; o boot chama o refresh (`packages/cliente/src/auth.tsx:27`).
- Captura com login real: usuário de teste `visual-agenda-*@exemplo.test` no banco local.
- "Nada visível mudou": `cmp` do `index-*.css` contra o `dist` de antes, e capturas pixel a pixel.
- Chat sem modelo: API extra com `OPENROUTER_BASE_URL` num dublê
  (`apps/api/src/modules/assistente/openrouter.service.ts:139`).

## O que já nos mordeu

- Web e móvel no mesmo navegador dividem o cookie `yb_refresh` da API
  (`apps/api/src/modules/auth/auth.routes.ts:10`): Sair num derruba o outro no próximo refresh.
- Login: 10 a cada 5 min, senha errada conta (`auth.routes.ts:58`). Capture num contexto só,
  trocando viewport e `yb:tema`: `storageState` noutro contexto não restaurou a sessão.
- `getByRole` enxerga atrás do `Dialogo` `aria-modal`: escope por `getByRole("dialog")`.
- Foco após trocar rota ou grade: o botão tocado já tem foco antes do render; espere o commit
  e confira `document.activeElement.isConnected`.

## Decisões em vigor

- **Vazamento de `shared` no bundle se confere por grep, não por tamanho**: build e
  `grep -rl "<frase literal do módulo>" apps/web/dist/assets/`.
- Tamanho de bundle vira registro; **tempo de build não** — varia por rodada e por máquina.
- Baseline 2026-10-09, fim da Fase 4 da agenda: web inalterado desde a Fase 3 (`index-*.js`
  630.115 B, CSS 77.801 B); móvel `index-*.js` 418,19 kB (gzip 126,39 kB), CSS 44,66 kB.
