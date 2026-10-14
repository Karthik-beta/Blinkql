import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
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
});
