export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    const { default: prisma } = await import("@/lib/prisma");

    const { startRecurringScheduler } = await import("@/lib/recurring");
    startRecurringScheduler();

    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();

    // Checkpoint WAL on shutdown so SQLite WAL changes flush to main .db file.
    // NEXT_MANUAL_SIG_HANDLE=true (set in the Dockerfile) disables Next's own
    // SIGTERM/SIGINT handler so this is the only thing exiting the process.
    const shutdown = () => {
      const forceExit = setTimeout(() => process.exit(0), 5000);
      prisma
        .$disconnect()
        .then(() => console.log("[instrumentation] DB connection closed, WAL checkpointed."))
        .catch((err) => console.error("[instrumentation] Error during DB disconnect:", err))
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
