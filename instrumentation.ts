export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Must run before anything imports "@/lib/logger" — pino locks its
    // destination in at construction time and, unless process.stdout/stderr
    // are already patched by then, writes straight to file descriptor 1/2,
    // bypassing process.stdout.write entirely. lib/log-capture.ts has no
    // dependency on lib/logger for exactly this reason.
    const { startLogCapture } = await import("@/lib/log-capture");
    startLogCapture();

    const { validateEnv } = await import("@/lib/env");
    validateEnv();
    const { default: prisma } = await import("@/lib/prisma");
    const { default: logger } = await import("@/lib/logger");
    const log = logger.child({ module: "instrumentation" });

    const { startRecurringScheduler } = await import("@/lib/recurring");
    startRecurringScheduler();

    const { startBackupScheduler } = await import("@/lib/backup");
    startBackupScheduler();

    const { startLogRotationScheduler } = await import("@/lib/logs");
    startLogRotationScheduler();

    // Checkpoint WAL on shutdown so SQLite WAL changes flush to main .db file.
    // NEXT_MANUAL_SIG_HANDLE=true (set in the Dockerfile) disables Next's own
    // SIGTERM/SIGINT handler so this is the only thing exiting the process.
    const shutdown = () => {
      const forceExit = setTimeout(() => process.exit(0), 5000);
      prisma
        .$disconnect()
        .then(() => log.info("DB connection closed, WAL checkpointed."))
        .catch((err) => log.error({ err }, "Error during DB disconnect"))
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
