# Memória — backend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

## O que já nos mordeu

## Decisões em vigor

- Baseline do catálogo do chat (2026-10-09, conferida pelo curador): `FERRAMENTAS_DO_CHAT`, 13
  ferramentas, 9899 B; `FERRAMENTAS_SEM_AGENTE`, 12, 9358 B. Pago em todo turno; meça contra ela.
- Como medir: `node_modules/.bin/tsx` em `apps/api`, num script que importa `catalogoParaProvedor`
  (`src/modules/assistente/ferramentas.service.ts:412`) e soma `Buffer.byteLength(JSON.stringify(c))`.
