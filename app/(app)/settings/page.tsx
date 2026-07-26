import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { config } from "@/lib/config";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import type { EditableSettings } from "./types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();

  // Explicit select, without smtpPassword: the row is passed to a Client
  // Component, so anything selected here is serialized into the RSC payload.
  // The stored credential stays on the server; the form only learns whether
  // one exists (hasSmtpPassword below).
  const stored = await prisma.systemSettings.findUnique({
    where: { id: 1 },
    select: {
      currency: true,
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      smtpFromName: true,
      smtpFromAddress: true,
      smtpPassword: true,
    },
  });
  const settings: EditableSettings | null = stored
    ? {
        currency: stored.currency,
        smtpHost: stored.smtpHost,
        smtpPort: stored.smtpPort,
        smtpUser: stored.smtpUser,
        smtpFromName: stored.smtpFromName,
        smtpFromAddress: stored.smtpFromAddress,
      }
    : null;

  const [transactionCount, accountCount, categoryCount] = await Promise.all([
    prisma.transaction.count(),
    prisma.account.count(),
    prisma.category.count(),
  ]);

  return (
    <>
      <PageHeader title="Einstellungen" />

      <SettingsForm settings={settings} hasSmtpPassword={!!stored?.smtpPassword} />

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Automatische Abläufe</CardTitle>
            <CardDescription>Über Umgebungsvariablen konfigurierbar</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Wiederkehrende Buchungen</dt>
              <dd className="font-mono text-xs">{config.recurring.cronSchedule}</dd>
              <dt className="text-muted-foreground">Zeitzone</dt>
              <dd className="font-mono text-xs">{config.recurring.timezone}</dd>
              <dt className="text-muted-foreground">Backup</dt>
              <dd className="font-mono text-xs">{config.backup.cronSchedule}</dd>
              <dt className="text-muted-foreground">Backups aufbewahren</dt>
              <dd className="font-mono text-xs">
                {config.backup.maxKeepDays === 0 ? "alle" : `${config.backup.maxKeepDays} Tage`}
              </dd>
              <dt className="text-muted-foreground">Audit-Log aufbewahren</dt>
              <dd className="font-mono text-xs">
                {config.audit.retentionDays === 0
                  ? "unbegrenzt"
                  : `${config.audit.retentionDays} Tage`}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datenbestand</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Buchungen</dt>
              <dd className="tabular-nums">{transactionCount}</dd>
              <dt className="text-muted-foreground">Konten</dt>
              <dd className="tabular-nums">{accountCount}</dd>
              <dt className="text-muted-foreground">Kategorien</dt>
              <dd className="tabular-nums">{categoryCount}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
