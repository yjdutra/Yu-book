-- AlterTable
ALTER TABLE "ai_agent" ADD COLUMN     "web_search" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ai_routine_run_step" ADD COLUMN     "sources" JSONB;

