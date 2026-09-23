-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant', 'tool');

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "conversation_id" UUID;

-- CreateTable
CREATE TABLE "ai_conversation" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_message" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "model_id" TEXT,
    "model_used" TEXT,
    "tool_name" TEXT,
    "tool_call_id" TEXT,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_attachment" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "note_id" UUID,
    "card_id" UUID,
    "board_id" UUID,
    "title" TEXT NOT NULL,

    CONSTRAINT "ai_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversation_user_id_updated_at_idx" ON "ai_conversation"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ai_message_conversation_id_created_at_idx" ON "ai_message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_attachment_message_id_idx" ON "ai_attachment"("message_id");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attachment" ADD CONSTRAINT "ai_attachment_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attachment" ADD CONSTRAINT "ai_attachment_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attachment" ADD CONSTRAINT "ai_attachment_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_attachment" ADD CONSTRAINT "ai_attachment_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
