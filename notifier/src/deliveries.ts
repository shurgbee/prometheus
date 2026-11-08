import { errorMessage, log } from "./log.ts";
import { formatAlertText } from "./message.ts";
import { maskPhone, PhotonError, type TextSender } from "./photon.ts";
import type { AlertPayload, DeliveryRecord, DeliveryStore } from "./store.ts";

export interface DeliveryOptions {
  backendUrl: string;
  notifierToken: string;
  /** Delays between Photon send attempts; its length + 1 is the attempt count. */
  sendRetryDelaysMs?: number[];
  callbackRetryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Accepts alerts from the trigger worker, texts them through Photon one at a time and
 * reports the outcome to PATCH /api/internal/alerts/{id}/delivery.
 */
export class DeliveryService {
  private queue: Promise<void> = Promise.resolve();
  private readonly sendDelays: number[];
  private readonly callbackDelays: number[];
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly store: DeliveryStore,
    private readonly sender: TextSender,
    private readonly options: DeliveryOptions,
  ) {
    this.sendDelays = options.sendRetryDelaysMs ?? [2_000, 5_000];
    this.callbackDelays = options.callbackRetryDelaysMs ?? [1_000, 3_000, 10_000, 30_000];
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Returns the stored record and whether this alert ID was already accepted. */
  accept(alert: AlertPayload): { record: DeliveryRecord; duplicate: boolean } {
    const existing = this.store.get(alert.alert_id);
    if (existing) return { record: existing, duplicate: true };
    const record = this.store.insert(alert);
    this.enqueue(alert.alert_id);
    return { record, duplicate: false };
  }

  /** Re-queues work left unfinished by a previous process. */
  resume() {
    for (const record of this.store.all()) {
      if (record.status === "queued" || record.status === "sending") this.enqueue(record.alert.alert_id);
      else if (!record.callbackDone && record.backendStatus) this.enqueueCallback(record.alert.alert_id);
    }
  }

  /** Resolves once everything queued so far has finished. */
  idle() {
    return this.queue;
  }

  private enqueue(alertId: string) {
    this.queue = this.queue.then(() => this.deliver(alertId)).catch((error) =>
      log.error("delivery crashed", { alert_id: alertId, error: errorMessage(error) }));
  }

  private enqueueCallback(alertId: string) {
    this.queue = this.queue.then(() => this.reportToBackend(alertId)).catch((error) =>
      log.error("callback crashed", { alert_id: alertId, error: errorMessage(error) }));
  }

  private async deliver(alertId: string) {
    const record = this.store.get(alertId);
    if (!record || record.status === "sent" || record.status === "failed") return;
    const { alert } = record;
    const body = formatAlertText(alert);
    this.store.update(alertId, { status: "sending" });

    for (let attempt = 0; attempt <= this.sendDelays.length; attempt++) {
      try {
        this.store.update(alertId, { attempts: record.attempts + 1 });
        const { messageId } = await this.sender.sendText(alert.phone, body, alertId);
        // Voice isn't wired up yet, so a requested call is delivered as a text instead.
        const backendStatus = alert.channel === "call" ? "text_fallback" : "sent";
        this.store.update(alertId, { status: "sent", messageId, error: undefined, backendStatus });
        log.info("text sent", { alert_id: alertId, to: maskPhone(alert.phone), channel: alert.channel,
          message_id: messageId });
        break;
      } catch (error) {
        const message = errorMessage(error);
        log.warn("photon send failed", { alert_id: alertId, attempt: attempt + 1, error: message });
        const permanent = error instanceof PhotonError && error.status >= 400 && error.status < 500
          && ![408, 409, 429].includes(error.status);
        if (permanent || attempt >= this.sendDelays.length) {
          this.store.update(alertId, { status: "failed", error: message, backendStatus: "failed" });
          break;
        } else {
          this.store.update(alertId, { error: message });
          await sleep(this.sendDelays[attempt]);
        }
      }
    }
    await this.reportToBackend(alertId);
  }

  private async reportToBackend(alertId: string) {
    const record = this.store.get(alertId);
    if (!record?.backendStatus || record.callbackDone) return;
    const url = `${this.options.backendUrl}/api/internal/alerts/${encodeURIComponent(alertId)}/delivery`;
    for (let attempt = 0; attempt <= this.callbackDelays.length; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${this.options.notifierToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: record.backendStatus }),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok || response.status === 404) {
          this.store.update(alertId, { callbackDone: true });
          if (response.status === 404) log.warn("backend does not know alert", { alert_id: alertId });
          return;
        }
        if (response.status < 500 && response.status !== 429) {
          log.error("backend rejected delivery callback", { alert_id: alertId, status: response.status });
          this.store.update(alertId, { callbackDone: true });
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (error) {
        log.warn("delivery callback failed", { alert_id: alertId, attempt: attempt + 1, error: errorMessage(error) });
        if (attempt < this.callbackDelays.length) await sleep(this.callbackDelays[attempt]);
      }
    }
  }
}
