[![Web CI/CD](https://github.com/sirtheta/budget/actions/workflows/ci.yml/badge.svg)](https://github.com/sirtheta/budget/actions/workflows/ci.yml)
[![Release & Deploy](https://github.com/sirtheta/budget/actions/workflows/release.yml/badge.svg)](https://github.com/sirtheta/budget/actions/workflows/release.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

# Haushaltsbudget

Budget-, Ausgaben- und Vermögensübersicht für einen privaten Schweizer Haushalt.
Selbst gehostet, Next.js 16 mit SQLite, läuft als einzelner Docker-Container auf
einem Raspberry Pi.

---

## Was die App kann

**Erfassen**
- Konten (Privatkonto, Sparkonto, Kreditkarte, Bargeld, Depot) mit laufendem Saldo
- Einnahmen und Ausgaben mit zweistufigen Kategorien
- Umbuchungen zwischen eigenen Konten — zählen nicht als Ausgabe und verfälschen
  keine Auswertung
- Wiederkehrende Buchungen (Miete, Abos, Versicherungen, Dauerauftrag aufs
  Sparkonto), die automatisch gebucht werden, sobald sie fällig sind

**Planen**
- Monatsbudget pro Kategorie: Soll gegen Ist mit Ampel und Fortschrittsbalken
- Budgets des Vormonats per Klick übernehmen
- **Rückstellungen** für alles, was jährlich oder halbjährlich kommt —
  Krankenkasse, Steuern, Autoversicherung, Serafe. Die App rechnet aus, wie viel
  du monatlich zurücklegen musst, und warnt, wenn eine Fälligkeit ungedeckt ist
- Sparziele mit Zieldatum und daraus abgeleiteter Sparrate

**Auswerten**
- Dashboard mit Monatsübersicht, Kontosaldi, Budget-Ampeln und letzten Buchungen
- Jahresverlauf, Kategorien-Aufteilung mit Klick auf die zugehörigen Buchungen,
  Vermögensentwicklung, grösste Empfänger

**Importieren**
- **CAMT.053** (ISO 20022) — der Kontoauszug, den jede Schweizer Bank liefert.
  Enthält Anfangs- und Schlusssaldo, womit die App direkt prüft, ob der Import
  vollständig war
- **CSV** mit speicherbarem Spalten-Mapping pro Bank
- Duplikatserkennung: derselbe Auszug lässt sich gefahrlos zweimal einlesen
- Regeln zur automatischen Kategorisierung („Beschreibung enthält MIGROS →
  Lebensmittel"), auch nachträglich auf offene Buchungen anwendbar
- Vorschau vor der Übernahme, jeder Import einzeln rückgängig zu machen

---

## Betrieb mit Docker

```bash
mkdir haushaltsbudget && cd haushaltsbudget
curl -O https://raw.githubusercontent.com/sirtheta/budget/main/docker-compose.yml
docker compose up -d
```

Die App läuft danach auf `http://localhost:3000`.

Eine `.env` ist nicht zwingend: fehlen `AUTH_SECRET` und `ENCRYPTION_KEY`, erzeugt
der Container beim ersten Start eigene und legt sie im Volume `./data` ab. Ohne
`ADMIN_PASSWORD` wird ein Einmalpasswort nach
`data/initial-admin-password.txt` geschrieben — damit anmelden, sofort ändern,
Datei löschen.

Alles Persistente liegt in `./data`: die SQLite-Datei, die generierten Secrets und
die nächtlichen Backups unter `data/backups/`. Ein externer Sync dieses
Verzeichnisses sichert damit alles auf einmal.

Für eigene Werte siehe [`.env.example`](.env.example).

---

## Entwicklung

```bash
npm install
cp .env.example .env
npx prisma migrate dev          # Datenbank anlegen
npm run db:seed                 # Testdaten: ein Jahr Buchungen
npm run dev                     # http://localhost:3000
```

Login nach dem Seed: `admin@example.com` / `admin123`.

```bash
npm run lint                    # ESLint
npm test                        # Unit- und Integrationstests (Vitest)
npm run test:coverage           # mit Coverage
npm run test:e2e                # Playwright, startet eigenen Dev-Server auf :3111
npm run build                   # Produktions-Build
npx prisma studio               # Datenbank ansehen
```

---

## Aufbau

| Verzeichnis | Inhalt |
|---|---|
| `app/(auth)/` | Login, Passwort vergessen, Passwort zurücksetzen |
| `app/(app)/` | Geschützte Seiten; Mutationen laufen über Server Actions in `actions.ts` |
| `app/api/` | Nur was einen Stream oder externen Zugriff braucht (CSV-Export, NextAuth) |
| `lib/` | Fachlogik: Budget, Rückstellungen, Wiederkehrendes, Auswertungen, Import |
| `lib/import/` | CAMT.053-Parser, CSV-Parser, Duplikatserkennung, Regel-Engine |
| `prisma/` | Datenmodell und Migrationen |

Beträge werden durchgehend als ganzzahlige **Rappen** gespeichert, nie als
Fliesskommazahl und nie als Prisma-`Decimal`. Das hält die Rechnerei exakt und
überlebt die Grenze von Server- zu Client-Komponente unverändert.

---

## Lizenz

AGPL-3.0-or-later
