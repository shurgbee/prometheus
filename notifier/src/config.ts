import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../..");

// Share the repository's root .env with the Python backend. Real environment variables win.
const envPath = process.env.NOTIFIER_ENV_FILE ?? resolve(ROOT, ".env");
if (existsSync(envPath)) {
  const before = { ...process.env };
  process.loadEnvFile(envPath);
  Object.assign(process.env, before);
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function flag(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(env(name).toLowerCase());
}

function portFromUrl(url: string): number | undefined {
  try {
    const port = new URL(url).port;
    return port ? Number(port) : undefined;
  } catch {
    return undefined;
  }
}

export interface NotifierConfig {
  port: number;
  host: string;
  notifierToken: string;
  backendUrl: string;
  /** photon_api: api.photon.codes with a pho_sk_ key; spectrum: Spectrum SDK; dry_run: log only. */
  mode: "photon_api" | "spectrum" | "dry_run";
  photonApiUrl: string;
  photonProjectId: string;
  photonApiKey: string;
  photonPlatform?: "imessage" | "sms";
  voiceGatewayUrl?: string;
  voiceRetryDelayMs?: number;
  /** Optional: the line's phone number, when the project has several iMessage lines. */
  photonLine: string;
  /** Optional: the line's Photon user ID, skipping line lookup. */
  photonSenderId: string;
  spectrumProjectId: string;
  spectrumProjectSecret: string;
  dryRun: boolean;
  storePath: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(): NotifierConfig {
  const dryRun = flag("PHOTON_DRY_RUN");
  const photonProjectId = env("PHOTON_PROJECT_ID");
  const photonApiKey = env("PHOTON_API_KEY");
  const spectrumProjectId = env("SPECTRUM_PROJECT_ID");
  const spectrumProjectSecret = env("SPECTRUM_PROJECT_SECRET");
  const mode: NotifierConfig["mode"] = dryRun ? "dry_run"
    : photonApiKey || photonProjectId ? "photon_api"
    : spectrumProjectId || spectrumProjectSecret ? "spectrum" : "photon_api";
  const config: NotifierConfig = {
    port: Number(env("NOTIFIER_PORT") || portFromUrl(env("NOTIFIER_URL")) || 8001),
    host: env("NOTIFIER_HOST") || "127.0.0.1",
    notifierToken: env("NOTIFIER_TOKEN"),
    backendUrl: (env("NOTIFIER_BACKEND_URL", "BACKEND_URL") || "http://127.0.0.1:8000").replace(/\/+$/, ""),
    mode,
    photonApiUrl: (env("PHOTON_API_URL") || "https://api.photon.codes").replace(/\/+$/, ""),
    photonProjectId,
    photonApiKey,
    photonPlatform: (env("PHOTON_PLATFORM") || "imessage") as "imessage" | "sms",
    voiceGatewayUrl: env("VOICE_GATEWAY_URL").replace(/\/+$/, ""),
    voiceRetryDelayMs: Number(env("VOICE_RETRY_DELAY_MS") || 120_000),
    photonLine: env("PHOTON_LINE"),
    photonSenderId: env("PHOTON_SENDER_ID"),
    spectrumProjectId,
    spectrumProjectSecret,
    dryRun,
    storePath: resolve(ROOT, env("NOTIFIER_STORE_PATH") || "notifier/data/deliveries.json"),
    logLevel: (env("NOTIFIER_LOG_LEVEL") || "info") as NotifierConfig["logLevel"],
  };
  const missing: string[] = [];
  if (config.notifierToken.length < 16) missing.push("NOTIFIER_TOKEN (16+ characters, shared with the backend)");
  if (mode === "photon_api") {
    if (!photonProjectId) missing.push("PHOTON_PROJECT_ID (pho_prj_…)");
    if (!photonApiKey) missing.push("PHOTON_API_KEY (pho_sk_…)");
  } else if (mode === "spectrum") {
    if (!spectrumProjectId) missing.push("SPECTRUM_PROJECT_ID");
    if (!spectrumProjectSecret) missing.push("SPECTRUM_PROJECT_SECRET");
  }
  if (missing.length) {
    throw new Error(`Notifier configuration is incomplete. Set: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(config.port) || config.port <= 0) throw new Error("NOTIFIER_PORT must be a port number");
  if (!["sms", "imessage"].includes(config.photonPlatform!)) throw new Error("PHOTON_PLATFORM must be sms or imessage");
  if (!Number.isFinite(config.voiceRetryDelayMs) || config.voiceRetryDelayMs! < 0) throw new Error("Invalid VOICE_RETRY_DELAY_MS");
  return config;
}
