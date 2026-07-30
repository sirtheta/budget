import type { Category } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { CATEGORY_KIND_LABELS } from "@/lib/categories";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryFormDialog } from "./category-form-dialog";
import { CategoryRowActions } from "./category-row-actions";
import { SeedDefaultsButton } from "./seed-defaults-button";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  await requireEditor();

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactions: true } } },
  });

  const parents = categories
    .filter((c) => c.parentId === null)
    .map(({ id, name, kind, color }) => ({ id, name, kind, color }));
  const childrenOf = new Map<number, typeof categories>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    const list = childrenOf.get(category.parentId) ?? [];
    list.push(category);
    childrenOf.set(category.parentId, list);
  }

  const groups = categories.filter((c) => c.parentId === null);
  const income = groups.filter((c) => c.kind === "Income");
  const expense = groups.filter((c) => c.kind === "Expense");

  return (
    <>
      <PageHeader
        title="Kategorien"
        description="Zwei Ebenen: Gruppen und darunter die Kategorien, auf die gebucht wird."
      >
        {categories.length === 0 && <SeedDefaultsButton />}
        <CategoryFormDialog
          parents={parents}
        />
      </PageHeader>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Noch keine Kategorien. Am schnellsten geht es mit den Standardkategorien für einen
              Schweizer Haushalt — anpassen kannst du sie danach jederzeit.
            </p>
            <div className="flex justify-center">
              <SeedDefaultsButton />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <CategorySection
            title="Einnahmen"
            groups={income}
            childrenOf={childrenOf}
            parents={parents}
          />
          <CategorySection
            title="Ausgaben"
            groups={expense}
            childrenOf={childrenOf}
            parents={parents}
          />
        </div>
      )}
    </>
  );
}

type CategoryWithCount = Category & { _count: { transactions: number } };

function CategorySection({
  title,
  groups,
  childrenOf,
  parents,
}: {
  title: string;
  groups: CategoryWithCount[];
  childrenOf: Map<number, CategoryWithCount[]>;
  parents: Pick<Category, "id" | "name" | "kind" | "color">[];
}) {
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {groups.map((group) => {
        const children = childrenOf.get(group.id) ?? [];
        return (
          <Card key={group.id} className={group.isActive ? "" : "opacity-55"}>
            <CardHeader className="flex-row items-center justify-between gap-2 group">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color ?? "#6366f1" }}
                  aria-hidden
                />
                {group.name}
                {!group.isActive && <Badge variant="outline">Inaktiv</Badge>}
                {children.length === 0 && (
                  <Badge variant="secondary">
                    {CATEGORY_KIND_LABELS[group.kind]} · direkt bebuchbar
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                <CategoryFormDialog
                  parents={parents}
                  defaultParentId={group.id}
                  defaultKind={group.kind}
                />
                <CategoryRowActions category={group} parents={parents} />
              </div>
            </CardHeader>
            {children.length > 0 && (
              <CardContent className="pt-0">
                <ul className="divide-y">
                  {children.map((child) => (
                    <li
                      key={child.id}
                      className={`flex items-center justify-between gap-2 py-1.5 group ${
                        child.isActive ? "" : "opacity-55"
                      }`}
                    >
                      <span className="text-sm">
                        {child.name}
                        {!child.isActive && (
                          <Badge variant="outline" className="ml-2">
                            Inaktiv
                          </Badge>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {child._count.transactions}
                        </span>
                        <CategoryRowActions category={child} parents={parents} />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
