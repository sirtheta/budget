-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "categoryId" INTEGER,
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "notes" TEXT,
    "transferGroupId" TEXT,
    "splitGroupId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Manual',
    "importHash" TEXT,
    "importBatchId" INTEGER,
    "bankReference" TEXT,
    "recurringId" INTEGER,
    "createdById" INTEGER,
    "btcWalletId" INTEGER,
    "btcQuantity" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringTransaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_btcWalletId_fkey" FOREIGN KEY ("btcWalletId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amountCents", "bankReference", "categoryId", "counterparty", "createdAt", "createdById", "date", "description", "id", "importBatchId", "importHash", "notes", "recurringId", "source", "splitGroupId", "transferGroupId", "updatedAt") SELECT "accountId", "amountCents", "bankReference", "categoryId", "counterparty", "createdAt", "createdById", "date", "description", "id", "importBatchId", "importHash", "notes", "recurringId", "source", "splitGroupId", "transferGroupId", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_importHash_key" ON "Transaction"("importHash");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_categoryId_date_idx" ON "Transaction"("categoryId", "date");
CREATE INDEX "Transaction_transferGroupId_idx" ON "Transaction"("transferGroupId");
CREATE INDEX "Transaction_splitGroupId_idx" ON "Transaction"("splitGroupId");
CREATE INDEX "Transaction_importBatchId_idx" ON "Transaction"("importBatchId");
CREATE INDEX "Transaction_btcWalletId_idx" ON "Transaction"("btcWalletId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
