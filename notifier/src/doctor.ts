// Prints what the Photon API reports about this project's iMessage setup, to debug sends.
// Phone numbers are masked. Usage: npm run photon-doctor
import { loadConfig } from "./config.ts";
import { errorMessage } from "./log.ts";
import { normalizeHandle } from "./photon.ts";

const config = loadConfig();
const phone = normalizeHandle(process.env.ALERT_PHONE ?? "");
const base = `${config.photonApiUrl}/v1/projects/${encodeURIComponent(config.photonProjectId)}`;

const mask = (value: unknown) =>
  JSON.stringify(value, null, 2).replace(/\+?\d{7,15}/g, (m) => `…${m.slice(-4)}`);

async function get(path: string): Promise<any> {
  const response = await fetch(base + path, {
    headers: { Authorization: `Bearer ${config.photonApiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return response.ok ? data : { error: response.status, ...data };
  } catch {
    return { error: response.status, body: text.slice(0, 300) };
  }
}

async function section(title: string, path: string) {
  console.log(`\n=== ${title} (GET ${path.split("?")[0]})`);
  try {
    const data = await get(path);
    console.log(mask(data));
    return data;
  } catch (error) {
    console.log(`failed: ${errorMessage(error)}`);
    return undefined;
  }
}

await section("iMessage platform", "/platforms/imessage");
await section("Lines and numbers", "/platforms/resources?pageSize=50");
await section("iMessage assignments", "/platforms/imessage/assignments?pageSize=50");
const users = await section("iMessage users", "/users?platform=imessage&pageSize=50");
const me = (users?.items ?? []).find((u: any) => normalizeHandle(String(u.handle)) === phone);
if (me?.kind === "agent") console.log("\n!! ALERT_PHONE is the Photon line itself. Set it to the phone or Apple ID you text the line from.");
if (me) {
  await section("Conversations with ALERT_PHONE", `/spaces?platform=imessage&participantId=${me.id}&pageSize=20`);
} else {
  console.log("\nALERT_PHONE is not among the project's iMessage users yet.");
}
