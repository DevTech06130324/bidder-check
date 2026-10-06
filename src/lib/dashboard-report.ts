import { formatInTimeZone } from "date-fns-tz";
import { BID_TIMEZONE } from "./domain";

export type ReportPreset = "7" | "30" | "90" | "custom";

export function dashboardDateRange(
  preset: ReportPreset,
  now = new Date(),
  custom?: { from: string; to: string },
) {
  const today = formatInTimeZone(now, BID_TIMEZONE, "yyyy-MM-dd");
  if (preset === "custom") {
    if (!custom || !validDate(custom.from) || !validDate(custom.to) || custom.from > custom.to)
      throw new Error("Choose a valid custom date range.");
    return custom;
  }
  const days = Number(preset);
  if (![7, 30, 90].includes(days)) throw new Error("Choose a valid reporting period.");
  const first = new Date(`${today}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - days + 1);
  return { from: first.toISOString().slice(0, 10), to: today };
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function applicationRate(found: number, foundApplied: number) {
  return found === 0 ? null : (foundApplied / found) * 100;
}

export function dashboardDateLabel(date: string) {
  if (!validDate(date)) throw new Error("Invalid report date.");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}
