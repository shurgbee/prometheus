// Sends one test iMessage through Photon to check credentials and the line.
// Usage: npm run send-test            (texts ALERT_PHONE from the root .env)
//        npm run send-test -- +15555550123 "custom message"   (or an Apple ID email)
import { loadConfig } from "./config.ts";
import { errorMessage } from "./log.ts";
import { createSender, maskPhone, normalizeHandle } from "./photon.ts";

const phone = normalizeHandle(process.argv[2] || process.env.ALERT_PHONE || "");
const body = process.argv[3] || "Finance Hub test: Photon texting is connected.";

if (!phone) {
  console.error("Give an E.164 phone number (e.g. +15555550123) or Apple ID email, or set ALERT_PHONE in .env");
  process.exit(1);
}

const sender = createSender(loadConfig());
try {
  const { messageId } = await sender.sendText(phone, body);
  console.log(`Sent to ${maskPhone(phone)}${messageId ? ` (message ${messageId})` : ""}`);
} catch (error) {
  console.error(`Send failed: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await sender.close();
}
