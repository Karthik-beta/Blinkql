import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount rendered trees between tests (automatic only when Vitest globals are on).
afterEach(() => {
  cleanup();
});
