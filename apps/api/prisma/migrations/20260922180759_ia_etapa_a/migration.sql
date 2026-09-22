-- CreateEnum
CREATE TYPE "AiTask" AS ENUM ('formatar', 'chat');

-- CreateEnum
CREATE TYPE "AiCostSource" AS ENUM ('provedor', 'estimado', 'desconhecido');

-- CreateTable
CREATE TABLE "ai_preference" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "daily_cap_micros" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_favorite" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "model_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context_length" INTEGER NOT NULL,
    "prompt_micros" INTEGER NOT NULL,
    "completion_micros" INTEGER NOT NULL,
    "supports_tools" BOOLEAN NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_model" (
    "user_id" UUID NOT NULL,
    "task" "AiTask" NOT NULL,
    "model_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_task_model_pkey" PRIMARY KEY ("user_id","task")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task" "AiTask" NOT NULL,
    "model_id" TEXT NOT NULL,
    "model_used" TEXT,
    "generation_id" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "cost_source" "AiCostSource" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "local_day" TEXT NOT NULL,
    "note_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_preference_user_id_key" ON "ai_preference"("user_id");

-- CreateIndex
CREATE INDEX "ai_model_favorite_user_id_created_at_idx" ON "ai_model_favorite"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_favorite_user_id_model_id_key" ON "ai_model_favorite"("user_id", "model_id");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_local_day_idx" ON "ai_usage"("user_id", "local_day");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_created_at_idx" ON "ai_usage"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_preference" ADD CONSTRAINT "ai_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_favorite" ADD CONSTRAINT "ai_model_favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_model" ADD CONSTRAINT "ai_task_model_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
