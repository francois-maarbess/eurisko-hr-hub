-- Additive workflow metadata; existing requests remain independent roots.
ALTER TABLE "Request" ADD COLUMN "parentRequestId" TEXT REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Request" ADD COLUMN "submissionKey" TEXT;

CREATE UNIQUE INDEX "Request_submissionKey_key" ON "Request"("submissionKey");
CREATE INDEX "Request_parentRequestId_status_idx" ON "Request"("parentRequestId", "status");

-- Parent deletion is restricted by the self-relation declared in Prisma so
-- workflow history cannot be cascaded away accidentally.
