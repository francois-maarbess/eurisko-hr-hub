-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "metadata" TEXT;

-- AlterTable
ALTER TABLE "Request" ADD COLUMN "completedAt" DATETIME;
