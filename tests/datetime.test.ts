import { it, expect } from "vitest";
import { parseTimestamp, localDateTimeToISO } from "@/lib/domain";
it("requires explicit timezone on server timestamps", () => {
  expect(() => parseTimestamp("2026-09-29T09:00")).toThrow();
  expect(parseTimestamp("2026-09-29T09:00:00-05:00")).toBe(
    "2026-09-29T14:00:00.000Z",
  );
});
it("converts a browser-local input before submission", () => {
  const input = "2026-09-29T09:00";
  expect(localDateTimeToISO(input)).toBe(new Date(input).toISOString());
  expect(() => localDateTimeToISO("invalid")).toThrow();
});
