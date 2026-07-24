/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = (process.env.DATABASE_URL ?? 'file:/app/data/budget.db').replace(/^file:/, '');
const dataDir = path.dirname(dbPath);

ensureSecrets(dataDir);

const db = new Database(dbPath);
try {
  applyMigrations(db);
  seedAdminUser(db, dataDir);
  ensureSystemSettings(db);
} finally {
  db.close();
}

// ── Auto-generate AUTH_SECRET / ENCRYPTION_KEY if not provided ───────────────
// Allows `docker compose up` without a .env file: instead of shipping known
// default secrets, each installation gets its own random ones, persisted in
// the data volume so sessions and encrypted settings survive restarts.
// Generated values are written to secrets.env, which the container entrypoint
// sources before starting the server. Env-provided values always win: they
// are never overwritten here and secrets.env only contains the missing ones.
function ensureSecrets(dir) {
  const storePath = path.join(dir, 'secrets.json');
  const envPath = path.join(dir, 'secrets.env');

  let store = {};
  if (fs.existsSync(storePath)) {
    try {
      store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch {
      console.warn('[startup] Could not parse secrets.json — regenerating missing secrets.');
    }
  }

  const generators = {
    AUTH_SECRET: () => crypto.randomBytes(48).toString('base64'),
    ENCRYPTION_KEY: () => crypto.randomBytes(32).toString('hex'),
  };

  let storeChanged = false;
  const lines = [];
  for (const [name, generate] of Object.entries(generators)) {
    if (process.env[name]) continue; // explicitly configured — never override
    if (!store[name]) {
      store[name] = generate();
      storeChanged = true;
      console.log(`[startup] ${name} not set — generated and persisted in the data volume.`);
    }
    process.env[name] = store[name];
    lines.push(`${name}='${store[name]}'`);
  }

  if (storeChanged) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  }
  // Rewritten every boot so values later provided via env drop out of the file.
  fs.writeFileSync(envPath, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 });
}

// ── Apply pending Prisma migrations ──────────────────────────────────────────
// The production image has no Prisma CLI (it's a devDependency, pruned out), so
// we apply the migration SQL ourselves. Tracked in `_prisma_migrations` so this
// is idempotent and only new migrations run on an app upgrade.
function applyMigrations(db) {
  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[startup] No migrations directory found — skipping migrations.');
    return;
  }

  db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  TEXT PRIMARY KEY NOT NULL,
    "checksum"            TEXT NOT NULL,
    "finished_at"         DATETIME,
    "migration_name"      TEXT NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      DATETIME,
    "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );`);

  const applied = new Set(
    db
      .prepare('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')
      .all()
      .map((row) => row.migration_name),
  );

  const folders = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of folders) {
    if (applied.has(name)) continue;

    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const now = new Date().toISOString();

    db.pragma('foreign_keys = OFF');
    try {
      const run = db.transaction(() => {
        db.exec(sql);
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
           VALUES (?, ?, ?, ?, ?, 1)`,
        ).run(crypto.randomUUID(), checksum, now, name, now);
      });
      run();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    console.log(`[startup] Applied migration: ${name}`);
  }
}

// ── Seed admin user if no users exist ────────────────────────────────────────
function seedAdminUser(db, dataDir) {
  try {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM "User"').get();
    if (count > 0) return;

    const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
    const name = process.env.ADMIN_NAME ?? 'Admin';
    let hash = process.env.ADMIN_PASSWORD_HASH;

    if (!hash) {
      let pw = process.env.ADMIN_PASSWORD;
      if (pw) {
        console.log('[startup] No ADMIN_PASSWORD_HASH set — hashed ADMIN_PASSWORD.');
      } else {
        pw = crypto.randomBytes(12).toString('base64url');
        // Written to a file instead of the console so the one-time password
        // doesn't end up in aggregated/retained container logs.
        const pwPath = path.join(dataDir, 'initial-admin-password.txt');
        fs.writeFileSync(pwPath, `${pw}\n`, { mode: 0o600 });
        console.log(`[startup] No ADMIN_PASSWORD(_HASH) set — one-time admin password written to ${pwPath}`);
        console.log('[startup] Log in with it, change it immediately, then delete the file.');
      }
      hash = bcrypt.hashSync(pw, 10);
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO "User" (email, name, passwordHash, role, isActive, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Admin', 1, ?, ?)`,
    ).run(email, name, hash, now, now);
    console.log(`[startup] Admin user created: ${email}`);
  } catch (err) {
    console.error('[startup] Admin seeding failed:', err.message);
    throw err;
  }
}

function ensureSystemSettings(db) {
  db.prepare(`INSERT OR IGNORE INTO "SystemSettings" (id, currency, updatedAt) VALUES (1, ?, ?)`).run(
    process.env.DEFAULT_CURRENCY ?? 'CHF',
    new Date().toISOString(),
  );
}
