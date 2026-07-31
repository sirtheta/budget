-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "splitGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_splitGroupId_idx" ON "Transaction"("splitGroupId");
