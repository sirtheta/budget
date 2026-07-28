import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { RemoveScroll } from "react-remove-scroll";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

// A plain div rather than `DialogPrimitive.Overlay`: Radix's own Overlay
// renders nothing when the Dialog is `modal={false}` (used by dialogs that
// hold a Combobox — see combobox.tsx for why), which would drop the dimmed
// backdrop and background scroll lock along with the focus trap we actually
// wanted to relax.
function DialogOverlay({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("fixed inset-0 z-50 bg-black/50", className)} {...props} />;
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* `RemoveScroll` restores the background scroll lock Radix drops for
          `modal={false}`. It must wrap the overlay *and* the content: touch
          scrolling is only permitted inside its own subtree, and a nested
          Combobox/Select popover renders through further portals that are
          still descendants of this one in the React tree — outside it, its
          dropdown list would be unscrollable by touch on mobile. */}
      <RemoveScroll allowPinchZoom>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg",
            className
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 outline-none hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Schliessen</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </RemoveScroll>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
