import type { BackendFrame } from "./backend";

/**
 * Parse a text/event-stream response body into ChatEvents.
 * Handles CRLF or LF line endings, multi-line `data:` fields, comments (`:`),
 * and frames that carry the type inside the JSON instead of `event:`.
 */
export async function* parseEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<BackendFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A chunk can end between "\r" and "\n"; hold a trailing "\r" until the next chunk.
  let pendingCR = false;
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      let text: string = (pendingCR ? "\r" : "") + decoder.decode(value, { stream: true });
      pendingCR = text.endsWith("\r");
      if (pendingCR) text = text.slice(0, -1);
      // Normalise line endings so frame splitting is uniform.
      buffer += text.replace(/\r\n?/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }
    // Flush a final frame that wasn't followed by a blank line.
    buffer += (decoder.decode() + (pendingCR ? "\n" : "")).replace(/\r\n?/g, "\n");
    const tail = parseFrame(buffer.trim());
    if (tail) yield tail;
  } finally {
    // The consumer stopped early (e.g. after a `done` event): close the connection.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parseFrame(frame: string): BackendFrame | null {
  if (!frame.trim()) return null;
  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value.trim();
    else if (field === "data") dataLines.push(value);
  }

  const raw = dataLines.join("\n");
  let payload: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      } else if (typeof parsed === "string") {
        payload = { text: parsed };
      }
    } catch {
      // Plain-text data: treat as a token so nothing the agent says is lost.
      payload = { text: raw };
    }
  }

  const type = eventName && eventName !== "message" ? eventName : (payload.type as string | undefined);
  if (!type) {
    return typeof payload.text === "string" ? { type: "token", text: payload.text } : null;
  }
  return { ...payload, type } as BackendFrame;
}
