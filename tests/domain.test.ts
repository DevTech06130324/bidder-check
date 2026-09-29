import { describe, it, expect } from "vitest";
import {
  normalizeJobUrl,
  moneyToCents,
  effectiveRate,
  summarizeEarnings,
  dateInRange,
  validateUpload,
} from "@/lib/domain";

describe("job URL identity", () => {
  it("removes marketing parameters while retaining job identity", () => {
    expect(
      normalizeJobUrl(
        "https://EXAMPLE.com/jobs?utm_source=test&jobId=123&referral=x#apply",
      ),
    ).toBe("https://example.com/jobs?jobId=123&referral=x");
  });
  it("sorts query parameters and rejects executable URLs", () => {
    expect(normalizeJobUrl("https://example.com/?b=2&a=1")).toBe(
      "https://example.com/?a=1&b=2",
    );
    expect(() => normalizeJobUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeJobUrl("https://user:pass@example.com")).toThrow();
  });
});
describe("money", () => {
  it("uses cents without rounding ambiguous input", () => {
    expect(moneyToCents("1.25")).toBe(125);
    expect(moneyToCents("0")).toBe(0);
    expect(moneyToCents("")).toBeNull();
    expect(() => moneyToCents("1.001")).toThrow();
    expect(() => moneyToCents("-2")).toThrow();
  });
  it("allows explicit zero overrides", () => {
    expect(effectiveRate(50, 0)).toBe(0);
    expect(effectiveRate(50, null)).toBe(50);
    expect(effectiveRate(null, null)).toBeNull();
  });
  it("counts only applied evidence-backed records once at their saved rate", () => {
    expect(
      summarizeEarnings([
        { id: "1", applied: true, evidence_file_id: "a", rate_cents: 125 },
        { id: "2", applied: false, evidence_file_id: "b", rate_cents: 200 },
        { id: "3", applied: true, evidence_file_id: null, rate_cents: 300 },
      ]),
    ).toEqual({ count: 1, cents: 125 });
  });
});
it("filters dates using the workspace timezone including DST", () => {
  expect(
    dateInRange(
      "2026-03-09T04:30:00Z",
      "2026-03-08",
      "2026-03-08",
      "America/Chicago",
    ),
  ).toBe(true);
  expect(
    dateInRange(
      "2026-03-09T05:30:00Z",
      "2026-03-08",
      "2026-03-08",
      "America/Chicago",
    ),
  ).toBe(false);
});
it("rejects unsupported and oversized uploads", () => {
  expect(() => validateUpload("screenshot", "image/svg+xml", 100)).toThrow();
  expect(() =>
    validateUpload("resume", "application/pdf", 11 * 1024 * 1024),
  ).toThrow();
  expect(() => validateUpload("screenshot", "image/png", 1024)).not.toThrow();
});
