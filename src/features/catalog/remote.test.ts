import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NO_CORS_MESSAGE,
  NO_RANGE_WARNING,
  parseRemoteUrl,
  probeRemoteFile,
  remoteFileName,
  remoteReadMessage,
} from "./remote";

describe("parseRemoteUrl", () => {
  it.each([
    "https://example.com/data/orders.parquet",
    "  https://example.com/orders.csv?token=abc  ",
    "http://localhost:8080/orders.parquet",
    "http://127.0.0.1:8080/orders.parquet",
  ])("accepts %s", (text) => {
    expect(parseRemoteUrl(text).href).toBe(new URL(text.trim()).href);
  });

  it.each(["", "orders.parquet", "example.com/orders.parquet"])(
    "rejects %j as incomplete",
    (text) => {
      expect(() => parseRemoteUrl(text)).toThrow("Enter a full address, starting with https://");
    },
  );

  it.each([
    "http://example.com/orders.parquet",
    "ftp://example.com/orders.parquet",
    "file:///C:/orders.parquet",
  ])("rejects %s for not using https", (text) => {
    expect(() => parseRemoteUrl(text)).toThrow("Only https:// addresses can be read");
  });
});

describe("remoteFileName", () => {
  it.each([
    ["https://example.com/data/Orders%202024.parquet", "Orders 2024.parquet"],
    ["https://example.com/orders.csv?download=1#top", "orders.csv"],
    ["https://example.com/data/", ""],
    ["https://example.com", ""],
  ])("names %s %j", (url, name) => {
    expect(remoteFileName(new URL(url))).toBe(name);
  });
});

describe("probeRemoteFile", () => {
  const url = new URL("https://example.com/orders.parquet");
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  afterEach(() => fetch.mockReset());

  it("asks for the first byte only", async () => {
    fetch.mockResolvedValueOnce(new Response("P", { status: 206 }));

    await expect(probeRemoteFile(url)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(url, { headers: { Range: "bytes=0-0" } });
  });

  it("warns when the server sends the whole file instead of a range", async () => {
    const cancel = vi.fn();
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 200 }));

    await expect(probeRemoteFile(url)).resolves.toBe(NO_RANGE_WARNING);
    // The rest of the file isn't downloaded.
    expect(cancel).toHaveBeenCalled();
  });

  it("explains a server that doesn't allow cross-origin reads", async () => {
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(probeRemoteFile(url)).rejects.toThrow(NO_CORS_MESSAGE);
  });

  it("reports the status of a failed response", async () => {
    fetch.mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }));

    await expect(probeRemoteFile(url)).rejects.toThrow("The server answered 404 Not Found.");
  });
});

describe("remoteReadMessage", () => {
  it("explains a range request the engine couldn't make", () => {
    expect(
      remoteReadMessage(
        "IO Error: Range request for https://example.com/orders.parquet failed with error: Network error",
      ),
    ).toBe(NO_CORS_MESSAGE);
  });

  it("reports the status of a failed range request", () => {
    expect(
      remoteReadMessage(
        "Range request for https://example.com/orders.parquet did returned non-success status: 403",
      ),
    ).toBe("The server answered 403.");
  });

  it("leaves other messages alone", () => {
    expect(remoteReadMessage("not a Parquet file")).toBe("not a Parquet file");
  });
});
