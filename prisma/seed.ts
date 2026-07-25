/**
 * Development seed: a household with a year of plausible bookings.
 *
 * Realistic volume matters here — budget evaluations, the category donut and
 * the net-worth trend all look fine with three rows and only reveal their
 * problems with a year of data.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { hashSync } from "bcryptjs";
import { faker } from "@faker-js/faker";
import { randomUUID } from "crypto";

const url = (process.env.DATABASE_URL ?? "file:./data/budget.db").replace(/^file:/, "");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const CHF = (francs: number) => Math.round(francs * 100);

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Der Seed darf nicht gegen eine Produktionsdatenbank laufen.");
  }

  console.log("Bestehende Daten löschen…");
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
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  console.log("Benutzer…");
  const adminPasswordHash = hashSync("admin123", 10);
  const partnerPasswordHash = hashSync("admin123", 10);
  const admin = await prisma.user.create({
    data: { email: "admin@example.com", name: "Admin", passwordHash: adminPasswordHash, role: "Admin" },
  });
  await prisma.user.create({
    data: { email: "partner@example.com", name: "Partner", passwordHash: partnerPasswordHash, role: "Editor" },
  });

  console.log("Konten…");
  const privat = await prisma.account.create({
    data: {
      name: "Privatkonto",
      type: "Checking",
      iban: "CH9300762011623852957",
      openingBalanceCents: CHF(4200),
      color: "#6366f1",
      sortOrder: 0,
    },
  });
  const sparen = await prisma.account.create({
    data: {
      name: "Sparkonto",
      type: "Savings",
      openingBalanceCents: CHF(18500),
      color: "#10b981",
      sortOrder: 1,
    },
  });
  const karte = await prisma.account.create({
    data: {
      name: "Kreditkarte",
      type: "CreditCard",
      openingBalanceCents: CHF(-380),
      color: "#f59e0b",
      sortOrder: 2,
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

    rows.push({
      date: on(25),
      amountCents: CHF(6800),
      accountId: privat.id,
      categoryId: lohn.id,
      description: "Lohn",
      counterparty: "Arbeitgeber AG",
    });
    rows.push({
      date: on(1),
      amountCents: CHF(-1850),
      accountId: privat.id,
      categoryId: miete.id,
      description: "Miete",
      counterparty: "Immobilien Verwaltung AG",
    });
    rows.push({
      date: on(3),
      amountCents: CHF(-486.4),
      accountId: privat.id,
      categoryId: krankenkasse.id,
      description: "Krankenkassenprämie",
      counterparty: "Krankenkasse",
    });
    rows.push({
      date: on(5),
      amountCents: CHF(-89),
      accountId: privat.id,
      categoryId: oev.id,
      description: "ÖV-Abo",
      counterparty: "SBB",
    });
    rows.push({
      date: on(8),
      amountCents: CHF(-faker.number.int({ min: 28, max: 55 })),
      accountId: karte.id,
      categoryId: abos.id,
      description: "Streaming-Abos",
      counterparty: "Diverse",
    });
    rows.push({
      date: on(15),
      amountCents: CHF(-faker.number.int({ min: 95, max: 180 })),
      accountId: privat.id,
      categoryId: strom.id,
      description: "Stromrechnung",
      counterparty: "Elektrizitätswerk",
    });

    // Weekly groceries, plus the odd meal out and a discretionary purchase.
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

    // Monthly standing order to savings, as a proper two-legged transfer.
    const transferGroupId = randomUUID();
    rows.push({
      date: on(26),
      amountCents: CHF(-700),
      accountId: privat.id,
      categoryId: null,
      description: "Dauerauftrag Sparen",
      counterparty: null,
      transferGroupId,
    });
    rows.push({
      date: on(26),
      amountCents: CHF(700),
      accountId: sparen.id,
      categoryId: null,
      description: "Dauerauftrag Sparen",
      counterparty: null,
      transferGroupId,
    });
  }

  await prisma.transaction.createMany({
    data: rows.map((row) => ({ ...row, source: "Manual" as const, createdById: admin.id })),
  });
  console.log(`  ${rows.length} Buchungen`);

  console.log("Budgets für den laufenden Monat…");
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const budgets: [number, number][] = [
    [lohn.id, CHF(6800)],
    [miete.id, CHF(1850)],
    [krankenkasse.id, CHF(490)],
    [lebensmittel.id, CHF(600)],
    [auswaerts.id, CHF(200)],
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
  await prisma.reserve.createMany({
    data: [
      {
        name: "Steuern",
        targetAmountCents: CHF(6400),
        intervalMonths: 12,
        nextDueDate: `${year + 1}-03-31`,
        savedCents: CHF(2100),
        accountId: sparen.id,
      },
      {
        name: "Autoversicherung",
        targetAmountCents: CHF(980),
        intervalMonths: 12,
        nextDueDate: `${year + 1}-01-15`,
        savedCents: CHF(420),
        accountId: sparen.id,
      },
      {
        name: "Serafe",
        targetAmountCents: CHF(335),
        intervalMonths: 12,
        nextDueDate: `${year + 1}-06-01`,
        savedCents: CHF(85),
      },
    ],
  });
  await prisma.savingsGoal.createMany({
    data: [
      {
        name: "Ferien Norwegen",
        targetAmountCents: CHF(4500),
        savedCents: CHF(1800),
        targetDate: `${year + 1}-07-01`,
        color: "#0ea5e9",
        accountId: sparen.id,
      },
      {
        name: "Notgroschen",
        targetAmountCents: CHF(20000),
        savedCents: CHF(12400),
        color: "#10b981",
        accountId: sparen.id,
      },
    ],
  });

  console.log("Wiederkehrende Buchungen…");
  const nextMonthFirst = dateString(new Date(today.getFullYear(), today.getMonth() + 1, 1));
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
    ],
  });

  console.log("Importregeln…");
  await prisma.importRule.createMany({
    data: [
      { name: "Migros", pattern: "migros", categoryId: lebensmittel.id, priority: 10 },
      { name: "Coop", pattern: "coop", categoryId: lebensmittel.id, priority: 10 },
      { name: "SBB", pattern: "sbb", categoryId: oev.id, priority: 10 },
      { name: "Lohn", pattern: "lohn", categoryId: lohn.id, priority: 5 },
    ],
  });

  await prisma.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  console.log("\nFertig. Login: admin@example.com / admin123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
