import { useEffect, useState } from "react";
import { importFiles } from "./catalog";

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Makes the whole window a drop target for files and shows a hint while files are dragged over it.
 * Dropped files are imported as tables.
 */
export function FileDropOverlay() {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    // dragenter and dragleave fire for every child element, so count them to know when the
    // drag has really left the window.
    let depth = 0;

    function onDragEnter(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    }
    function onDragOver(event: DragEvent) {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file instead of letting the page handle the drop.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(event: DragEvent) {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    function onDrop(event: DragEvent) {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      void importFiles(Array.from(event.dataTransfer?.files ?? []));
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-primary border-dashed bg-background/80">
      <p className="font-medium text-sm">Drop files to import them as tables</p>
    </div>
  );
}
