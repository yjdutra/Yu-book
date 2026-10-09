# Memória — zelador

<!-- Curado por: curador. Limite: 2 KB / 60 linhas. Registro contradito pelo código é removido. -->
<!-- Um item por linha, com arquivo:linha quando houver. Nada de parágrafo. -->

## Onde ficam as coisas

## O que já nos mordeu

## Decisões em vigor

- `GET /events` fica sem consumidor de front: superfície REST com testes, não resquício
  (`apps/api/src/modules/eventos/eventos.routes.ts:14`; decidido 2026-10-09).
- `event.workspace_id`, `note_id` e `card_id` seguem sem uso por decisão do operador; não proponha
  removê-las (`apps/api/prisma/schema.prisma:445`, `:457-458`).
