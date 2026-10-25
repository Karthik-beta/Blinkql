// Files on the web: which addresses Blinkql reads, and what to tell users when a server won't
// serve a file the way the engine needs (cross-origin, in ranges).

export const NO_CORS_MESSAGE =
  "The server doesn't let other websites read this file (it doesn't allow CORS). Download the file and import it instead.";

export const NO_RANGE_WARNING =
  "The server doesn't support range requests, so the whole file is downloaded every time it's read.";

const localHosts = new Set(["localhost", "127.0.0.1"]);

/** The address in `text`, if it's one Blinkql reads: https, or http on this computer. */
export function parseRemoteUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error("Enter a full address, starting with https://");
  }
  const local = url.protocol === "http:" && localHosts.has(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("Only https:// addresses can be read.");
  return url;
}

/** The file name at the end of `url`'s path, such as "orders.parquet", or "" if there's none. */
export function remoteFileName(url: URL): string {
  const last = url.pathname.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Asks for the file's first byte, as the engine would, so an unreadable file fails with a plain
 * explanation. Resolves with a warning if the server can only send the whole file.
 */
export async function probeRemoteFile(url: URL): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  } catch {
    // Browsers hide why a cross-origin request failed; a missing CORS header is the usual reason.
    throw new Error(NO_CORS_MESSAGE);
  }
  // Don't download the rest of a file sent whole.
  void response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`The server answered ${statusOf(response)}.`);
  return response.status === 206 ? undefined : NO_RANGE_WARNING;
}

function statusOf(response: Response): string {
  return `${response.status} ${response.statusText}`.trim();
}

/** `message` from the engine, with its errors about failed range requests in plain words. */
export function remoteReadMessage(message: string): string {
  const status = /Range request for \S+ did returned non-success status: (\d+)/.exec(message);
  if (status) return `The server answered ${status[1]}.`;
  if (/Range request for \S+ fail/.test(message)) return NO_CORS_MESSAGE;
  return message;
}
