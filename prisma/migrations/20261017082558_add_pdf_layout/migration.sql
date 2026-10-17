-- CreateTable
CREATE TABLE "PdfLayout" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "transactionRegex" TEXT NOT NULL,
    "dateFormat" TEXT NOT NULL DEFAULT 'DD.MM.YY',
    "negativeSuffixRegex" TEXT,
    "invertAmount" BOOLEAN NOT NULL DEFAULT false,
    "descriptionTemplate" TEXT NOT NULL DEFAULT '{text}',
    "skipRegex" TEXT,
    "totalRegex" TEXT,
    "contextRegexes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PdfLayout_name_key" ON "PdfLayout"("name");
