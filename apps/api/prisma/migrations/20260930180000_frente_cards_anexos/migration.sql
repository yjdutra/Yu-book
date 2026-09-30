-- CreateTable
CREATE TABLE "card_file" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_file_key_key" ON "card_file"("key");

-- CreateIndex
CREATE INDEX "card_file_card_id_idx" ON "card_file"("card_id");

-- AddForeignKey
ALTER TABLE "card_file" ADD CONSTRAINT "card_file_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

