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

  const users = await prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });

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
          <div className="overflow-x-auto">
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
        </CardContent>
      </Card>
    </>
  );
}
