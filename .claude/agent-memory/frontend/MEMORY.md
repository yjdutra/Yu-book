# Memória — frontend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->

## Onde ficam as coisas

- API falsa por `page.route`: allow-origin = origem do app (5174 no móvel) + allow-credentials;
  OPTIONS com `continue`. Sem login, falseie o refresh do boot (`packages/cliente/src/auth.tsx:27`).
- Login real: `visual-agenda-*@exemplo.test` no banco local; tem o modelo do dublê, e o aviso
  de chat bloqueado só aparece falseando `GET /ai/settings`.
- Chat sem modelo: API extra com `OPENROUTER_BASE_URL` num dublê (`openrouter.service.ts:139`).
- Turno parado: `page.route` no GET da conversa, `route.fetch()` e fulfill sem a resposta.

## O que já nos mordeu

- Web e móvel no mesmo navegador dividem `yb_refresh` (`auth.routes.ts:10`): Sair num derruba
  o outro. Login: 10 a cada 5 min (`:58`); capture num contexto só.
- `getByRole` enxerga atrás do `Dialogo` `aria-modal`: escope por `getByRole("dialog")`.
- `name: "Fechar"` casa "Fechar aviso" (`Aviso.tsx:46`): use `exact: true`.
- O "Desfazer" do Criado tem o título no `aria-label` (`Conversa.tsx:287`, `Criados.tsx:157`):
  escope à section "Criado nesta resposta".
- Foco após trocar rota: espere o commit e confira `activeElement.isConnected`.
- Só agenda e tarefas releem ao foco (`packages/cliente/src/agenda.ts:82`, `:105`): dispare
  `visibilitychange` no `document` depois dos 30 s de `staleTime`.
- `pkill -f` com o padrão no comando mata o shell (saída 144): mate pelo PID de `ss -ltnp`.
- Navegar sem link: `history.pushState` + `dispatchEvent(new PopStateEvent("popstate"))`.

## Decisões em vigor

- Vazamento de `shared` no bundle se confere por grep da frase literal em `dist/assets/`.
- "Nada visível mudou": `cmp` do `index-*.css` com o `dist` anterior, e capturas pixel a pixel.
- "Não remontou": marque o nó com um `dataset` antes e confira a marca nele depois.
- Baseline 2026-10-09, eventos recorrentes: web `index-*.js` 633.109 B; móvel `index-*.js`
  440.488 B; `BlocoHoje-*.js` 9.430 B.
