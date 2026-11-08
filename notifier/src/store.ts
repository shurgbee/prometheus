import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Channel = "text" | "call";
export type SendStatus = "queued" | "sending" | "sent" | "failed";
export type BackendStatus = "sent" | "text_fallback" | "failed";

export interface AlertPayload {
  alert_id: string;
  level: string;
  phone: string;
  title: string;
  summary: string;
  url: string;
  channel: Channel;
  severity?: number;
}

export interface DeliveryRecord {
  alert: AlertPayload;
  status: SendStatus;
  attempts: number;
  messageId?: string;
  error?: string;
  /** Status to report back to the backend, once known. */
  backendStatus?: BackendStatus;
  callbackDone: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Durable idempotency store keyed by alert ID. The backend may retry /notify with the
 * same key after a timeout or crash, so every accepted alert is written to disk before
 * the notifier replies.
 */
export class DeliveryStore {
  private records = new Map<string, DeliveryRecord>();

  constructor(private readonly path: string) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as DeliveryRecord[];
      for (const record of saved) this.records.set(record.alert.alert_id, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(alertId: string) {
    return this.records.get(alertId);
  }

  all() {
    return [...this.records.values()];
  }

  insert(alert: AlertPayload): DeliveryRecord {
    const stamp = new Date().toISOString();
    const record: DeliveryRecord = { alert, status: "queued", attempts: 0, callbackDone: false,
      createdAt: stamp, updatedAt: stamp };
    this.records.set(alert.alert_id, record);
    this.flush();
    return record;
  }

  update(alertId: string, changes: Partial<DeliveryRecord>): DeliveryRecord {
    const record = this.records.get(alertId);
    if (!record) throw new Error(`Unknown alert ${alertId}`);
    Object.assign(record, changes, { updatedAt: new Date().toISOString() });
    this.flush();
    return record;
  }

  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.all(), null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
