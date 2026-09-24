-- Etapa E, correção da revisão: pulso e pedido de cancelamento da execução.
-- Aditiva de propósito, e não editada dentro de `ia_etapa_e_rotinas`: aquela
-- já estava aplicada no banco de dev, que guarda dado real do operador, e
-- editá-la obrigaria a um `migrate reset`. As duas sobem juntas em produção.
--
-- O padrão só vale para as linhas que já existem (nenhuma em produção: a
-- Etapa E sobe com esta migration); o motor grava o pulso ao criar a execução.

-- AlterTable
ALTER TABLE "ai_routine_run" ADD COLUMN     "cancel_requested_at" TIMESTAMP(3),
ADD COLUMN     "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
