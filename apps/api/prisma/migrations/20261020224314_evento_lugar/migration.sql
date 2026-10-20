-- AlterTable
ALTER TABLE "event" ADD COLUMN     "place_address" TEXT,
ADD COLUMN     "place_id" TEXT,
ADD COLUMN     "place_lat" DOUBLE PRECISION,
ADD COLUMN     "place_lng" DOUBLE PRECISION;
