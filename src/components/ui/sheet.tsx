import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";

const Sheet = SheetPrimitive.Root;

/**
 * A panel that slides in from the left edge over a dimmed page. Focus moves into it and stays
 * there while open. Its content stays mounted while closed, so its state and handles survive.
 */
function SheetContent({ className, children, ...props }: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal keepMounted>
      <SheetPrimitive.Backdrop
        data-slot="sheet-backdrop"
        className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-(--duration-slow) data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-80 max-w-[calc(100%-3rem)] flex-col border-r bg-chrome shadow-lg outline-none transition-transform duration-(--duration-slow) data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-medium text-sm", className)}
      {...props}
    />
  );
}

function SheetClose(props: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetTitle };
