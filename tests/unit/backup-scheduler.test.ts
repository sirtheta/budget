import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { cronValidate, cronSchedule, mockConfig } = vi.hoisted(() => ({
  cronValidate: vi.fn((s: string) => /^(\S+\s+){4}\S+$/.test(s)),
  cronSchedule: vi.fn(() => ({ stop: vi.fn() })),
  mockConfig: { backup: { cronSchedule: "30 2 * * *", maxKeepDays: 14 } },
}));

vi.mock("node-cron", () => ({
  default: { validate: cronValidate, schedule: cronSchedule },
}));
vi.mock("@/lib/config", () => ({ config: mockConfig }));

import { startBackupScheduler } from "@/lib/backup";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  cronValidate.mockClear();
  cronSchedule.mockClear();
  mockConfig.backup.cronSchedule = "30 2 * * *";
  delete (globalThis as unknown as { backupSchedulerStarted?: boolean }).backupSchedulerStarted;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("startBackupScheduler", () => {
  it("registers the cron job when enabled with a valid schedule", () => {
    startBackupScheduler();
    expect(cronSchedule).toHaveBeenCalledWith("30 2 * * *", expect.any(Function));
  });

  it("does not register a second time once started", () => {
    startBackupScheduler();
    startBackupScheduler();
    expect(cronSchedule).toHaveBeenCalledTimes(1);
  });

  it("skips registration when DISABLE_BACKUP=true", () => {
    process.env.DISABLE_BACKUP = "true";
    startBackupScheduler();
    expect(cronSchedule).not.toHaveBeenCalled();
  });

  it("skips registration when the configured cron schedule is invalid", () => {
    mockConfig.backup.cronSchedule = "not-a-cron-schedule";
    startBackupScheduler();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
});
