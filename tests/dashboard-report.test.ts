import { describe, expect, it } from "vitest";
import { applicationRate, dashboardDateLabel, dashboardDateRange } from "@/lib/dashboard-report";

describe("dashboard reporting dates and cohorts", () => {
  it("uses Chicago calendar days for preset ranges", () => {
    const range = dashboardDateRange("7", new Date("2026-10-06T04:30:00Z"));
    expect(range).toEqual({ from: "2026-09-29", to: "2026-10-05" });
  });

  it("keeps dashboard dates on the CT day across both daylight-saving changes", () => {
    expect(dashboardDateRange("7", new Date("2026-03-08T08:30:00Z"))).toMatchObject({ to: "2026-03-08" });
    expect(dashboardDateRange("7", new Date("2026-11-01T07:30:00Z"))).toMatchObject({ to: "2026-11-01" });
  });

  it("uses found-date applied applications as the rate denominator", () => {
    expect(applicationRate(10, 4)).toBe(40);
    expect(applicationRate(0, 0)).toBeNull();
  });

  it("labels a CT date bucket without converting UTC midnight into the prior day", () => {
    expect(dashboardDateLabel("2026-10-05")).toBe("Oct 5, 2026");
  });

  it("rejects invalid custom dates", () => {
    expect(() => dashboardDateRange("custom", new Date(), { from: "2026-02-31", to: "2026-03-01" })).toThrow();
  });
});
