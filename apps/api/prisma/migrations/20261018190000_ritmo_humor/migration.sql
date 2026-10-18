-- CreateTable
CREATE TABLE "mood_day" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "morning" INTEGER,
    "midday" INTEGER,
    "evening" INTEGER,
    "note" TEXT,
    "ai_via" "AiVia",
    "ai_author" TEXT,
    "ai_agent_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mood_day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mood_day_user_id_day_key" ON "mood_day"("user_id", "day");

-- AddForeignKey
ALTER TABLE "mood_day" ADD CONSTRAINT "mood_day_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fora do schema.prisma (o Prisma não modela CHECK): cada momento vai de 1 a 5
-- (Ritmo 4, RF-40). O schema Zod já recusa; isto é a última linha.
ALTER TABLE "mood_day" ADD CONSTRAINT "mood_day_momentos_check" CHECK (
  ("morning" IS NULL OR "morning" BETWEEN 1 AND 5) AND
  ("midday" IS NULL OR "midday" BETWEEN 1 AND 5) AND
  ("evening" IS NULL OR "evening" BETWEEN 1 AND 5)
);
