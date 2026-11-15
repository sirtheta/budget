-- AlterTable
ALTER TABLE "CsvMapping" ADD COLUMN "feeColumn" INTEGER;

-- The starter "Revolut" mapping (Betrag = column 5) gets its Gebühr column (6);
-- user-edited mappings with a different layout are left alone.
UPDATE "CsvMapping"
SET "feeColumn" = 6
WHERE "name" = 'Revolut' AND "dateColumn" = 3 AND "descriptionColumn" = 4 AND "amountColumn" = 5 AND "feeColumn" IS NULL;
