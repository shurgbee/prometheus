import type { AlertPayload } from "./store.ts";

export type VoiceOutcome = "completed" | "missed" | "failed" | "interrupted";
export interface VoiceSender {
  call(alert: AlertPayload, key: string): Promise<VoiceOutcome>;
}
export class VoiceRequestError extends Error {
  constructor(readonly status: number) {
    super(`Voice gateway rejected call: HTTP ${status}`);
  }
}

export function formatVoiceScript(alert: AlertPayload): string {
  const words = (text: string, count: number) =>
    text.trim().replace(/\s+/g, " ").split(" ").slice(0, count).join(" ");
  return (
    `Critical Finance Hub alert. ${words(alert.title, 8)}. ${words(alert.summary, 24)}. ` +
    "Details sent by text."
  );
}

/** The gateway persists each physical call by key, including calls whose HTTP response was lost. */
export class GatewayVoiceSender implements VoiceSender {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call(alert: AlertPayload, key: string): Promise<VoiceOutcome> {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
    const response = await this.fetchImpl(`${this.url}/calls`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        key,
        phone: alert.phone,
        script: formatVoiceScript(alert),
        ...(alert.test_call === true ? { test_call: true } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new VoiceRequestError(response.status);
    const deadline = Date.now() + 180_000;
    let state = (await response.json()) as { status: string };
    while (Date.now() < deadline) {
      if (
        ["completed", "missed", "failed", "interrupted"].includes(state.status)
      )
        return state.status as VoiceOutcome;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      try {
        const poll = await this.fetchImpl(
          `${this.url}/calls/${encodeURIComponent(key)}`,
          {
            headers,
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (poll.ok) state = (await poll.json()) as { status: string };
      } catch {
        /* Continue reconciling the same call; never generate another key on a poll failure. */
      }
    }
    throw new Error(
      "Voice gateway outcome unavailable; no additional call was attempted",
    );
  }
}
