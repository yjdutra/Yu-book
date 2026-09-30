-- AlterTable
ALTER TABLE "card" ADD COLUMN     "ai_completed_agent_name" TEXT,
ADD COLUMN     "ai_completed_author" TEXT,
ADD COLUMN     "ai_completed_via" "AiVia",
ADD COLUMN     "completed_at" TIMESTAMP(3);

