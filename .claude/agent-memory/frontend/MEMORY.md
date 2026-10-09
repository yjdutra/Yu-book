# Memória — frontend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

- Captura sem login: `page.route("**/auth/refresh")` devolve `AuthResponse` falso com allow-origin
  do app (5174 no móvel) e allow-credentials; o boot chama o refresh (`packages/cliente/src/auth.tsx:27`).
- Captura com login real: usuário de teste `visual-agenda-*@exemplo.test` no banco local.
- "Nada visível mudou" se prova com `cmp` do `index-*.css` contra o `dist` guardado antes, e
  capturas antes/depois comparadas pixel a pixel (Fase 3 da agenda, 2026-10-09).

## O que já nos mordeu

- Módulo de `shared` que constrói valor em escopo de módulo entrava no bundle sem ninguém importar
  (~6,3 KB de `ferramentas.ts`, 2026-09-23); fechou com `"sideEffects": false`
  (`packages/shared/package.json:6`), linha que o JSON não explica e cuja remoção não acusa.
- Web e móvel no mesmo navegador dividem o cookie `yb_refresh` da API
  (`apps/api/src/modules/auth/auth.routes.ts:10`): Sair num derruba o outro no próximo refresh.

## Decisões em vigor

- **Vazamento de `shared` no bundle se confere por grep, não por tamanho**: build e
  `grep -rl "<frase literal do módulo>" apps/web/dist/assets/`.
- Tamanho de bundle vira registro; **tempo de build não** — varia por rodada e por máquina.
- Baseline 2026-10-09, fim da Fase 3 da agenda: web `index-*.js` 630.115 B (gzip 194,10 kB), CSS
  77.801 B; móvel `index-*.js` 341.770 B (gzip 104.090), CSS 38.258 B, chunk único.
