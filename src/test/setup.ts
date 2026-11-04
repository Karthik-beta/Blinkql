import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmount rendered trees between tests (automatic only when Vitest globals are on).
afterEach(() => {
  cleanup();
});

// jsdom lays nothing out, so it has no ResizeObserver; sizes in tests come from mocked getters.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom has no media queries either; tests see a wide screen unless they stub matchMedia.
globalThis.matchMedia ??= (media: string) =>
  ({
    matches: false,
    media,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// The service worker's virtual module only loads in Vite builds, and tests never register one.
vi.mock("virtual:pwa-register/react", async () => {
  const { useState } = await import("react");
  return {
    useRegisterSW: () => ({
      needRefresh: useState(false),
      offlineReady: useState(false),
      updateServiceWorker: async () => {},
    }),
  };
});
