"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  BriefcaseBusiness,
  CheckCheck,
  Wallet,
  ArrowUpRight,
  CalendarDays,
  Users,
  FileText,
  Target,
  Sun,
  CalendarCheck2,
} from "lucide-react";
import type { WorkspaceData } from "@/lib/data";
import {
  BID_TIMEZONE,
  formatCTDateBucket,
  summarizeEarnings,
  usd,
} from "@/lib/domain";
import { PageHeading } from "./common";
import { BidDialog, BidWorkspace } from "./bids";
export function Dashboard({ data }: { data: WorkspaceData }) {
  const [days, setDays] = useState(30);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const today = formatInTimeZone(now, BID_TIMEZONE, "yyyy-MM-dd");
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const nextMidnight = fromZonedTime(`${tomorrow.toISOString().slice(0, 10)}T00:00:00`, BID_TIMEZONE);
    const timer = window.setTimeout(() => setNow(new Date()), Math.max(1, nextMidnight.getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [now]);
  const timezone = BID_TIMEZONE;
  const throughDate = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const firstDay = new Date(`${throughDate}T00:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - (days - 1));
  const fromDate = firstDay.toISOString().slice(0, 10);
  const retained = data.historicalAggregates.filter(
    (row) => row.report_day >= fromDate && row.report_day <= throughDate,
  );
  const liveFound = data.bids.filter(
    (b) =>
      formatInTimeZone(b.found_at, timezone, "yyyy-MM-dd") >= fromDate &&
      formatInTimeZone(b.found_at, timezone, "yyyy-MM-dd") <= throughDate,
  );
  const foundHistory = retained.filter((row) => row.metric === "found").reduce((sum, row) => sum + row.record_count, 0);
  const appliedHistory = retained.filter((row) => row.metric === "applied_activity").reduce((sum, row) => sum + row.record_count, 0);
  const earningHistory = retained.filter((row) => row.metric === "earning");
  const bids = liveFound.length + foundHistory;
  const interviewCohort = data.bids.filter((b) => b.applied && b.first_applied_at && formatInTimeZone(b.first_applied_at, timezone, "yyyy-MM-dd") >= fromDate && formatInTimeZone(b.first_applied_at, timezone, "yyyy-MM-dd") <= throughDate);
  const trackedHistory = earningHistory.reduce((total, row) => total + Number(row.tracked_count), 0);
  const interviewHistory = earningHistory.reduce((total, row) => total + Number(row.interview_count), 0);
  const interviewApplications = interviewCohort.length + trackedHistory;
  const interviewInvitations = interviewCohort.filter((b) => b.interview_scheduled).length + interviewHistory;
  const applied = data.bids.filter(
    (b) => b.applied && b.applied_at &&
      formatInTimeZone(b.applied_at, timezone, "yyyy-MM-dd") >= fromDate &&
      formatInTimeZone(b.applied_at, timezone, "yyyy-MM-dd") <= throughDate,
  );
  const liveEarnings = summarizeEarnings(
    data.bids.filter(
      (b) =>
        b.first_applied_at &&
        formatInTimeZone(b.first_applied_at, timezone, "yyyy-MM-dd") >= fromDate &&
        formatInTimeZone(b.first_applied_at, timezone, "yyyy-MM-dd") <= throughDate,
    ),
  );
  const earnings = {
    count: liveEarnings.count + earningHistory.reduce((sum, row) => sum + row.record_count, 0),
    cents: liveEarnings.cents + earningHistory.reduce((sum, row) => sum + Number(row.earned_cents), 0),
  };
  const chart = Array.from({ length: days }, (_, i) => {
    const d = new Date(firstDay);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    return {
      date: formatCTDateBucket(date),
      found: liveFound.filter(
        (b) => formatInTimeZone(b.found_at, timezone, "yyyy-MM-dd") === date,
      ).length + retained.filter((row) => row.metric === "found" && row.report_day === date).reduce((sum, row) => sum + row.record_count, 0),
      applied: data.bids.filter(
        (b) =>
          b.applied &&
          b.applied_at &&
          formatInTimeZone(b.applied_at, timezone, "yyyy-MM-dd") === date,
      ).length + retained.filter((row) => row.metric === "applied_activity" && row.report_day === date).reduce((sum, row) => sum + row.record_count, 0),
    };
  });
  const sources = [...new Set(liveFound.map((b) => b.source || "Other"))]
    .map((source) => ({
      source,
      count: liveFound.filter((b) => (b.source || "Other") === source).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const stats = [
    {
      label: "Total bids",
      value: bids.toLocaleString(),
      sub: "Opportunities discovered",
      icon: BriefcaseBusiness,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Applications sent",
      value: (applied.length + appliedHistory).toLocaleString(),
      sub: `${Math.max(0, bids - applied.length - appliedHistory)} waiting to be applied`,
      icon: CheckCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Application rate",
      value: `${bids ? Math.round(((applied.length + appliedHistory) / bids) * 100) : 0}%`,
      sub: "Of discovered opportunities",
      icon: Target,
      color: "text-sky-600",
      bg: "bg-sky-500/10",
    },
    {
      label: "Total earnings",
      value: usd(earnings.cents),
      sub: `${earnings.count} qualifying applications${earningHistory.length ? " · includes retained history" : ""}`,
      icon: Wallet,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
    },
    {
      label: "Interview conversion",
      value: interviewApplications ? `${Math.round(interviewInvitations / interviewApplications * 100)}%` : "—",
      sub: `${interviewInvitations} invitation${interviewInvitations === 1 ? "" : "s"} / ${interviewApplications} applications`,
      icon: CalendarCheck2,
      color: "text-violet-600",
      bg: "bg-violet-500/10",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="LET’S MAKE TODAY COUNT"
        title={`Welcome back, ${data.profile.display_name.split(" ")[0] || "there"}.`}
        description="Here’s the bigger picture of your team’s progress."
      >
        <div className="flex gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 text-xs">
            <CalendarDays size={14} className="text-muted-foreground" />
            <select
              aria-label="Reporting period"
              className="h-9 bg-transparent outline-none"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <BidDialog data={data} />
        </div>
      </PageHeading>
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((s) => (
          <div className="panel p-5" key={s.label}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {s.label}
              </span>
              <span className={`rounded-lg p-2 ${s.bg} ${s.color}`}>
                <s.icon size={16} />
              </span>
            </div>
            <p className="mt-3 text-[29px] font-semibold tracking-[-1px]">
              {s.value}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>
      {!!retained.length && <p className="-mt-3 mb-6 rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">Totals include daily history for applications whose details were permanently removed after their profile retention period.</p>}
      <div className="mb-7 grid gap-6 xl:grid-cols-[1fr_310px]">
        <section className="panel p-6">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Application activity</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Daily totals grouped by Central Time (CT).
              </p>
            </div>
            <div className="flex gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" />
                Found
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-400" />
                Applied
              </span>
            </div>
          </div>
          <div
            className="h-[235px] w-full min-w-0"
            role="img"
          aria-label={`Activity chart: ${bids} bids found and ${applied.length + appliedHistory} applied in this period`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chart}
                margin={{ top: 10, right: 0, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="foundFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8576ed" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#8576ed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 5"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                  dy={10}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Area
                  name="Found"
                  type="monotone"
                  dataKey="found"
                  stroke="#8576ed"
                  strokeWidth={2.5}
                  fill="url(#foundFill)"
                  isAnimationActive={false}
                />
                <Area
                  name="Applied"
                  type="monotone"
                  dataKey="applied"
                  stroke="#34b991"
                  strokeWidth={2}
                  fill="transparent"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel p-6">
          <h2 className="font-semibold">Where opportunities begin</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your most active job sources
          </p>
          <div className="mt-7 space-y-6">
            {sources.length ? (
              sources.map((s, i) => (
                <div key={s.source}>
                  <div className="mb-2.5 flex justify-between text-xs">
                    <span className="font-medium">{s.source}</span>
                    <span className="text-muted-foreground">
                      {s.count} bids
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(s.count / Math.max(1, liveFound.length)) * 100}%`,
                        background: [
                          "#8072de",
                          "#6ba8e8",
                          "#6ec8ad",
                          "#e8ba71",
                          "#bb8bcc",
                        ][i],
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center">
                <BriefcaseBusiness
                  className="mx-auto mb-3 text-muted-foreground"
                  size={28}
                  strokeWidth={1}
                />
                <p className="text-xs leading-6 text-muted-foreground">
                  Your sources will appear here
                  <br />
                  as you add opportunities.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="mb-7">
        <h2 className="mb-4 font-semibold">Daily bid activity</h2>
        <BidWorkspace data={data} embedded />
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {[
          {
            icon: Users,
            title: "People make it happen",
            text: `${data.bidders.filter((b) => !b.archived).length} active bidders in your workspace`,
            href: data.profile.role === "bidder" ? "/settings" : "/users",
          },
          {
            icon: FileText,
            title: "Prepared for what’s next",
            text: `${data.resumes.filter((r) => !r.archived).length} resume profiles, organized and ready`,
            href: "/resumes",
          },
          {
            icon: Sun,
            title: "Every effort adds up",
            text: "See the earnings behind your applications",
            href: "/earnings",
          },
        ].map((c) => (
          <Link
            key={c.title}
            href={c.href}
            className="panel group flex items-start gap-4 p-5"
          >
            <c.icon size={19} className="mt-1 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold group-hover:text-primary">
                {c.title}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {c.text}
              </p>
            </div>
            <ArrowUpRight
              className="ml-auto shrink-0 text-muted-foreground"
              size={15}
            />
          </Link>
        ))}
      </div>
    </>
  );
}
