# Memória — frontend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

## O que já nos mordeu

- Módulo de `packages/shared` que **constrói valor em escopo de módulo** entra no bundle do front
  mesmo sem ninguém importar. Medido em 2026-09-23: `ferramentas.ts` punha ~6,3 KB crus na primeira
  pintura, contra 0 de `formato.ts`. Fechou com `"sideEffects": false` em
  `packages/shared/package.json:6` — linha que o JSON não pode explicar, e cuja remoção não acusa.

## Decisões em vigor

- **Conferir vazamento de `shared` para o bundle é mais barato que medir tamanho**:
  `pnpm --filter @yu-book/web build` e depois `grep -rl "<frase literal do módulo>" apps/web/dist/assets/`.
  Feito em 2026-09-23 com uma `descricao` de `ferramentas.ts`: ausente de todo o `dist`.
- Tamanho de bundle e contagem de teste viram registro; **tempo de build não vira** — varia por
  rodada e por máquina, e um número desses envelhece sem ninguém notar.
