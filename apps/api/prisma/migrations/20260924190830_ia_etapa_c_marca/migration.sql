-- CreateEnum
CREATE TYPE "AiVia" AS ENUM ('chat', 'mcp');

-- AlterTable
ALTER TABLE "ai_message" ADD COLUMN     "created" JSONB;

-- AlterTable
ALTER TABLE "card" ADD COLUMN     "ai_author" TEXT,
ADD COLUMN     "ai_conversation_id" UUID,
ADD COLUMN     "ai_generated_at" TIMESTAMP(3),
ADD COLUMN     "ai_revised_at" TIMESTAMP(3),
ADD COLUMN     "ai_via" "AiVia";

-- AlterTable
ALTER TABLE "note" ADD COLUMN     "ai_author" TEXT,
ADD COLUMN     "ai_conversation_id" UUID,
ADD COLUMN     "ai_generated_at" TIMESTAMP(3),
ADD COLUMN     "ai_revised_at" TIMESTAMP(3),
ADD COLUMN     "ai_via" "AiVia";

-- CreateIndex
CREATE INDEX "note_user_id_ai_generated_at_idx" ON "note"("user_id", "ai_generated_at");

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_ai_conversation_id_fkey" FOREIGN KEY ("ai_conversation_id") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_ai_conversation_id_fkey" FOREIGN KEY ("ai_conversation_id") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
