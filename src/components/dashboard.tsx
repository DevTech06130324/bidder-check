"use client";
import Link from "next/link";
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatInTimeZone } from "date-fns-tz";
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
} from "lucide-react";
import type { WorkspaceData } from "@/lib/data";
import { summarizeEarnings, usd } from "@/lib/domain";
import { PageHeading } from "./common";
import { BidDialog, BidWorkspace } from "./bids";
export function Dashboard({ data }: { data: WorkspaceData }) {
  const [days, setDays] = useState(30);
  const timezone = data.workspaces[0]?.timezone ?? "America/Chicago";
  const now = new Date();
  const from = new Date(now.getTime() - (days - 1) * 86400000);
  const fromDate = formatInTimeZone(from, timezone, "yyyy-MM-dd");
  const bids = data.bids.filter(
    (b) =>
      formatInTimeZone(
        b.found_at,
        data.workspaces.find((w) => w.id === b.workspace_id)?.timezone ??
          timezone,
        "yyyy-MM-dd",
      ) >= fromDate,
  );
  const applied = bids.filter((b) => b.applied);
  const earnings = summarizeEarnings(
    data.bids.filter(
      (b) =>
        b.first_applied_at &&
        formatInTimeZone(
          b.first_applied_at,
          data.workspaces.find((w) => w.id === b.workspace_id)?.timezone ??
            timezone,
          "yyyy-MM-dd",
        ) >= fromDate,
    ),
  );
  const chart = Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getTime() + i * 86400000);
    const date = formatInTimeZone(d, timezone, "yyyy-MM-dd");
    return {
      date: formatInTimeZone(d, timezone, "MMM d"),
      found: bids.filter(
        (b) => formatInTimeZone(b.found_at, timezone, "yyyy-MM-dd") === date,
      ).length,
      applied: data.bids.filter(
        (b) =>
          b.applied &&
          b.first_applied_at &&
          formatInTimeZone(b.first_applied_at, timezone, "yyyy-MM-dd") === date,
      ).length,
    };
  });
  const sources = [...new Set(bids.map((b) => b.source || "Other"))]
    .map((source) => ({
      source,
      count: bids.filter((b) => (b.source || "Other") === source).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const stats = [
    {
      label: "Total bids",
      value: bids.length.toLocaleString(),
      sub: "Opportunities discovered",
      icon: BriefcaseBusiness,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Applications sent",
      value: applied.length.toLocaleString(),
      sub: `${bids.length - applied.length} waiting to be applied`,
      icon: CheckCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Application rate",
      value: `${bids.length ? Math.round((applied.length / bids.length) * 100) : 0}%`,
      sub: "Of discovered opportunities",
      icon: Target,
      color: "text-sky-600",
      bg: "bg-sky-500/10",
    },
    {
      label: "Total earnings",
      value: usd(earnings.cents),
      sub: `${earnings.count} qualifying applications`,
      icon: Wallet,
      color: "text-amber-600",
      bg: "bg-amber-500/10",
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
      <div className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      <div className="mb-7 grid gap-6 xl:grid-cols-[1fr_310px]">
        <section className="panel p-6">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Application activity</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Small steps. Steady progress.
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
            aria-label={`Activity chart: ${bids.length} bids found and ${applied.length} applied in this period`}
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
                        width: `${(s.count / Math.max(1, bids.length)) * 100}%`,
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
