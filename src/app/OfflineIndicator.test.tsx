import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineIndicator } from "./OfflineIndicator";

function setOffline(offline: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(!offline);
  act(() => {
    window.dispatchEvent(new Event(offline ? "offline" : "online"));
  });
}

describe("OfflineIndicator", () => {
  it("shows nothing while online", () => {
    render(<OfflineIndicator />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says so in words when the browser goes offline, and clears when it's back", () => {
    render(<OfflineIndicator />);

    setOffline(true);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");

    setOffline(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows straight away when the page opens offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    render(<OfflineIndicator />);

    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });
});
