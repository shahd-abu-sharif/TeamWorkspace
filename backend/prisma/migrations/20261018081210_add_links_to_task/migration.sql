-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[];
