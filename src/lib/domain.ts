import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
export const BID_TIMEZONE = "America/Chicago";
export function chicagoDateRange(
  mode: string,
  from: string,
  to: string,
  now = new Date(),
): { from?: string; to?: string } {
  if (mode === "all") return {};
  if (mode === "today")
    from = to = formatInTimeZone(now, BID_TIMEZONE, "yyyy-MM-dd");
  if (mode === "yesterday") {
    const day = new Date(
      `${formatInTimeZone(now, BID_TIMEZONE, "yyyy-MM-dd")}T00:00:00Z`,
    );
    day.setUTCDate(day.getUTCDate() - 1);
    from = to = day.toISOString().slice(0, 10);
  }
  if (mode !== "today" && mode !== "yesterday" && mode !== "custom")
    throw new Error("Invalid date filter");
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to)
    throw new Error("Choose a valid date range");
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: fromZonedTime(`${from}T00:00:00`, BID_TIMEZONE).toISOString(),
    to: fromZonedTime(
      `${next.toISOString().slice(0, 10)}T00:00:00`,
      BID_TIMEZONE,
    ).toISOString(),
  };
}

export function normalizeJobUrl(input: string) {
  const url = new URL(input.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Enter a valid HTTP or HTTPS job URL.");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (
      /^utm_/i.test(key) ||
      ["fbclid", "gclid", "msclkid"].includes(key.toLowerCase())
    )
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function localDateTimeToISO(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Enter a valid date and time.");
  return date.toISOString();
}
export function parseTimestamp(value: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value))
    throw new Error("Timestamp must include a timezone.");
  return localDateTimeToISO(value);
}
export function moneyToCents(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("Use a positive USD amount with up to two decimals.");
  const [whole, decimal = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100000000)
    throw new Error("Rate is too large.");
  return cents;
}
export function effectiveRate(bidder: number | null, resume: number | null) {
  return resume ?? bidder;
}
export function summarizeEarnings(
  rows: {
    id: string;
    applied: boolean;
    evidence_file_id: string | null;
    rate_cents: number | null;
    deleted_at?: string | null;
  }[],
) {
  const eligible = [...new Map(rows.map((r) => [r.id, r])).values()].filter(
    (r) =>
      !r.deleted_at && r.applied && r.evidence_file_id && r.rate_cents !== null,
  );
  return {
    count: eligible.length,
    cents: eligible.reduce((sum, r) => sum + (r.rate_cents ?? 0), 0),
  };
}
export function dateInRange(
  timestamp: string,
  from: string,
  to: string,
  timezone: string,
) {
  const date = formatInTimeZone(timestamp, timezone, "yyyy-MM-dd");
  return (!from || date >= from) && (!to || date <= to);
}
export const uploadTypes = {
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  resume: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};
export function validateUpload(
  kind: keyof typeof uploadTypes,
  mime: string,
  size: number,
) {
  if (!uploadTypes[kind].includes(mime))
    throw new Error("This file type is not supported.");
  if (size <= 0 || size > 10 * 1024 * 1024)
    throw new Error("Choose a file between 1 byte and 10 MB.");
}
export function usd(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
