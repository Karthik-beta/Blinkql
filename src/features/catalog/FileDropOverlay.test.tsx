import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { importFiles } from "./catalog";
import { FileDropOverlay } from "./FileDropOverlay";

vi.mock("./catalog", () => ({ importFiles: vi.fn() }));

const hint = () => screen.queryByText("Drop files to import them as tables");

/** Fires a drag event on the window. jsdom has no DragEvent, so the data is attached by hand. */
function drag(type: string, types: string[], files: File[] = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files } });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("FileDropOverlay", () => {
  it("shows while files are dragged over the window", () => {
    render(<FileDropOverlay />);
    expect(hint()).not.toBeInTheDocument();

    drag("dragenter", ["Files"]);
    expect(hint()).toBeInTheDocument();
  });

  it("stays while a nested element is still under the drag", () => {
    render(<FileDropOverlay />);

    drag("dragenter", ["Files"]);
    drag("dragenter", ["Files"]);
    drag("dragleave", ["Files"]);
    expect(hint()).toBeInTheDocument();
  });

  it("hides once the drag has left the window", () => {
    render(<FileDropOverlay />);

    drag("dragenter", ["Files"]);
    drag("dragenter", ["Files"]);
    drag("dragleave", ["Files"]);
    drag("dragleave", ["Files"]);
    expect(hint()).not.toBeInTheDocument();
  });

  it("ignores drags that carry no files", () => {
    render(<FileDropOverlay />);

    drag("dragenter", ["text/plain"]);
    expect(hint()).not.toBeInTheDocument();
  });

  it("hides on drop and imports the dropped files", () => {
    render(<FileDropOverlay />);
    const file = new File(["id\n1\n"], "orders.csv");

    drag("dragenter", ["Files"]);
    drag("drop", ["Files"], [file]);
    expect(hint()).not.toBeInTheDocument();
    expect(importFiles).toHaveBeenCalledWith([file]);
  });
});
