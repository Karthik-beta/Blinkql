// Every template in ./library, one file each, so adding a template never touches a shared file.
import type { Template } from "./template";

const modules = import.meta.glob<Record<string, unknown>>(
  ["./library/*.ts", "!./library/*.test.ts"],
  { eager: true },
);

function isTemplate(value: unknown): value is Template {
  return typeof value === "object" && value !== null && "id" in value && "sql" in value;
}

/** The templates, by title. A library file may export its template by default or by name. */
export const templates: readonly Template[] = Object.values(modules)
  .flatMap((module) => Object.values(module).filter(isTemplate))
  .sort((a, b) => a.title.localeCompare(b.title));
