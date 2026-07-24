"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import type { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "@/components/nav-links";

export function MobileNav({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menü öffnen" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Haushaltsbudget</SheetTitle>
        </SheetHeader>
        <NavLinks role={role} vertical onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
