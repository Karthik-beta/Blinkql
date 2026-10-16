import { within } from "@testing-library/react";

/**
 * Queries inside the SQL editor. Testing Library doesn't look into shadow roots, and the editor
 * lives in one (see SqlEditor.tsx).
 */
export function withinSqlEditor() {
  const root = document.querySelector("[data-sql-editor]")?.shadowRoot;
  if (!root) throw new Error("No SQL editor on the page");
  // Queries only call querySelectorAll on the container, which a shadow root has.
  return within(root as unknown as HTMLElement);
}
