-- CreateTable
CREATE TABLE "BtcHoldingEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "btcDelta" REAL NOT NULL,
    "costDeltaCents" INTEGER NOT NULL,
    "btcAfter" REAL NOT NULL,
    "costBasisAfterCents" INTEGER,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BtcHoldingEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BtcHoldingEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BtcHoldingEntry_accountId_createdAt_idx" ON "BtcHoldingEntry"("accountId", "createdAt");
