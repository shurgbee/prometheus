import { errorMessage, log } from "./log.ts";
import { formatAlertText } from "./message.ts";
import { maskPhone, PhotonError, type TextSender } from "./photon.ts";
import type { AlertPayload, BackendStatus, DeliveryRecord, DeliveryStore } from "./store.ts";
import { VoiceRequestError, type VoiceSender } from "./voice.ts";

export interface DeliveryOptions {
  backendUrl: string;
  notifierToken: string;
  sendRetryDelaysMs?: number[];
  callbackRetryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  voice?: VoiceSender;
  voiceRetryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const finished = (record: DeliveryRecord) => ["sent", "failed", "cancelled"].includes(record.status);

/** Durable per-alert delivery. Calls, delayed retries and callbacks never block unrelated texts. */
export class DeliveryService {
  private readonly active = new Map<string, Promise<void>>();
  private readonly callbacks = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly callbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sendDelays: number[];
  private readonly callbackDelays: number[];
  private readonly fetchImpl: typeof fetch;
  private stopping = false;

  constructor(private readonly store: DeliveryStore, private readonly sender: TextSender,
    private readonly options: DeliveryOptions) {
    this.sendDelays = options.sendRetryDelaysMs ?? [2_000, 5_000];
    this.callbackDelays = options.callbackRetryDelaysMs ?? [1_000, 3_000, 10_000, 30_000];
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  accept(alert: AlertPayload): { record: DeliveryRecord; duplicate: boolean } {
    const existing = this.store.get(alert.alert_id);
    if (existing) return { record: existing, duplicate: true };
    const record = this.store.insert(alert);
    this.enqueue(alert.alert_id);
    return { record, duplicate: false };
  }

  resume() {
    for (const record of this.store.all()) {
      if (!finished(record)) this.enqueue(record.alert.alert_id);
      if (!record.callbackDone && record.backendStatus) this.enqueueCallback(record.alert.alert_id);
    }
  }

  /** Waits for current work, not future persisted retry deadlines. */
  async idle() {
    while (this.active.size || this.callbacks.size) {
      await Promise.all([...this.active.values(), ...this.callbacks.values()]);
    }
  }

  stop() {
    this.stopping = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.callbackTimers.values()) clearTimeout(timer);
    this.callbackTimers.clear();
  }

  private enqueue(alertId: string) {
    if (this.stopping || this.active.has(alertId)) return;
    const record = this.store.get(alertId);
    if (!record || finished(record)) return;
    if (record.nextCallAt && new Date(record.nextCallAt).getTime() > Date.now()) {
      this.schedule(alertId, new Date(record.nextCallAt).getTime());
      return;
    }
    const task = Promise.resolve().then(() => this.deliver(alertId)).catch((error) => {
      this.store.update(alertId, { error: errorMessage(error) });
      log.error("delivery crashed", { alert_id: alertId, error: errorMessage(error) });
    }).finally(() => this.active.delete(alertId));
    this.active.set(alertId, task);
  }

  private schedule(alertId: string, timestamp: number) {
    if (this.stopping) return;
    const previous = this.timers.get(alertId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.timers.delete(alertId);
      this.enqueue(alertId);
    }, Math.min(Math.max(1, timestamp - Date.now()), 2_147_483_647));
    timer.unref();
    this.timers.set(alertId, timer);
  }

  private report(alertId: string, backendStatus: BackendStatus) {
    const record = this.store.get(alertId)!;
    this.store.update(alertId, { backendStatus, callbackDone: false,
      callbackRevision: (record.callbackRevision ?? 0) + 1 });
    this.enqueueCallback(alertId);
  }

  private enqueueCallback(alertId: string) {
    if (this.stopping || this.callbacks.has(alertId)) return;
    const previous = this.callbackTimers.get(alertId);
    if (previous) clearTimeout(previous);
    this.callbackTimers.delete(alertId);
    let lastRevision = -1;
    const task = Promise.resolve().then(async () => {
      while (true) {
        const record = this.store.get(alertId)!;
        if (record.callbackDone || !record.backendStatus) return;
        const revision = record.callbackRevision ?? 0;
        lastRevision = revision;
        const result = await this.reportToBackend(alertId, record.backendStatus);
        if (!result) return;
        if ((record.callbackRevision ?? 0) === revision) this.store.update(alertId, { callbackDone: true });
      }
    }).catch((error) => log.error("callback crashed", { alert_id: alertId, error: errorMessage(error) }))
      .finally(() => {
        this.callbacks.delete(alertId);
        const record = this.store.get(alertId)!;
        if (record.callbackDone || !record.backendStatus || this.stopping) return;
        if ((record.callbackRevision ?? 0) !== lastRevision) this.enqueueCallback(alertId);
        else {
          const timer = setTimeout(() => this.enqueueCallback(alertId), 30_000);
          timer.unref();
          this.callbackTimers.set(alertId, timer);
        }
      });
    this.callbacks.set(alertId, task);
  }

  private async text(record: DeliveryRecord, body: string, key: string): Promise<boolean> {
    for (let attempt = 0; attempt <= this.sendDelays.length; attempt++) {
      try {
        this.store.update(record.alert.alert_id, { attempts: record.attempts + 1 });
        const { messageId } = await this.sender.sendText(record.alert.phone, body, key);
        this.store.update(record.alert.alert_id, { messageId, error: undefined });
        log.info("text sent", { alert_id: record.alert.alert_id, to: maskPhone(record.alert.phone), message_id: messageId });
        return true;
      } catch (error) {
        this.store.update(record.alert.alert_id, { error: errorMessage(error) });
        const permanent = error instanceof PhotonError && error.status >= 400 && error.status < 500
          && ![408, 409, 429].includes(error.status);
        if (permanent || attempt >= this.sendDelays.length) return false;
        await sleep(this.sendDelays[attempt]);
      }
    }
    return false;
  }

  private async deliver(alertId: string) {
    const record = this.store.get(alertId)!;
    const { alert } = record;
    if (alert.channel !== "call" || !this.options.voice) {
      this.store.update(alertId, { status: "sending" });
      const sent = await this.text(record, formatAlertText(alert), alertId);
      this.store.update(alertId, { status: sent ? "sent" : "failed" });
      this.report(alertId, sent ? (alert.channel === "call" ? "text_fallback" : "sent") : "failed");
      return;
    }

    // A crash after saving the call outcome must resume texting, never dial again.
    const savedOutcome = record.voiceOutcome && !record.callJobKey && record.status !== "waiting_retry"
      ? record.voiceOutcome : undefined;
    if (!savedOutcome && (record.voiceAttempts ?? 0) > 0 && !record.callJobKey) {
      try {
        const response = await this.fetchImpl(`${this.options.backendUrl}/api/internal/alerts/${encodeURIComponent(alertId)}/state`, {
          headers: { Authorization: `Bearer ${this.options.notifierToken}` }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const state = await response.json() as { acked_at?: string; snoozed_until?: string; trigger_status?: string };
        if (state.acked_at || (state.trigger_status && state.trigger_status !== "active")) {
          this.store.update(alertId, { status: "cancelled", nextCallAt: undefined });
          return;
        }
        if (state.snoozed_until && new Date(state.snoozed_until).getTime() > Date.now()) {
          this.defer(record, new Date(state.snoozed_until).getTime());
          return;
        }
      } catch {
        // Fail closed if acknowledgement state cannot be read before a physical retry.
        this.defer(record, Date.now() + 30_000);
        return;
      }
    }

    const attempt = record.callJobKey || savedOutcome ? (record.voiceAttempts ?? 1) : (record.voiceAttempts ?? 0) + 1;
    const key = record.callJobKey ?? `${alertId}:call:${attempt}`;
    let outcome: string = savedOutcome ?? "";
    if (!savedOutcome) {
      this.store.update(alertId, { status: "calling", voiceAttempts: attempt, callJobKey: key,
        voiceOutcome: undefined, nextCallAt: undefined });
      this.report(alertId, "calling");
      try {
        outcome = await this.options.voice.call(alert, key);
      } catch (error) {
        this.store.update(alertId, { error: errorMessage(error) });
        if (error instanceof VoiceRequestError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          outcome = "failed";
        } else {
          // Keep the same key when the gateway may already be dialing; send the details meanwhile.
          if (!record.detailTextSent) {
            const sent = await this.text(record, formatAlertText(alert), `${alertId}:details`);
            this.store.update(alertId, { detailTextSent: sent });
          }
          this.defer(record, Date.now() + 15_000);
          return;
        }
      }
    }
    this.store.update(alertId, { voiceOutcome: outcome, callJobKey: undefined });
    if (!record.detailTextSent) {
      const sent = await this.text(record, formatAlertText(alert), `${alertId}:details`);
      this.store.update(alertId, { detailTextSent: sent });
    }
    if (outcome === "missed" && attempt < 2) {
      this.report(alertId, "missed");
      this.defer(record, Date.now() + (this.options.voiceRetryDelayMs ?? 120_000));
      return;
    }
    if (outcome === "completed") {
      this.store.update(alertId, { status: record.detailTextSent ? "sent" : "failed" });
      this.report(alertId, record.detailTextSent ? "sent" : "failed");
    } else {
      if (outcome === "missed" && !record.fallbackTextSent) {
        const sent = await this.text(record, `Missed critical call.\n${formatAlertText(alert)}`, `${alertId}:missed`);
        this.store.update(alertId, { fallbackTextSent: sent });
      }
      const textReachedProvider = record.detailTextSent || record.fallbackTextSent;
      this.store.update(alertId, { status: textReachedProvider ? "sent" : "failed" });
      this.report(alertId, textReachedProvider ? "text_fallback" : "failed");
    }
  }

  private defer(record: DeliveryRecord, timestamp: number) {
    this.store.update(record.alert.alert_id, { status: "waiting_retry", nextCallAt: new Date(timestamp).toISOString() });
    this.schedule(record.alert.alert_id, timestamp);
  }

  private async reportToBackend(alertId: string, status: BackendStatus): Promise<boolean> {
    const url = `${this.options.backendUrl}/api/internal/alerts/${encodeURIComponent(alertId)}/delivery`;
    for (let attempt = 0; attempt <= this.callbackDelays.length; attempt++) {
      try {
        const response = await this.fetchImpl(url, { method: "PATCH",
          headers: { Authorization: `Bearer ${this.options.notifierToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status }), signal: AbortSignal.timeout(10_000) });
        if (response.ok || response.status === 404) return true;
        if (response.status < 500 && response.status !== 429) {
          log.error("backend rejected delivery callback", { alert_id: alertId, status: response.status });
          return true;
        }
      } catch (error) {
        log.warn("delivery callback failed", { alert_id: alertId, error: errorMessage(error) });
      }
      if (attempt < this.callbackDelays.length) await sleep(this.callbackDelays[attempt]);
    }
    return false;
  }
}
