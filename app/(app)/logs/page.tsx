import { requireAdmin } from "@/lib/permissions";
import { listLogFiles } from "@/lib/logs";
import { formatDateCH } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function LogsPage() {
  await requireAdmin();

  const files = listLogFiles();

  return (
    <>
      <PageHeader
        title="Logs"
        description="Anwendungs-Logs zum Herunterladen — bisher nur über `docker logs` einsehbar. Die laufende Datei wird täglich abgeschnitten; ältere Tage bleiben so lange, wie die Aufbewahrungsfrist es erlaubt."
      />

      <Card>
        <CardContent className="p-0">
          {files.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Noch keine Logdateien vorhanden.
            </p>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Datum</TableHead>
                    <TableHead>Datei</TableHead>
                    <TableHead className="w-28">Grösse</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.name}>
                      <TableCell className="text-sm tabular-nums whitespace-nowrap">
                        {formatDateCH(file.date)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {file.name}
                        {file.current && (
                          <Badge variant="outline" className="ml-2">
                            Laufend
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatSize(file.sizeBytes)}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <a href={`/api/logs/${encodeURIComponent(file.name)}`}>
                            Herunterladen
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="md:hidden divide-y">
              {files.map((file) => (
                <li key={file.name} className="flex items-center justify-between gap-2 p-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      {file.name}
                      {file.current && <Badge variant="outline">Laufend</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateCH(file.date)} · {formatSize(file.sizeBytes)}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/logs/${encodeURIComponent(file.name)}`}>Herunterladen</a>
                  </Button>
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
