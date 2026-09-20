# Bitcoin-Wallet mit Anteilen pro Person

*Design, 2026-09-20*

## Problem

Im Haushalt existiert **ein** physisches Bitcoin-Wallet, dessen Inhalt mehreren
Personen gehört (Elternteil und zwei Kinder). Abgebildet wird das heute mit drei
Konten vom Typ `Crypto`. Bestand und Einstandswert werden nicht über den
BTC-Kauf-Dialog gebucht, sondern direkt am Konto von Hand gepflegt
(`Account.btcAmount`, `Account.btcCostBasisCents`).

Daraus folgt der eigentliche Schmerz: Bei jedem Zugang muss der neue
Gesamtbestand von Hand auf drei Konten verteilt und jeder Einstandswert einzeln
nachgerechnet werden. Es gibt ausserdem nirgends eine Stelle, die sagt, dass
diese drei Konten zusammen das eine echte Wallet sind.

## Ziel

- Zugänge werden **einmal**, für alle Personen gemeinsam, in einer Maske erfasst;
  die App rechnet Bestände und Einstandswerte fort.
- Die drei Konten bleiben als eigene Zeilen sichtbar — in Kontoliste,
  Netto-Vermögen und Analytics ändert sich nichts an ihrer Bedeutung.
- Die Zusammengehörigkeit zum einen echten Wallet ist im Modell und in der UI
  sichtbar, inklusive Wallet-Total.

## Nicht-Ziele

- Kein Prozent-Verteilschlüssel: jeder Zugang ist genau einer Person zuordenbar.
- Keine CHF-Buchung aus der neuen Maske heraus. Sie verändert ausschliesslich
  BTC-Menge und Einstandswert. Der bestehende `BtcPurchaseDialog` bleibt
  unverändert daneben bestehen, für den Fall, dass ein Kauf doch als
  Geldabgang gebucht werden soll.
- Kein Abgleich gegen die echte Wallet-Adresse (kein Chain-Lookup).
- Keine Sonderlogik für Kinder-BTC im Netto-Vermögen. Das bestehende
  `Account.excludeFromNetWorth` pro Konto genügt.

## Datenmodell

`prisma/schema.prisma`:

```prisma
/// Ein physisches Wallet, dessen Inhalt mehreren Personen gehört. Das Wallet
/// selbst hält keinen Bestand: es gruppiert nur Crypto-Konten, die je einen
/// Anteil daran abbilden. Dadurch bleiben Saldo, Netto-Vermögen und Analytics
/// unverändert kontobasiert.
model CryptoWallet {
  id        Int      @id @default(autoincrement())
  name      String
  notes     String?
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  accounts Account[]

  @@index([sortOrder])
}
```

`Account` erhält:

```prisma
  cryptoWalletId Int?
  cryptoWallet   CryptoWallet? @relation(fields: [cryptoWalletId], references: [id], onDelete: SetNull)

  @@index([cryptoWalletId])
```

`onDelete: SetNull`, damit das Löschen eines Wallets niemals Konten — und damit
Bestände — mitreisst.

Bewusst **unverändert**: `btcAmount` und `btcCostBasisCents` bleiben pro Konto.
Deshalb brauchen `lib/balances.ts`, `lib/analytics.ts`, Dashboard und
Netto-Vermögen keine Anpassung; ein Anteil ist weiterhin schlicht ein Konto.

## Erfassung

Neue Server Action in `app/(app)/accounts/actions.ts`:

```ts
updateWalletStakesAction(walletId: number, rows: { accountId: number; btcDelta: number; costDeltaCents: number }[])
```

Verhalten:

- `requireEditor()` zuoberst.
- Alle Zeilen in **einer** `prisma.$transaction`. Pro Zeile derselbe
  NULL-sichere Raw-Increment wie in `recordBtcPurchase()`
  (`SET "btcAmount" = COALESCE("btcAmount", 0) + ?`, analog für
  `btcCostBasisCents`) — kein Read-then-Write, damit zwei gleichzeitige
  Erfassungen sich nicht gegenseitig überschreiben.
- Deltas dürfen negativ sein (Verkauf, Abgang, Korrektur).
- Guard: Führt eine Zeile zu einem Bestand < 0 oder einem Einstandswert < 0,
  bricht die gesamte Transaktion mit einer Fehlermeldung ab.
- Zeilen, bei denen beide Felder leer bzw. 0 sind, werden übersprungen.
- Jede Zeile muss zu einem Konto vom Typ `Crypto` mit genau diesem
  `cryptoWalletId` gehören; sonst Abbruch.
- Ein Audit-Eintrag pro Erfassung, der alle Zeilen enthält (nicht einer pro
  Zeile) — die Erfassung ist fachlich ein Vorgang.

Absolute Korrekturen eines Bestands sind bereits über „Konto bearbeiten"
möglich und werden hier nicht doppelt gebaut.

## UI

**`app/(app)/accounts/wallet-stakes-dialog.tsx`** (neu, Client Component):
Tabelle mit einer Zeile pro Anteilskonto und den Spalten
*Person* | *Bestand jetzt* | *+ BTC* | *+ CHF Einstand* | *neuer Bestand*.
Unten Live-Summen: Total BTC, Total CHF-Einstand, Total CHF zum aktuellen Kurs.
Einmal speichern. Absenden über `useDialogFormAction`
(`components/use-dialog-form.ts`), nicht über einen Effect, der den Dialog
schliesst.

**`app/(app)/accounts/wallet-card.tsx`** (neu): je Wallet eine Karte über der
Kontoliste mit „<Wallet-Name> · <Total BTC> · <Total CHF>", darunter eine Zeile
pro Anteil (Person, BTC, Anteil in Prozent, Wert, Gewinn/Verlust), und dort der
Knopf „Bestände erfassen".

Bewusst eine eigene Karte statt einer Gruppenzeile innerhalb der Kontoliste:
diese Liste ist eine Drag-&-Drop-Sortierliste mit zwei getrennten
DnD-Kontexten (Tabelle und Mobile-Liste sind beide im DOM). Eine Gruppenkopfzeile
darin müsste die Sortier-Reihenfolge pro Wallet aufteilen und bricht genau die
Invarianten, die in `accounts-list.tsx` kommentiert sind. Die Kontoliste bleibt
deshalb flach und unverändert — die Anteile erscheinen dort weiterhin als
eigene Zeilen.

**`app/(app)/accounts/account-form-dialog.tsx`**: zusätzliches Feld
„Gehört zu Wallet" (Auswahl, nur bei Typ `Crypto` sichtbar, leer erlaubt).
Wallets anlegen und umbenennen geschieht minimal auf derselben Konten-Seite;
es gibt keinen eigenen Navigationspunkt.

Alle Texte deutsch, wie im Rest der App.

## Migration

Die Migration legt ausschliesslich Tabelle und Spalte an. Bestehende Konten
behalten `cryptoWalletId = null` und verhalten sich unverändert. Die drei
vorhandenen Konten werden einmalig von Hand einer neu angelegten Wallet
zugeordnet — das SQL rät nicht, welche Konten zusammengehören.

## Tests

Integration (`tests/integration/`):

- Mehrzeilige Erfassung addiert pro Konto korrekt auf Bestand und Einstandswert.
- Konto mit `btcAmount = NULL` startet korrekt bei 0.
- Negatives Delta reduziert den Bestand.
- Eine Zeile, die den Bestand unter 0 drücken würde, rollt **alle** Zeilen zurück.
- Konto, das nicht zu diesem Wallet gehört, wird abgewiesen.
- Rolle `Viewer` wird abgewiesen.

E2E: Fall „Anteile erfassen" im bestehenden Konten-Spec unter `tests/e2e/`.

## Offene Punkte

Keine.
