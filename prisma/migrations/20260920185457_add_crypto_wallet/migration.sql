-- CreateTable
CREATE TABLE "CryptoWallet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Checking',
    "iban" TEXT,
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "btcAmount" REAL,
    "btcCostBasisCents" INTEGER,
    "cryptoWalletId" INTEGER,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "excludeFromBudget" BOOLEAN NOT NULL DEFAULT false,
    "excludeFromNetWorth" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_cryptoWalletId_fkey" FOREIGN KEY ("cryptoWalletId") REFERENCES "CryptoWallet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("btcAmount", "btcCostBasisCents", "color", "createdAt", "excludeFromBudget", "excludeFromNetWorth", "iban", "id", "isActive", "name", "notes", "openingBalanceCents", "sortOrder", "type", "updatedAt") SELECT "btcAmount", "btcCostBasisCents", "color", "createdAt", "excludeFromBudget", "excludeFromNetWorth", "iban", "id", "isActive", "name", "notes", "openingBalanceCents", "sortOrder", "type", "updatedAt" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_iban_key" ON "Account"("iban");
CREATE INDEX "Account_sortOrder_idx" ON "Account"("sortOrder");
CREATE INDEX "Account_cryptoWalletId_idx" ON "Account"("cryptoWalletId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CryptoWallet_sortOrder_idx" ON "CryptoWallet"("sortOrder");
