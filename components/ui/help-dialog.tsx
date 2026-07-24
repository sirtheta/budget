"use client";

import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function HelpDialog({
  title,
  label,
  children,
}: {
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          aria-label={label}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
