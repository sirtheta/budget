import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { actionLabel, describeAuditLog, entityLabel } from "@/lib/audit-format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function AuditPage() {
  await requireAdmin();

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  return (
    <>
      <PageHeader
        title="Audit-Log"
        description={`Die letzten ${PAGE_SIZE} Änderungen. Ältere Einträge werden automatisch bereinigt.`}
      />

      <Card>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Einträge.
            </p>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Zeitpunkt</TableHead>
                    <TableHead className="w-36">Benutzer</TableHead>
                    <TableHead className="w-32">Aktion</TableHead>
                    <TableHead className="w-32">Objekt</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
                        {log.createdAt.toLocaleString("de-CH")}
                      </TableCell>
                      <TableCell className="text-sm">{log.userName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{actionLabel(log.action)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entityLabel(log.entityType)}
                      </TableCell>
                      <TableCell className="text-sm">{describeAuditLog(log)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden divide-y">
              {logs.map((log) => (
                <li key={log.id} className="flex flex-col gap-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{actionLabel(log.action)}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {log.createdAt.toLocaleString("de-CH")}
                    </span>
                  </div>
                  <p className="text-sm">{describeAuditLog(log)}</p>
                  <p className="text-xs text-muted-foreground">
                    {log.userName} · {entityLabel(log.entityType)}
                  </p>
                </li>
              ))}
            </ul>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
