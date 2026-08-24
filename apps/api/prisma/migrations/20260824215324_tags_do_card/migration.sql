-- AlterTable
ALTER TABLE "card" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
