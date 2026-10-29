// A reference of every keyboard shortcut in the workbench, grouped by where it works. Only the
// palette's shortcut and Escape work anywhere; the rest belong to the part that has focus.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { apple, runShortcut } from "@/features/editor/shortcut";
import { paletteShortcut } from "./command";

const appleSymbols: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };

/** Keys pressed together, as this device labels them: "Ctrl+Shift+K", or "⇧⌘K" on Apple. */
function keys(...parts: string[]): string {
  return apple
    ? parts.map((part) => appleSymbols[part] ?? part).join("")
    : parts.map((part) => (part === "Mod" ? "Ctrl" : part)).join("+");
}

const groups: { title: string; shortcuts: [action: string, keys: string][] }[] = [
  {
    title: "Anywhere",
    shortcuts: [
      ["Open the command palette", paletteShortcut.label],
      ["Close a dialog or the palette", "Esc"],
      ["Cancel the running query", "Esc"],
    ],
  },
  {
    title: "SQL editor",
    shortcuts: [
      ["Run the query, or the selected part", runShortcut.label],
      ["Suggest completions", keys("Ctrl", "Space")],
      ["Undo", keys("Mod", "Z")],
      ["Redo", apple ? keys("Shift", "Mod", "Z") : keys("Mod", "Y")],
      ["Comment or uncomment lines", keys("Mod", "/")],
      ["Indent or outdent lines", `${keys("Mod", "]")} / ${keys("Mod", "[")}`],
      ["Move lines up or down", `${keys("Alt", "↑")} / ${keys("Alt", "↓")}`],
      ["Delete lines", keys("Shift", "Mod", "K")],
      ["Leave the editor", "Tab"],
    ],
  },
  {
    title: "Tables list",
    shortcuts: [
      ["Move between tables and columns", "↑ / ↓"],
      ["Show or hide a table's columns", "→ / ←"],
      ["Insert the name into the editor", "Enter"],
      ["Show a table's rows", "R"],
      ["Profile a table", "P"],
      ["Convert a CSV table to Parquet", "C"],
      ["Forget a table", "Delete"],
    ],
  },
  {
    title: "Results table",
    shortcuts: [
      ["Move between cells", "↑ ↓ ← →"],
      ["Move a screen up or down", "Page Up / Page Down"],
      ["Go to the start or end of the row", "Home / End"],
      ["Go to the first or last cell", `${keys("Mod", "Home")} / ${keys("Mod", "End")}`],
      ["Select cells", keys("Shift", "arrows")],
      ["Copy the selected cells", keys("Mod", "C")],
      ["Narrow or widen the column", `${keys("Alt", "←")} / ${keys("Alt", "→")}`],
    ],
  },
];

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        {/* Close comes first, so focusing it on opening doesn't scroll the list to its end. */}
        <div className="flex items-center justify-between">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
        </div>
        <DialogDescription>
          Shortcuts in the editor and the lists work while they have focus.
        </DialogDescription>
        {groups.map(({ title, shortcuts }) => (
          <table key={title} className="w-full">
            <caption className="pb-1 text-left font-medium">{title}</caption>
            <tbody>
              {shortcuts.map(([action, shortcut]) => (
                <tr key={action} className="border-t">
                  <th scope="row" className="py-1 text-left font-normal">
                    {action}
                  </th>
                  <td className="py-1 text-right">
                    <kbd className="rounded-sm border px-1 font-sans">{shortcut}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </DialogContent>
    </Dialog>
  );
}
