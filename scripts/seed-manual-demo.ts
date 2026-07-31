/**
 * Seeds a fixed, fictional demo instance used to capture screenshots for
 * public/benutzerhandbuch.html. Faker is seeded so re-running this produces
 * the same data and keeps old and new screenshots visually consistent.
 * See scripts/manual-screenshots.ts for how to use it together with the
 * capture script.
 *
 * Run against its own DB, never the dev database:
 *   DATABASE_URL=file:./data/demo-manual.db npx prisma db push
 *   DATABASE_URL=file:./data/demo-manual.db ENCRYPTION_KEY=<any 32+ chars> \
 *     npx tsx scripts/seed-manual-demo.ts
 *
 * Demo accounts: admin@demo.local / editor@demo.local / viewer@demo.local,
 * password Demo1234!
 */
import { PrismaClient, UserRole, AccountType, RuleField, RuleMatch } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashSync } from "bcryptjs";
import { faker } from "@faker-js/faker";
import { randomUUID } from "crypto";

// Minimal AES-256-GCM encrypt matching lib/crypto.ts (kept independent so this
// throwaway script has no "@/" alias dependency).
import { createCipheriv, randomBytes, scryptSync } from "crypto";
function encryptSecret(plain: string): string {
  const key = scryptSync(process.env.ENCRYPTION_KEY ?? "insecure-development-encryption-key", "budget-secret-encryption-v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

const url = (process.env.DATABASE_URL ?? "file:./data/demo-manual.db").replace(/^file:/, "");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

faker.seed(20260731);

const CHF = (francs: number) => Math.round(francs * 100);

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Der Demo-Seed darf nicht gegen eine Produktionsdatenbank laufen.");
  }

  console.log("Bestehende Daten löschen…");
  await prisma.auditLog.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.importRule.deleteMany();
  await prisma.csvMapping.deleteMany();
  await prisma.recurringTransaction.deleteMany();
  await prisma.reserve.deleteMany();
  await prisma.savingsGoal.deleteMany();
  await prisma.category.deleteMany();
  await prisma.account.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();

  console.log("Benutzer…");
  const passwordHash = hashSync("Demo1234!", 10);
  const admin = await prisma.user.create({
    data: { email: "admin@demo.local", name: "Anna Berger", passwordHash, role: UserRole.Admin },
  });
  const editor = await prisma.user.create({
    data: { email: "editor@demo.local", name: "Matteo Rossi", passwordHash, role: UserRole.Editor },
  });
  await prisma.user.create({
    data: { email: "viewer@demo.local", name: "Léa Fischer", passwordHash, role: UserRole.Viewer },
  });

  console.log("Konten…");
  const privat = await prisma.account.create({
    data: {
      name: "Privatkonto",
      type: AccountType.Checking,
      iban: "CH9300762011623852957",
      openingBalanceCents: CHF(4200),
      color: "#6366f1",
      sortOrder: 0,
      notes: "Lohnkonto, laufende Ausgaben",
    },
  });
  const sparen = await prisma.account.create({
    data: {
      name: "Sparkonto",
      type: AccountType.Savings,
      openingBalanceCents: CHF(18500),
      color: "#10b981",
      sortOrder: 1,
    },
  });
  const karte = await prisma.account.create({
    data: {
      name: "Kreditkarte",
      type: AccountType.CreditCard,
      openingBalanceCents: CHF(-380),
      color: "#f59e0b",
      sortOrder: 2,
    },
  });
  const depot = await prisma.account.create({
    data: {
      name: "Wertschriftendepot",
      type: AccountType.Investment,
      openingBalanceCents: CHF(32000),
      color: "#8b5cf6",
      sortOrder: 3,
      excludeFromBudget: true,
      notes: "Zählt zum Vermögen, nicht zur Budgetauswertung",
    },
  });

  console.log("Kategorien…");
  const { seedDefaultCategories } = await import("../lib/categories");
  await seedDefaultCategories(prisma);

  const categories = await prisma.category.findMany({ where: { parentId: { not: null } } });
  const byName = new Map(categories.map((category) => [category.name, category]));
  const pick = (name: string) => {
    const category = byName.get(name);
    if (!category) throw new Error(`Kategorie "${name}" fehlt im Standardbaum.`);
    return category;
  };

  const lohn = pick("Lohn");
  const miete = pick("Miete / Hypothek");
  const lebensmittel = pick("Lebensmittel");
  const krankenkasse = pick("Krankenkasse");
  const auswaerts = pick("Auswärts essen");
  const oev = pick("ÖV-Abo");
  const abos = pick("Abos & Streaming");
  const kleidung = pick("Kleidung");
  const hobby = pick("Sport & Hobby");
  const strom = pick("Strom");

  console.log("Buchungen der letzten 12 Monate…");
  const today = new Date();
  const rows: {
    date: string;
    amountCents: number;
    accountId: number;
    categoryId: number | null;
    description: string;
    counterparty: string | null;
    transferGroupId?: string;
  }[] = [];

  for (let monthsAgo = 11; monthsAgo >= 0; monthsAgo--) {
    const anchor = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const on = (day: number) => dateString(new Date(year, month, day));

    rows.push({ date: on(25), amountCents: CHF(6800), accountId: privat.id, categoryId: lohn.id, description: "Lohn", counterparty: "Arbeitgeber AG" });
    rows.push({ date: on(1), amountCents: CHF(-1850), accountId: privat.id, categoryId: miete.id, description: "Miete", counterparty: "Immobilien Verwaltung AG" });
    rows.push({ date: on(3), amountCents: CHF(-486.4), accountId: privat.id, categoryId: krankenkasse.id, description: "Krankenkassenprämie", counterparty: "Krankenkasse" });
    rows.push({ date: on(5), amountCents: CHF(-89), accountId: privat.id, categoryId: oev.id, description: "ÖV-Abo", counterparty: "SBB" });
    rows.push({ date: on(8), amountCents: CHF(-faker.number.int({ min: 28, max: 55 })), accountId: karte.id, categoryId: abos.id, description: "Streaming-Abos", counterparty: "Diverse" });
    rows.push({ date: on(15), amountCents: CHF(-faker.number.int({ min: 95, max: 180 })), accountId: privat.id, categoryId: strom.id, description: "Stromrechnung", counterparty: "Elektrizitätswerk" });

    for (const day of [4, 11, 18, 25]) {
      rows.push({
        date: on(day),
        amountCents: CHF(-faker.number.float({ min: 62, max: 165, fractionDigits: 2 })),
        accountId: privat.id,
        categoryId: lebensmittel.id,
        description: "Wocheneinkauf",
        counterparty: faker.helpers.arrayElement(["Migros", "Coop", "Aldi Suisse", "Lidl"]),
      });
    }
    for (let i = 0; i < faker.number.int({ min: 2, max: 5 }); i++) {
      rows.push({
        date: on(faker.number.int({ min: 1, max: 28 })),
        amountCents: CHF(-faker.number.float({ min: 18, max: 95, fractionDigits: 2 })),
        accountId: karte.id,
        categoryId: auswaerts.id,
        description: "Restaurant",
        counterparty: faker.company.name(),
      });
    }
    if (faker.datatype.boolean(0.5)) {
      rows.push({
        date: on(faker.number.int({ min: 1, max: 28 })),
        amountCents: CHF(-faker.number.float({ min: 45, max: 220, fractionDigits: 2 })),
        accountId: karte.id,
        categoryId: faker.helpers.arrayElement([kleidung.id, hobby.id]),
        description: faker.commerce.productName(),
        counterparty: faker.company.name(),
      });
    }

    const transferGroupId = randomUUID();
    rows.push({ date: on(26), amountCents: CHF(-700), accountId: privat.id, categoryId: null, description: "Dauerauftrag Sparen", counterparty: null, transferGroupId });
    rows.push({ date: on(26), amountCents: CHF(700), accountId: sparen.id, categoryId: null, description: "Dauerauftrag Sparen", counterparty: null, transferGroupId });
  }

  // Two uncategorised bookings this month, so the dashboard/budget warning
  // cards and the "Ohne Kategorie" convention have something to show.
  rows.push({ date: dateString(new Date(today.getFullYear(), today.getMonth(), 21)), amountCents: CHF(-42.5), accountId: karte.id, categoryId: null, description: "Kartenzahlung", counterparty: "Unbekannt GmbH" });
  rows.push({ date: dateString(new Date(today.getFullYear(), today.getMonth(), 23)), amountCents: CHF(-18), accountId: privat.id, categoryId: null, description: "Twint", counterparty: "Marktstand" });

  const created = await prisma.transaction.createMany({
    data: rows.map((row) => ({ ...row, source: "Manual" as const, createdById: admin.id })),
  });
  console.log(`  ${created.count} Buchungen`);

  console.log("Budgets für den laufenden Monat…");
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const budgets: [number, number][] = [
    [lohn.id, CHF(6800)],
    [miete.id, CHF(1850)],
    [krankenkasse.id, CHF(490)],
    [lebensmittel.id, CHF(600)],
    [auswaerts.id, CHF(150)], // set below actual spend on purpose, to show "Überschritten"
    [oev.id, CHF(89)],
    [abos.id, CHF(50)],
    [strom.id, CHF(140)],
    [kleidung.id, CHF(150)],
    [hobby.id, CHF(120)],
  ];
  await prisma.budget.createMany({
    data: budgets.map(([categoryId, amountCents]) => ({ categoryId, year, month, amountCents })),
  });

  console.log("Rückstellungen und Sparziele…");
  const fiveDaysAgo = dateString(new Date(today.getTime() - 5 * 86_400_000));
  const nextYear = dateString(new Date(year + 1, 2, 31));
  await prisma.reserve.createMany({
    data: [
      {
        // In progress, due next year.
        name: "Steuern",
        targetAmountCents: CHF(6400),
        intervalMonths: 12,
        nextDueDate: nextYear,
        savedCents: CHF(2100),
        accountId: sparen.id,
      },
      {
        // Already overdue and short — shows the "Fällig" + "Unterdeckt"
        // badges and the dashboard/reserves shortfall warning.
        name: "Autoversicherung",
        targetAmountCents: CHF(980),
        intervalMonths: 12,
        nextDueDate: fiveDaysAgo,
        savedCents: CHF(420),
        accountId: sparen.id,
      },
      {
        // Fully funded — shows the "Vollständig zurückgelegt" state.
        name: "Serafe",
        targetAmountCents: CHF(335),
        intervalMonths: 12,
        nextDueDate: dateString(new Date(year + 1, 5, 1)),
        savedCents: CHF(335),
      },
    ],
  });
  await prisma.savingsGoal.createMany({
    data: [
      {
        name: "Ferien Norwegen",
        targetAmountCents: CHF(4500),
        savedCents: CHF(1800),
        targetDate: dateString(new Date(year + 1, 6, 1)),
        color: "#0ea5e9",
        accountId: sparen.id,
      },
      {
        // Already reached — shows the "Erreicht" badge.
        name: "Notgroschen",
        targetAmountCents: CHF(20000),
        savedCents: CHF(20000),
        color: "#10b981",
        accountId: sparen.id,
      },
    ],
  });

  console.log("Wiederkehrende Buchungen…");
  const nextMonthFirst = dateString(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  const lastWeek = dateString(new Date(today.getTime() - 6 * 86_400_000));
  await prisma.recurringTransaction.createMany({
    data: [
      {
        name: "Miete",
        amountCents: CHF(-1850),
        accountId: privat.id,
        categoryId: miete.id,
        intervalMonths: 1,
        startDate: nextMonthFirst,
        nextDate: nextMonthFirst,
      },
      {
        name: "Krankenkassenprämie",
        amountCents: CHF(-486.4),
        accountId: privat.id,
        categoryId: krankenkasse.id,
        intervalMonths: 1,
        startDate: nextMonthFirst,
        nextDate: nextMonthFirst,
      },
      {
        name: "Dauerauftrag Sparen",
        amountCents: CHF(700),
        accountId: privat.id,
        counterAccountId: sparen.id,
        intervalMonths: 1,
        startDate: nextMonthFirst,
        nextDate: nextMonthFirst,
      },
      {
        // Due and not auto-posted — shows up as a dashboard suggestion and
        // the "Nur Vorschlag" badge here.
        name: "Fitnessabo",
        amountCents: CHF(-79),
        accountId: karte.id,
        categoryId: hobby.id,
        intervalMonths: 1,
        startDate: lastWeek,
        nextDate: lastWeek,
        autoPost: false,
      },
      {
        // Paused — shows the "Pausiert" badge.
        name: "Zeitschriftenabo",
        amountCents: CHF(-24),
        accountId: karte.id,
        categoryId: abos.id,
        intervalMonths: 3,
        startDate: nextMonthFirst,
        nextDate: nextMonthFirst,
        isActive: false,
      },
    ],
  });

  console.log("Importregeln…");
  await prisma.importRule.createMany({
    data: [
      { name: "Migros", field: RuleField.Counterparty, matchType: RuleMatch.Contains, pattern: "migros", categoryId: lebensmittel.id, priority: 10 },
      { name: "Coop", field: RuleField.Counterparty, matchType: RuleMatch.Contains, pattern: "coop", categoryId: lebensmittel.id, priority: 10 },
      { name: "SBB", field: RuleField.Counterparty, matchType: RuleMatch.Contains, pattern: "sbb", categoryId: oev.id, priority: 10 },
      { name: "Lohn", field: RuleField.Description, matchType: RuleMatch.Contains, pattern: "lohn", categoryId: lohn.id, priority: 5 },
      { name: "Kreditkarte-Ausgleich", field: RuleField.Description, matchType: RuleMatch.Contains, pattern: "kreditkarte", transferAccountId: karte.id, priority: 5 },
    ],
  });

  console.log("CSV-Mapping…");
  await prisma.csvMapping.create({
    data: {
      name: "Kreditkarte Bank",
      delimiter: ";",
      dateColumn: 0,
      dateFormat: "DD.MM.YYYY",
      descriptionColumn: 1,
      amountColumn: 2,
      invertAmount: true,
      counterpartyColumn: 3,
    },
  });

  console.log("Systemeinstellungen…");
  await prisma.systemSettings.upsert({
    where: { id: 1 },
    create: {
      currency: "CHF",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "haushalt.demo@gmail.com",
      smtpPassword: encryptSecret("super-secret-demo-password"),
      smtpFromName: "Haushaltsbudget",
      smtpFromAddress: "budget@demo.local",
    },
    update: {},
  });

  console.log("Audit-Log…");
  const auditRows: { userId: number; userName: string; action: string; entityType: string; entityId: number | null; details: string | null; createdAt: Date }[] = [
    {
      userId: admin.id,
      userName: admin.name,
      action: "CREATE",
      entityType: "Account",
      entityId: depot.id,
      details: JSON.stringify({ name: depot.name }),
      createdAt: new Date(today.getTime() - 30 * 86_400_000),
    },
    {
      userId: editor.id,
      userName: editor.name,
      action: "UPDATE",
      entityType: "Budget",
      entityId: null,
      details: JSON.stringify({ categoryName: "Lebensmittel", year, month, amountCents: CHF(600) }),
      createdAt: new Date(today.getTime() - 10 * 86_400_000),
    },
    {
      userId: admin.id,
      userName: admin.name,
      action: "SETTINGS",
      entityType: "Settings",
      entityId: null,
      details: JSON.stringify({ smtpHost: "smtp.gmail.com" }),
      createdAt: new Date(today.getTime() - 9 * 86_400_000),
    },
    {
      userId: editor.id,
      userName: editor.name,
      action: "CREATE",
      entityType: "RecurringTransaction",
      entityId: null,
      details: JSON.stringify({ name: "Fitnessabo" }),
      createdAt: new Date(today.getTime() - 3 * 86_400_000),
    },
    {
      userId: admin.id,
      userName: admin.name,
      action: "UPDATE",
      entityType: "Account",
      entityId: karte.id,
      details: JSON.stringify({ name: karte.name, isActive: true }),
      createdAt: new Date(today.getTime() - 1 * 86_400_000),
    },
  ];
  for (const row of auditRows) {
    await prisma.auditLog.create({ data: row });
  }

  console.log("\nFertig. Login: admin@demo.local / editor@demo.local / viewer@demo.local, Passwort Demo1234!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
