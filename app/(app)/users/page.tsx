import { Plus } from "lucide-react";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { ROLE_LABELS, UserFormDialog } from "./user-form-dialog";
import { UserRowActions } from "./user-row-actions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireAdmin();
  const ownId = parseInt(session.user.id, 10);

  // Explicit select: these rows are passed to Client Components, so anything
  // listed here travels to the browser in the RSC payload. Never widen this to
  // the whole row — it carries passwordHash and the 2FA secret/backup codes.
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="Benutzer"
        description="Alle Benutzer teilen sich dieselben Konten und Buchungen."
      >
        <UserFormDialog
          trigger={
            <Button>
              <Plus className="h-4 w-4" /> Neuer Benutzer
            </Button>
          }
        />
      </PageHeader>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>E-Mail</TableHead>
                  <TableHead>Rolle</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className={user.isActive ? "" : "opacity-55"}>
                    <TableCell>
                      <span className="font-medium">{user.name}</span>
                      {user.id === ownId && (
                        <Badge variant="secondary" className="ml-2">
                          Du
                        </Badge>
                      )}
                      {!user.isActive && (
                        <Badge variant="outline" className="ml-2">
                          Inaktiv
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "Admin" ? "default" : "outline"}>
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <UserRowActions user={user} isSelf={user.id === ownId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="md:hidden divide-y">
            {users.map((user) => (
              <li
                key={user.id}
                className={`flex items-start justify-between gap-3 p-4 ${user.isActive ? "" : "opacity-55"}`}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {user.name}
                    {user.id === ownId && (
                      <Badge variant="secondary" className="ml-2">
                        Du
                      </Badge>
                    )}
                    {!user.isActive && (
                      <Badge variant="outline" className="ml-2">
                        Inaktiv
                      </Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                  <Badge variant={user.role === "Admin" ? "default" : "outline"} className="mt-1.5">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </div>
                <UserRowActions user={user} isSelf={user.id === ownId} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
