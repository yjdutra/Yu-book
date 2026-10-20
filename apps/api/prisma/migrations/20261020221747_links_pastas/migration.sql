-- AlterTable
ALTER TABLE "link" ADD COLUMN     "folder_id" UUID;

-- CreateTable
CREATE TABLE "link_folder" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_folder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "link_folder_user_id_position_idx" ON "link_folder"("user_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "link_folder_user_id_name_key" ON "link_folder"("user_id", "name");

-- CreateIndex
CREATE INDEX "link_folder_id_idx" ON "link"("folder_id");

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "link_folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_folder" ADD CONSTRAINT "link_folder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
