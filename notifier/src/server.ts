import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, type NotifierConfig } from "./config.ts";
import { type DeliveryOptions, DeliveryService } from "./deliveries.ts";
import { errorMessage, log } from "./log.ts";
import { createSender, normalizeHandle, type TextSender } from "./photon.ts";
import { type AlertPayload, DeliveryStore } from "./store.ts";
import { GatewayVoiceSender } from "./voice.ts";

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

function str(body: Record<string, unknown>, key: string, max: number, required = true): string {
  const value = body[key];
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max) {
    throw new HttpError(422, `${key} must be a ${required ? "non-empty " : ""}string of at most ${max} characters`);
  }
  return value;
}

export function parseAlert(input: unknown): AlertPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(422, "Body must be an object");
  const body = input as Record<string, unknown>;
  const phone = normalizeHandle(str(body, "phone", 320));
  if (!phone) throw new HttpError(422, "phone must be an E.164 number (e.g. +15555550123) or an Apple ID email");
  const channel = body.channel ?? "text";
  if (channel !== "text" && channel !== "call") throw new HttpError(422, "channel must be 'text' or 'call'");
  if (channel === "call" && !/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(422, "Calls require an E.164 phone number");
  const severity = body.severity;
  if (body.test_call !== undefined && typeof body.test_call !== "boolean") {
    throw new HttpError(422, "test_call must be a boolean");
  }
  if (severity !== undefined && severity !== null && (typeof severity !== "number" || !Number.isFinite(severity))) {
    throw new HttpError(422, "severity must be a number");
  }
  return {
    alert_id: str(body, "alert_id", 200),
    level: str(body, "level", 40),
    phone,
    title: str(body, "title", 300),
    summary: str(body, "summary", 4000, false),
    url: str(body, "url", 2000, false),
    channel,
    ...(typeof severity === "number" ? { severity } : {}),
    ...(body.test_call === true ? { test_call: true } : {}),
  };
}

export function createNotifier(config: NotifierConfig, sender: TextSender = createSender(config),
  overrides: Partial<DeliveryOptions> = {}) {
  const store = new DeliveryStore(config.storePath);
  const deliveries = new DeliveryService(store, sender, {
    backendUrl: config.backendUrl,
    notifierToken: config.notifierToken,
    voice: !config.dryRun && config.voiceGatewayUrl
      ? new GatewayVoiceSender(config.voiceGatewayUrl, config.notifierToken) : undefined,
    voiceRetryDelayMs: config.voiceRetryDelayMs,
    textRecipient: config.textRecipient,
    ...overrides,
  });

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://notifier").pathname.replace(/\/+$/, "") || "/";
      if (req.method === "GET" && path === "/healthz") {
        return send(res, 200, { ok: true, mode: config.mode });
      }
      if (path !== "/notify") throw new HttpError(404, "Not found");
      if (req.method !== "POST") throw new HttpError(405, "Use POST");
      if (!authorized(req, config.notifierToken)) throw new HttpError(401, "Invalid notifier token");

      const alert = parseAlert(await readJson(req));
      const key = req.headers["idempotency-key"];
      if (key !== undefined && key !== alert.alert_id) {
        throw new HttpError(422, "Idempotency-Key must equal alert_id");
      }
      const { record, duplicate } = deliveries.accept(alert);
      log.info(duplicate ? "duplicate alert" : "alert accepted", { alert_id: alert.alert_id,
        alert_level: alert.level, channel: alert.channel, status: record.status });
      send(res, duplicate ? 200 : 202, { alert_id: alert.alert_id, status: record.status, duplicate });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) log.error("request failed", { error: errorMessage(error) });
      send(res, status, { error: status === 500 ? "Internal error" : errorMessage(error) });
    }
  });

  return { server, deliveries, store, sender };
}

async function main() {
  const config = loadConfig();
  const { server, deliveries, sender } = createNotifier(config);
  deliveries.resume();
  await new Promise<void>((ready) => server.listen(config.port, config.host, ready));
  log.info("notifier listening", { url: `http://${config.host}:${config.port}`,
    mode: config.mode, backend: config.backendUrl });

  const shutdown = (signal: string) => {
    log.info("shutting down", { signal });
    (server as Server).close();
    deliveries.stop();
    void deliveries.idle().then(() => sender.close()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    log.error("notifier failed to start", { error: errorMessage(error) });
    process.exit(1);
  });
}
