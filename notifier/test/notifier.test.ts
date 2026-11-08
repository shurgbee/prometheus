import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DeliveryService } from "../src/deliveries.ts";
import { formatAlertText } from "../src/message.ts";
import type { NotifierConfig } from "../src/config.ts";
import { normalizeHandle, PhotonApiSender, PhotonError, type TextSender } from "../src/photon.ts";
import { createNotifier, parseAlert } from "../src/server.ts";
import { type AlertPayload, DeliveryStore } from "../src/store.ts";

const TOKEN = "notifier-test-token-0123456789";

const alert = (overrides: Partial<AlertPayload> = {}): AlertPayload => ({
  alert_id: "a1", level: "Normal", phone: "+15555550123", title: "Tesla – leadership & legal",
  summary: "CEO change announced.", url: "http://localhost:3000/?alert=a1", channel: "text", ...overrides,
});

class FakeSender implements TextSender {
  sent: { phone: string; body: string }[] = [];
  failures = 0;
  async sendText(phone: string, body: string) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error("photon down");
    }
    this.sent.push({ phone, body });
    return { messageId: `m${this.sent.length}` };
  }
  async close() {}
}

function fakeBackend() {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const baseConfig: NotifierConfig = { port: 0, host: "127.0.0.1", notifierToken: TOKEN,
  backendUrl: "http://127.0.0.1:9", mode: "dry_run", photonApiUrl: "https://photon.test", photonProjectId: "pho_prj_test",
  photonApiKey: "pho_sk_test", photonLine: "", photonSenderId: "", spectrumProjectId: "", spectrumProjectSecret: "",
  dryRun: true, storePath: "", logLevel: "error" };

const tempStore = () => join(mkdtempSync(join(tmpdir(), "notifier-")), "deliveries.json");

test("formats the alert text with level, score, summary and link", () => {
  assert.equal(formatAlertText(alert({ severity: 57.6 })),
    "[NORMAL] Tesla – leadership & legal (58)\nCEO change announced.\nhttp://localhost:3000/?alert=a1");
});

test("texts once, reports 'sent', and ignores a repeated alert ID", async () => {
  const sender = new FakeSender();
  const backend = fakeBackend();
  const service = new DeliveryService(new DeliveryStore(tempStore()), sender,
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl });
  assert.equal(service.accept(alert()).duplicate, false);
  assert.equal(service.accept(alert()).duplicate, true);
  await service.idle();
  assert.equal(sender.sent.length, 1);
  assert.deepEqual(backend.calls, [{ url: "http://backend/api/internal/alerts/a1/delivery",
    body: { status: "sent" }, auth: `Bearer ${TOKEN}` }]);
});

test("a requested call falls back to a CRITICAL text", async () => {
  const sender = new FakeSender();
  const backend = fakeBackend();
  const service = new DeliveryService(new DeliveryStore(tempStore()), sender,
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl });
  service.accept(alert({ alert_id: "c1", level: "Critical", channel: "call" }));
  await service.idle();
  assert.match(sender.sent[0].body, /^\[CRITICAL\]/);
  assert.deepEqual(backend.calls[0].body, { status: "text_fallback" });
});

test("retries Photon failures, then reports 'failed'", async () => {
  const sender = new FakeSender();
  sender.failures = 5;
  const backend = fakeBackend();
  const service = new DeliveryService(new DeliveryStore(tempStore()), sender,
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl, sendRetryDelaysMs: [1, 1] });
  service.accept(alert());
  await service.idle();
  assert.equal(sender.failures, 2);
  assert.deepEqual(backend.calls[0].body, { status: "failed" });
});

test("idempotency survives a restart", async () => {
  const path = tempStore();
  const backend = fakeBackend();
  const first = new DeliveryService(new DeliveryStore(path), new FakeSender(),
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl });
  first.accept(alert());
  await first.idle();
  const sender = new FakeSender();
  const second = new DeliveryService(new DeliveryStore(path), sender,
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl });
  second.resume();
  assert.equal(second.accept(alert()).duplicate, true);
  await second.idle();
  assert.equal(sender.sent.length, 0);
});

test("POST /notify checks the token and payload", async () => {
  const sender = new FakeSender();
  const { server, deliveries } = createNotifier({ ...baseConfig, storePath: tempStore() }, sender,
    { callbackRetryDelaysMs: [] });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, token = TOKEN) => fetch(`${base}/notify`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": "a1" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(alert(), "wrong-token")).status, 401);
    assert.equal((await post({ ...alert(), phone: "555" })).status, 422);
    assert.equal((await post(alert())).status, 202);
    assert.equal((await post(alert())).status, 200);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally {
    server.close();
  }
  await deliveries.idle().catch(() => {});
  assert.equal(sender.sent.length, 1);
});

function fakePhoton(handler: (method: string, path: string, body: any, headers: Headers) => [number, unknown]) {
  const calls: { method: string; path: string; body: any; headers: Headers }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init.headers);
    calls.push({ method: init.method!, path, body, headers });
    const [status, data] = handler(init.method!, path, body, headers);
    return new Response(JSON.stringify(data), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("Photon API sender uses the conversation the recipient started and sends with the alert key", async () => {
  const photon = fakePhoton((method, path) => {
    if (method === "POST" && path === "/v1/projects/pho_prj_test/users") return [200, { id: "u_me" }];
    if (method === "GET" && path.startsWith("/v1/projects/pho_prj_test/spaces?")) {
      assert.match(path, /participantId=u_me/);
      return [200, { items: [{ id: "s_group", participantIds: ["u_me", "u_x", "u_y"] },
        { id: "s_1", participantIds: ["u_me", "u_line"] }] }];
    }
    if (method === "GET" && path === "/v1/projects/pho_prj_test/users/u_line") {
      return [200, { id: "u_line", kind: "agent", handle: "+15551111111" }];
    }
    if (method === "POST" && path === "/v1/projects/pho_prj_test/messages") return [202, { id: "msg_1", status: "dispatched" }];
    return [404, { code: "NOT_FOUND" }];
  });
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, photon.fetchImpl);
  assert.deepEqual(await sender.sendText("+15555550123", "hello", "a1"), { messageId: "msg_1" });
  await sender.sendText("+15555550123", "again", "a2");
  const [user, , , message] = photon.calls;
  assert.equal(user.headers.get("authorization"), "Bearer pho_sk_test");
  assert.deepEqual(user.body, { handle: "+15555550123", platform: "imessage" });
  assert.deepEqual(message.body, { senderId: "u_line", spaceId: "s_1", content: { type: "text", text: "hello", format: "plain" } });
  assert.equal(message.headers.get("idempotency-key"), "finhub-alert-a1");
  assert.equal(photon.calls.length, 5, "the route is cached after the first send");
});

test("Photon API sender never picks the recipient as the sender", async () => {
  const photon = fakePhoton((method, path, body) => {
    if (method === "POST" && path.endsWith("/users")) return [200, { id: "u_me" }];
    if (method === "GET" && path.includes("/spaces?")) return [200, { items: [] }];
    if (method === "GET" && path.includes("/users?")) {
      // The recipient looks line-like (shared-line peer details) but must be skipped.
      return [200, { items: [{ id: "u_me", kind: "user", handle: "+15555550123", details: { type: "shared", resourceId: "r1" } },
        { id: "u_line", kind: "agent", handle: "+15551111111", details: {} }] }];
    }
    if (method === "POST" && path.endsWith("/spaces")) {
      assert.deepEqual(body.participantIds, ["u_line", "u_me"]);
      return [201, { id: "s_new" }];
    }
    if (path.endsWith("/messages")) return [202, { id: "m", status: "dispatched" }];
    return [404, {}];
  });
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, photon.fetchImpl);
  await sender.sendText("+15555550123", "hi");
  assert.equal(photon.calls.at(-1)!.body.senderId, "u_line");
});

test("Photon API sender explains the shared-line first-message rule and is not retried", async () => {
  const photon = fakePhoton((method, path) => {
    if (path.endsWith("/users")) return [200, { id: "u_me" }];
    if (path.includes("/spaces?")) return [200, { items: [{ id: "s_1", participantIds: ["u_me", "u_line"] }] }];
    if (path.endsWith("/users/u_line")) return [200, { id: "u_line", kind: "agent", handle: "+15551111111" }];
    return [403, { code: "SHARED_LINE_INBOUND_REQUIRED", status: 403 }];
  });
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, photon.fetchImpl);
  await assert.rejects(sender.sendText("+15555550123", "hi"), (error: unknown) =>
    error instanceof PhotonError && /messaged the line first/.test(error.message));

  const backend = fakeBackend();
  const service = new DeliveryService(new DeliveryStore(tempStore()), sender,
    { backendUrl: "http://backend", notifierToken: TOKEN, fetchImpl: backend.fetchImpl, sendRetryDelaysMs: [1, 1] });
  service.accept(alert());
  await service.idle();
  assert.equal(photon.calls.filter((c) => c.path.endsWith("/messages")).length, 2, "one probe above + one delivery attempt");
  assert.deepEqual(backend.calls[0].body, { status: "failed" });
});

test("Photon API sender asks for a first text when there is no conversation or line", async () => {
  const photon = fakePhoton((method, path) => {
    if (path.endsWith("/users")) return [200, { id: "u_me" }];
    return [200, { items: [] }];
  });
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, photon.fetchImpl);
  await assert.rejects(sender.sendText("+15555550123", "hi"), /Text the Photon line once/);
});

// Mirrors a real project: a shared line ending 7976, assigned to an Apple ID email.
function realProject() {
  const line = { id: "pho_usr_line", kind: "agent", handle: "+15550007976", details: { type: "shared" } };
  const human = { id: "pho_usr_human", kind: "human", handle: "someone@example.com", details: {} };
  return fakePhoton((method, path, body) => {
    if (method === "POST" && path.endsWith("/users")) return [200, body.handle === line.handle ? line : human];
    if (method === "GET" && path.includes("/spaces?")) {
      return [200, { items: [{ id: "pho_spc_1", kind: "direct", participantIds: [line.id, human.id] }] }];
    }
    if (method === "GET" && path.endsWith(`/users/${line.id}`)) return [200, line];
    if (method === "GET" && path.endsWith(`/users/${human.id}`)) return [200, human];
    if (method === "POST" && path.endsWith("/messages")) {
      return body.senderId === line.id ? [202, { id: "msg", status: "dispatched" }] : [409, { code: "SENDER_NOT_SENDABLE" }];
    }
    return [404, {}];
  });
}

test("refuses to text the Photon line's own number", async () => {
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, realProject().fetchImpl);
  await assert.rejects(sender.sendText("+15550007976", "hi"), /RECIPIENT_IS_LINE/);
});

test("texts an Apple ID email from the line", async () => {
  const photon = realProject();
  const sender = new PhotonApiSender({ ...baseConfig, mode: "photon_api" }, photon.fetchImpl);
  assert.deepEqual(await sender.sendText("someone@example.com", "hi"), { messageId: "msg" });
  assert.deepEqual(photon.calls.at(-1)!.body.senderId, "pho_usr_line");
});

test("accepts phone numbers and Apple ID emails as recipients", () => {
  assert.equal(normalizeHandle(" +1 (555) 000-7976 "), "+15550007976");
  assert.equal(normalizeHandle("First.Last@Example.com"), "first.last@example.com");
  assert.equal(normalizeHandle("555-0123"), "");
  assert.equal(parseAlert({ ...alert(), phone: "first.last@example.com" }).phone, "first.last@example.com");
});
