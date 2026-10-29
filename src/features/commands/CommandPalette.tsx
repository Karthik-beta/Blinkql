// The command palette: a searchable list of everything the workbench can do, opened with Ctrl+K
// (⌘K on Apple devices) from anywhere, the SQL editor included. It follows the ARIA combobox
// pattern: focus stays in the search box, and the arrow keys move the active option.
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { type Command, isPaletteShortcut, paletteShortcut } from "./command";

type Props = { commands: readonly Command[] };

/** The "Commands" button, its shortcut and the palette they open. */
export function CommandPalette({ commands }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Runs once the palette has closed and given focus back, so a command that opens a dialog or
  // moves focus isn't undone by that.
  const chosen = useRef<Command | null>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      // Browsers use Ctrl+K for their own search box.
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const needle = search.trim().toLowerCase();
  const matches = commands.filter(({ label }) => label.toLowerCase().includes(needle));
  const active = matches[Math.min(activeIndex, matches.length - 1)];
  const optionId = (command: Command) => `${id}-${command.id}`;

  const choose = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    chosen.current = command;
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && matches.length > 0) {
      event.preventDefault();
      const from = active ? matches.indexOf(active) : 0;
      setActiveIndex((from + step + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  };

  useEffect(() => {
    if (open && active)
      document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        // Cleared once closed rather than on opening, so the list doesn't change as it fades out.
        setSearch("");
        setActiveIndex(0);
        const command = chosen.current;
        chosen.current = null;
        command?.run();
      }}
    >
      <Button
        variant="outline"
        size="sm"
        aria-keyshortcuts={paletteShortcut.aria}
        onClick={() => setOpen(true)}
      >
        <Search data-icon="inline-start" aria-hidden />
        Commands
        <kbd aria-hidden className="ml-1 rounded-sm border px-1 font-sans font-normal">
          {paletteShortcut.keys}
        </kbd>
      </Button>
      <DialogContent className="top-[15dvh] max-w-lg translate-y-0 gap-2 p-2">
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <input
          role="combobox"
          aria-label="Search commands"
          aria-expanded={matches.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-autocomplete="list"
          placeholder="Search commands"
          autoComplete="off"
          spellCheck={false}
          className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        {matches.length > 0 ? (
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label="Commands"
            className="flex max-h-[50dvh] flex-col overflow-y-auto"
          >
            {matches.map((command) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search box takes the keys for it
              <div
                key={command.id}
                id={optionId(command)}
                role="option"
                // Not in the Tab order: focus stays in the search box.
                tabIndex={-1}
                aria-selected={command === active}
                aria-disabled={command.disabled || undefined}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-ring hover:bg-muted aria-disabled:opacity-50 aria-selected:bg-muted aria-selected:outline-2 aria-selected:-outline-offset-2"
                // Keeps focus in the search box.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(command)}
              >
                {command.label}
                {command.shortcut && (
                  <kbd className="ml-auto rounded-sm border px-1 font-sans text-muted-foreground">
                    {command.shortcut}
                  </kbd>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-muted-foreground">No matching commands</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
