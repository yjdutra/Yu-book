-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('favorito', 'depois');

-- CreateTable
CREATE TABLE "link" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" "LinkKind" NOT NULL DEFAULT 'depois',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Grade de favoritos, na ordem manual (RF-21).
CREATE INDEX "link_user_id_kind_position_idx" ON "link"("user_id", "kind", "position");

-- CreateIndex
-- Fila de "ver depois", do mais novo para o mais velho (RF-24).
CREATE INDEX "link_user_id_kind_created_at_idx" ON "link"("user_id", "kind", "created_at" DESC);

-- CreateIndex
-- RN-02: a mesma URL não entra duas vezes na mesma lista. A unicidade é sobre
-- a URL já normalizada — quem normaliza é a aplicação, antes de gravar.
CREATE UNIQUE INDEX "link_user_id_kind_url_key" ON "link"("user_id", "kind", "url");

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
