# Memória — backend

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

## O que já nos mordeu

- Campo novo de `ChatCreated` fica **ausente**, não `null`: `agenda-chat.test.ts:231` compara com
  `toEqual` exato (o `repeat` só no evento que repete, `chat.service.ts:563-564`).

## Decisões em vigor

- Baseline por turno (2026-10-09, eventos recorrentes, conferida pelo curador): catálogo
  `FERRAMENTAS_DO_CHAT` 13 ferramentas, 10424 B, e `FERRAMENTAS_SEM_AGENTE` 12, 9883 B; `system`
  de `instrucoesPara(lista, false)` 2893 B e 2403 B. Meça contra ela.
- Como medir: `node_modules/.bin/tsx` em `apps/api`, num script que importa `catalogoParaProvedor`
  (`src/modules/assistente/ferramentas.service.ts:426`) e `instrucoesPara`
  (`agentes.service.ts:92`) e soma `Buffer.byteLength(JSON.stringify(c))` / do texto.
