import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { marks } from "@/lib/user-timing";
import { App } from "./App";

describe("App shell", () => {
  afterEach(() => {
    performance.clearMarks();
  });

  it("renders the top bar with the wordmark", () => {
    render(<App />);

    const banner = screen.getByRole("banner");
    expect(banner).toBeInTheDocument();
    // Light and dark wordmarks are both in the DOM; CSS shows the one for the active theme.
    expect(screen.getAllByRole("img", { name: "Blinkql" })).toHaveLength(2);
  });

  it("renders an empty, labelled workspace", () => {
    render(<App />);

    const workspace = screen.getByRole("main", { name: "Workspace" });
    expect(workspace).toBeEmptyDOMElement();
  });

  it("marks the app shell for the benchmark harness", () => {
    render(<App />);

    expect(performance.getEntriesByName(marks.appShell, "mark")).toHaveLength(1);
  });
});
