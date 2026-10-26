import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "./UpdatePrompt";

// The real hook registers a service worker; here the tests decide whether an update is waiting.
const sw = vi.hoisted(() => ({
  waiting: false,
  updateServiceWorker: vi.fn(async () => {}),
}));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: useState(sw.waiting),
    offlineReady: useState(false),
    updateServiceWorker: sw.updateServiceWorker,
  }),
}));

describe("UpdatePrompt", () => {
  beforeEach(() => {
    sw.waiting = false;
    sw.updateServiceWorker.mockClear();
  });

  it("shows nothing when no new version is waiting", () => {
    render(<UpdatePrompt />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers a reload when a new version is ready, by keyboard", async () => {
    sw.waiting = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    expect(screen.getByRole("status")).toHaveTextContent("A new version of Blinkql is ready.");
    await user.tab();
    expect(screen.getByRole("button", { name: "Reload" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(sw.updateServiceWorker).toHaveBeenCalledOnce();
  });

  it("goes away when put off", async () => {
    sw.waiting = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });
});
