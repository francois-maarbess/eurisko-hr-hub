-- AlterTable
ALTER TABLE "Request" ADD COLUMN "feedbackNote" TEXT;
ALTER TABLE "Request" ADD COLUMN "rating" INTEGER;

-- CreateTable
CREATE TABLE "StaffNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffNote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StaffNote_requestId_createdAt_idx" ON "StaffNote"("requestId", "createdAt");
