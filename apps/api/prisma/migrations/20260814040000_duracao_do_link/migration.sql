-- AlterTable
-- Duração do vídeo em segundos, quando a fonte informa. Nulo é o normal: só
-- vídeo do YouTube, e só quando existe chave da Data API configurada.
ALTER TABLE "link" ADD COLUMN "duration_seconds" INTEGER;
