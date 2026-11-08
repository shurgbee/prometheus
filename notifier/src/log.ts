type Fields = Record<string, unknown>;

function write(level: string, message: string, fields?: Fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...fields });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
