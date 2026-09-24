-- CreateEnum
CREATE TYPE "AiAgentColor" AS ENUM ('violeta', 'azul', 'verde', 'ambar', 'rosa', 'cinza');

-- AlterTable
ALTER TABLE "ai_conversation" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "agent_name" TEXT;

-- AlterTable
ALTER TABLE "card" ADD COLUMN     "ai_agent_name" TEXT;

-- AlterTable
ALTER TABLE "note" ADD COLUMN     "ai_agent_name" TEXT;

-- CreateTable
CREATE TABLE "ai_agent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" "AiAgentColor" NOT NULL DEFAULT 'violeta',
    "instructions_md" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "live_sources" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_base_note" (
    "agent_id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ai_agent_base_note_pkey" PRIMARY KEY ("agent_id","note_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_user_id_name_key" ON "ai_agent"("user_id", "name");

-- CreateIndex
CREATE INDEX "ai_agent_base_note_note_id_idx" ON "ai_agent_base_note"("note_id");

-- AddForeignKey
ALTER TABLE "ai_conversation" ADD CONSTRAINT "ai_conversation_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_base_note" ADD CONSTRAINT "ai_agent_base_note_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_base_note" ADD CONSTRAINT "ai_agent_base_note_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
