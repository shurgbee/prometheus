import type { NotifierConfig } from "./config.ts";
import { log } from "./log.ts";

export interface TextSender {
  /** `key` is a stable idempotency key (the alert ID), so a retried send is never duplicated. */
  sendText(phone: string, body: string, key?: string): Promise<{ messageId?: string }>;
  close(): Promise<void>;
}

/** A Photon API error with its problem code (e.g. SHARED_LINE_INBOUND_REQUIRED). */
export class PhotonError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const HINTS: Record<string, string> = {
  SHARED_LINE_INBOUND_REQUIRED:
    "Photon's shared iMessage lines only text people who have messaged the line first. Text your Photon line once from ALERT_PHONE, then retry.",
  SHARED_LINE_NOT_ASSIGNED:
    "ALERT_PHONE isn't assigned to this project's shared line yet. Text your Photon line once from ALERT_PHONE, then retry.",
  SENDER_NOT_SENDABLE:
    "Photon won't send from this line. Open the line in the Photon dashboard: its iMessage health must not read unavailable, and on a shared line ALERT_PHONE must be assigned and must have texted the line since. Run `npm run photon-doctor` for details.",
  NOT_AUTHENTICATED: "PHOTON_API_KEY was rejected. Check the key in the Photon dashboard.",
  INSUFFICIENT_SCOPE: "PHOTON_API_KEY lacks a permission it needs (users, spaces and messages write).",
  RESOURCE_MISMATCH: "PHOTON_API_KEY belongs to a different project than PHOTON_PROJECT_ID.",
};

type Json = Record<string, unknown>;
type Route = { senderId: string; spaceId: string };

/**
 * Sends iMessage texts through Photon's REST API (api.photon.codes) with a project API key
 * (pho_sk_…): resolve the recipient as a Photon user, find the direct Space between the
 * project's iMessage line and that user, then send the text into it.
 */
export class PhotonApiSender implements TextSender {
  private readonly routes = new Map<string, Route>();

  constructor(private readonly config: NotifierConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private async call(method: string, path: string, body?: Json, idempotencyKey?: string): Promise<Json> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.photonApiKey}`, Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 255);
    const response = await this.fetchImpl(`${this.config.photonApiUrl}/v1/projects/${encodeURIComponent(this.config.photonProjectId)}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let data: Json = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text };
    }
    if (!response.ok) {
      const code = String(data.code ?? `HTTP_${response.status}`);
      const issues = Array.isArray(data.issues)
        ? ` (${data.issues.map((i: Json) => `${i.path}: ${i.message}`).join("; ")})` : "";
      const detail = String(data.detail ?? data.title ?? response.statusText) + issues;
      throw new PhotonError(response.status, code, HINTS[code] ? `${code}: ${HINTS[code]}` : `${code}: ${detail}`);
    }
    return data;
  }

  private readonly users = new Map<string, { handle: string; kind: string }>();

  private async user(userId: string): Promise<{ handle: string; kind: string }> {
    const cached = this.users.get(userId);
    if (cached) return cached;
    const user = await this.call("GET", `/users/${encodeURIComponent(userId)}`);
    const info = { handle: normalizeHandle(String(user.handle ?? "")), kind: String(user.kind ?? "").toLowerCase() };
    this.users.set(userId, info);
    return info;
  }

  /**
   * Finds the line (sender) and conversation (space) for a recipient. Prefers the existing
   * direct conversation the recipient started by texting the line, which is also what Photon
   * requires on shared lines. Falls back to an explicit PHOTON_SENDER_ID or an Agent user.
   */
  private async resolveRoute(phone: string): Promise<Route> {
    const cached = this.routes.get(phone);
    if (cached) return cached;
    const recipient = await this.call("POST", "/users", { handle: phone, platform: "imessage" });
    const recipientId = String(recipient.id);
    if (String(recipient.kind).toLowerCase() === "agent") {
      throw new PhotonError(422, "RECIPIENT_IS_LINE",
        `RECIPIENT_IS_LINE: ${maskPhone(phone)} is your Photon line's own number, so it can't receive alerts. ` +
        "Set ALERT_PHONE to the phone number or Apple ID email you text the line from.");
    }
    const line = normalizeHandle(this.config.photonLine);
    let senderId = this.config.photonSenderId;

    if (!senderId) {
      const query = new URLSearchParams({ platform: "imessage", participantId: recipientId,
        orderBy: "last_message_created_at", order: "desc", pageSize: "50" });
      const page = await this.call("GET", `/spaces?${query}`);
      for (const space of (page.items as Json[] | undefined) ?? []) {
        const others = ((space.participantIds as string[] | undefined) ?? []).filter((id) => id !== recipientId);
        if (others.length !== 1) continue; // direct conversations only
        const other = await this.user(others[0]);
        if (other.kind !== "agent") continue; // the sender must be the line
        if (line && other.handle !== line) continue;
        const route = { senderId: others[0], spaceId: String(space.id) };
        log.info("using existing Photon conversation", { sender_id: route.senderId, space_id: route.spaceId });
        this.routes.set(phone, route);
        return route;
      }
      senderId = await this.findAgent(recipientId, phone, line);
    }

    const space = await this.call("POST", "/spaces",
      { participantIds: [senderId, recipientId], platform: "imessage" },
      `finhub-space-${senderId}-${recipientId}`);
    const route = { senderId, spaceId: String(space.id) };
    this.routes.set(phone, route);
    return route;
  }

  /** The project's iMessage line as an Agent user, when no conversation exists yet. */
  private async findAgent(recipientId: string, phone: string, line: string): Promise<string> {
    const agents: Json[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ platform: "imessage", pageSize: "100", ...(pageToken ? { pageToken } : {}) });
      const page = await this.call("GET", `/users?${query}`);
      for (const user of (page.items as Json[] | undefined) ?? []) {
        const handle = normalizeHandle(String(user.handle ?? ""));
        if (user.id === recipientId || handle === phone) continue;
        if (String(user.kind).toLowerCase() === "agent" && (!line || handle === line)) agents.push(user);
      }
      pageToken = page.nextPageToken as string | undefined;
    } while (pageToken);
    if (agents.length === 0) {
      throw new PhotonError(404, "NO_CONVERSATION",
        `NO_CONVERSATION: No conversation with ${maskPhone(phone)} on your Photon line yet. ` +
        "Text the Photon line once from that phone number or Apple ID, then retry.");
    }
    if (agents.length > 1) {
      log.warn("several iMessage lines found; using the first. Set PHOTON_LINE to choose one.", { line: agents[0].handle });
    }
    return String(agents[0].id);
  }

  async sendText(phone: string, body: string, key?: string) {
    const { senderId, spaceId } = await this.resolveRoute(phone);
    let message: Json;
    try {
      message = await this.call("POST", "/messages",
        { senderId, spaceId, content: { type: "text", text: body, format: "plain" } },
        key ? `finhub-alert-${key}` : `finhub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    } catch (error) {
      this.routes.delete(phone); // re-resolve next time in case the conversation changed
      throw error;
    }
    if (message.status === "failed") throw new PhotonError(502, "SEND_FAILED", "Photon accepted the message but reported it failed");
    return { messageId: message.id ? String(message.id) : undefined };
  }

  async close() {}
}

/** Sends through the Spectrum SDK with Spectrum Cloud credentials (SPECTRUM_PROJECT_ID/SECRET). */
export class SpectrumSender implements TextSender {
  private app: Promise<any> | undefined;

  constructor(private readonly config: NotifierConfig) {}

  private connect() {
    if (!this.app) {
      this.app = (async () => {
        const [{ Spectrum }, { imessage }] = await Promise.all([import("@spectrum-ts/core"), import("@spectrum-ts/imessage")]);
        const app = await Spectrum({ projectId: this.config.spectrumProjectId, projectSecret: this.config.spectrumProjectSecret,
          providers: [imessage.config()], options: { logLevel: this.config.logLevel } });
        return { app, imessage };
      })().catch((error) => {
        this.app = undefined;
        throw error;
      });
    }
    return this.app;
  }

  async sendText(phone: string, body: string) {
    const { app, imessage } = await this.connect();
    const space = await imessage(app).space.create(phone);
    const message = await space.send(body);
    return { messageId: message?.id };
  }

  async close() {
    const current = await this.app?.catch(() => undefined);
    this.app = undefined;
    await current?.app.stop();
  }
}

/** Logs instead of sending, for local end-to-end checks without a Photon line. */
export class DryRunSender implements TextSender {
  async sendText(phone: string, body: string) {
    log.info("dry-run text", { to: maskPhone(phone), body });
    return { messageId: `dry-run-${Date.now()}` };
  }
  async close() {}
}

export function createSender(config: NotifierConfig): TextSender {
  if (config.mode === "dry_run") return new DryRunSender();
  if (config.mode === "spectrum") return new SpectrumSender(config);
  return new PhotonApiSender(config);
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalizes an iMessage handle: an E.164 phone number or an Apple ID email. Returns "" if invalid. */
export function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@")) return EMAIL.test(trimmed) ? trimmed.toLowerCase() : "";
  const phone = trimmed.replace(/[\s().-]/g, "");
  return E164.test(phone) ? phone : "";
}

export function maskPhone(handle: string): string {
  if (handle.includes("@")) {
    const [local, domain] = handle.split("@");
    return `${local.slice(0, 2)}•••@${domain}`;
  }
  return handle.length > 4 ? `${"•".repeat(handle.length - 4)}${handle.slice(-4)}` : "••••";
}
