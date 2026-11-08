/** Regular US stock market hours: 9:30–16:00 America/New_York, Monday–Friday (holidays not modelled). */
export function isMarketOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function clockLabel(now: Date = new Date()): string {
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const tz =
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")
      ?.value ?? "";
  return `${time} ${tz}`.trim();
}
