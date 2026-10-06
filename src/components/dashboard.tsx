"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowUpRight, BriefcaseBusiness, CalendarCheck2,
  CheckCheck, Clock3, LoaderCircle, RefreshCw, Target, Wallet,
} from "lucide-react";
import type { WorkspaceData } from "@/lib/data";
import { BID_TIMEZONE, usd } from "@/lib/domain";
import { applicationRate, dashboardDateLabel, dashboardDateRange, type ReportPreset } from "@/lib/dashboard-report";
import { getDashboardPerformance, type DashboardReport } from "@/app/(workspace)/actions";
import { PageHeading } from "./common";
import { BidDialog, BidWorkspace } from "./bids";
import { Button } from "./ui/button";

const todayCT = (date: Date) => formatInTimeZone(date, BID_TIMEZONE, "yyyy-MM-dd");
const datePlus = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const chartStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };

export function Dashboard({ data }: { data: WorkspaceData }) {
  const [now, setNow] = useState(() => new Date());
  const [preset, setPreset] = useState<ReportPreset>("30");
  const [customFrom, setCustomFrom] = useState(() => datePlus(todayCT(new Date()), -29));
  const [customTo, setCustomTo] = useState(() => todayCT(new Date()));
  const [workspace, setWorkspace] = useState("");
  const [bidder, setBidder] = useState("");
  const [profile, setProfile] = useState("");
  const [group, setGroup] = useState<"profile" | "bidder" | "assignment">("profile");
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const isManager = data.profile.role !== "bidder";
  const range = useMemo(() => dashboardDateRange(preset, now, preset === "custom" ? { from: customFrom, to: customTo } : undefined), [preset, now, customFrom, customTo]);
  const load = useCallback(async (signal: { current: boolean }) => {
    setLoading(true);
    try {
      const result = await getDashboardPerformance({
        ...range,
        workspace: workspace || undefined,
        bidder: bidder || undefined,
        profile: profile || undefined,
        group,
      });
      if (!signal.current) return;
      if (result.error || !result.data) setError(result.error ?? "Dashboard report is unavailable. Try again.");
      else {
        setReport(result.data);
        setError("");
      }
    } catch {
      if (signal.current) setError("Dashboard report is unavailable. Check your connection and retry.");
    } finally {
      if (signal.current) setLoading(false);
    }
  }, [range, workspace, bidder, profile, group]);

  useEffect(() => {
    const active = { current: true };
    const timer = window.setTimeout(() => void load(active), 0);
    return () => { active.current = false; window.clearTimeout(timer); };
  }, [load, refresh]);

  useEffect(() => {
    const refreshAtMidnight = () => {
      const current = new Date();
      const tomorrow = datePlus(todayCT(current), 1);
      const midnight = fromZonedTime(`${tomorrow}T00:00:00`, BID_TIMEZONE);
      const timer = window.setTimeout(() => {
        const updated = new Date();
        setNow(updated);
      }, Math.max(1, midnight.getTime() - current.getTime()));
      return () => window.clearTimeout(timer);
    };
    return refreshAtMidnight();
  }, [now, preset]);

  useEffect(() => {
    const focus = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  const rows = report?.daily.map((item) => ({
    ...item,
    label: dashboardDateLabel(item.date),
    tooltipDate: `${dashboardDateLabel(item.date)} CT`,
  })) ?? [];
  const rate = report ? applicationRate(report.totals.found, report.totals.foundApplied) : null;
  const interviewRate = report && report.totals.trackedApplications > 0
    ? report.totals.trackedInterviews / report.totals.trackedApplications * 100
    : null;
  const stats = [
    { label: "Bids found", value: report?.totals.found.toLocaleString() ?? "—", note: "Found-date cohort", icon: BriefcaseBusiness, tone: "text-primary bg-primary/10" },
    { label: "Applied from cohort", value: report?.totals.foundApplied.toLocaleString() ?? "—", note: `${rate === null ? "—" : `${rate.toFixed(1)}%`} of bids found`, icon: CheckCheck, tone: "text-emerald-600 bg-emerald-500/10" },
    { label: "Application activity", value: report?.totals.appliedActivity.toLocaleString() ?? "—", note: "Latest applied date", icon: Target, tone: "text-sky-600 bg-sky-500/10" },
    { label: "Earned", value: report ? usd(report.totals.earningsCents) : "—", note: `${report?.totals.earningsCount ?? 0} qualifying applications`, icon: Wallet, tone: "text-amber-600 bg-amber-500/10" },
    { label: "Interview conversion", value: interviewRate === null ? "—" : `${interviewRate.toFixed(1)}%`, note: `${report?.totals.trackedInterviews ?? 0} invitations / ${report?.totals.trackedApplications ?? 0} tracked applied`, icon: CalendarCheck2, tone: "text-violet-600 bg-violet-500/10" },
  ];
  const pending = report?.review.pending ?? 0;
  const approved = report?.review.approved_unapplied ?? 0;
  const rejected = report?.review.rejected ?? 0;

  return <>
    <PageHeading eyebrow="LET’S MAKE TODAY COUNT" title={`Welcome back, ${data.profile.display_name.split(" ")[0] || "there"}.`} description="A detailed view of application activity, earnings, review work, and interview outcomes.">
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><Clock3 size={14} /> CT reporting</span>
        <Button size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={loading} aria-label="Refresh dashboard">
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh
        </Button>
        <BidDialog data={data} />
      </div>
    </PageHeading>

    <section className="panel mb-5 flex flex-wrap items-end gap-3 p-4" aria-label="Dashboard report filters">
      <label className="space-y-1 text-xs text-muted-foreground"><span>Period</span><select className="native-select block min-w-36 text-foreground" value={preset} onChange={(e) => setPreset(e.target.value as ReportPreset)}>
        <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option>
      </select></label>
      {preset === "custom" && <>
        <label className="space-y-1 text-xs text-muted-foreground"><span>From (CT)</span><input type="date" className="native-select block text-foreground" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} /></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span>Through (CT)</span><input type="date" className="native-select block text-foreground" value={customTo} min={customFrom} max={todayCT(now)} onChange={(e) => setCustomTo(e.target.value)} /></label>
      </>}
      {isManager && (data.profile.role === "admin" || data.workspaces.length > 1) && <label className="space-y-1 text-xs text-muted-foreground"><span>Workspace</span><select className="native-select block min-w-40 text-foreground" value={workspace} onChange={(e) => { setWorkspace(e.target.value); setBidder(""); setProfile(""); }}><option value="">All workspaces</option>{data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
      {isManager && <label className="space-y-1 text-xs text-muted-foreground"><span>Bidder</span><select className="native-select block min-w-40 text-foreground" value={bidder} onChange={(e) => setBidder(e.target.value)}><option value="">All bidders</option>{data.bidders.filter((b) => !b.archived && (!workspace || b.workspace_id === workspace)).map((b) => <option key={b.user_id} value={b.user_id}>{data.profiles.find((p) => p.id === b.user_id)?.display_name ?? b.user_id}</option>)}</select></label>}
      <label className="space-y-1 text-xs text-muted-foreground"><span>Candidate profile</span><select className="native-select block min-w-40 text-foreground" value={profile} onChange={(e) => setProfile(e.target.value)}><option value="">All profiles</option>{data.candidateProfiles.filter((p) => !p.archived && (!workspace || p.workspace_id === workspace)).map((p) => <option key={p.id} value={p.id}>{p.identifier}</option>)}</select></label>
      <label className="space-y-1 text-xs text-muted-foreground"><span>Compare by</span><select className="native-select block min-w-36 text-foreground" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}><option value="profile">Profile</option><option value="bidder">Bidder</option><option value="assignment">Profile + bidder</option></select></label>
      <span className="ml-auto flex items-center gap-2 pb-2 text-xs text-muted-foreground" role="status">{loading && <LoaderCircle size={14} className="animate-spin" />} {range.from} – {range.to} CT</span>
    </section>
    {error && <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>Retry</Button></div>}

    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {stats.map((s) => <div className="panel p-4" key={s.label}><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{s.label}</span><span className={`rounded-lg p-2 ${s.tone}`}><s.icon size={16} /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight">{loading && !report ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-muted" /> : s.value}</p><p className="mt-1.5 text-[11px] text-muted-foreground">{s.note}</p></div>)}
    </div>
    {!!report && <p className="mb-5 text-xs text-muted-foreground">Historical totals include applications retained as daily aggregates after their details expired. Review backlog and job-source breakdowns use currently retained records.</p>}

    <div className="mb-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <section className="panel min-w-0 p-5" aria-labelledby="daily-activity-title">
        <div className="mb-4"><h2 id="daily-activity-title" className="font-semibold">Daily application activity</h2><p className="mt-1 text-xs text-muted-foreground">Found-date bids and latest successful application activity, by CT day.</p></div>
        <div className="h-72 w-full min-w-0" role="img" aria-label={`Daily activity chart. ${report?.totals.found ?? 0} bids found and ${report?.totals.appliedActivity ?? 0} applications marked applied in the selected range.`}>
          {loading && !report ? <div className="h-full animate-pulse rounded bg-muted/50" /> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="dashboardFound" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8576ed" stopOpacity={0.22} /><stop offset="100%" stopColor="#8576ed" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="label" minTickGap={32} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipDate ?? ""} formatter={(value, name) => [Number(value).toLocaleString(), name]} contentStyle={chartStyle} /><Area name="Found" dataKey="found" type="monotone" stroke="#8576ed" strokeWidth={2.5} fill="url(#dashboardFound)" isAnimationActive={false} /><Area name="Applied activity" dataKey="applied" type="monotone" stroke="#34b991" strokeWidth={2} fill="transparent" isAnimationActive={false} /></AreaChart></ResponsiveContainer>}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Found: {report?.totals.found.toLocaleString() ?? "—"}</span><span>Applied-date activity: {report?.totals.appliedActivity.toLocaleString() ?? "—"}</span><span>Still applied from found cohort: {report?.totals.foundApplied.toLocaleString() ?? "—"}</span></div>
        <details className="mt-3 border-t pt-3 text-xs"><summary className="cursor-pointer font-medium">View daily activity values</summary><div className="mt-2 max-h-52 overflow-auto"><table className="w-full"><caption className="sr-only">Daily bid and application counts in Central Time</caption><thead><tr className="text-left text-muted-foreground"><th className="py-1">CT date</th><th className="text-right">Found</th><th className="text-right">Still applied from cohort</th><th className="text-right">Applied activity</th><th className="text-right">Earnings</th></tr></thead><tbody>{rows.map((item) => <tr key={item.date} className="border-t"><th scope="row" className="py-1.5 text-left font-medium">{item.tooltipDate}</th><td className="text-right">{item.found}</td><td className="text-right">{item.foundApplied}</td><td className="text-right">{item.applied}</td><td className="text-right">{usd(item.earningsCents)}</td></tr>)}</tbody></table></div></details>
      </section>
      <section className="panel min-w-0 p-5" aria-labelledby="earnings-chart-title">
        <div className="mb-4"><h2 id="earnings-chart-title" className="font-semibold">Daily earnings</h2><p className="mt-1 text-xs text-muted-foreground">Attributed to each application’s first successful applied date.</p></div>
        <div className="h-72 w-full min-w-0" role="img" aria-label={`Daily earnings total ${report ? usd(report.totals.earningsCents) : "loading"}`}>
          {loading && !report ? <div className="h-full animate-pulse rounded bg-muted/50" /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--border)" /><XAxis dataKey="label" minTickGap={32} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => `$${(Number(value) / 100).toFixed(0)}`} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipDate ?? ""} formatter={(value) => [usd(Number(value)), "Earned"]} contentStyle={chartStyle} /><Bar dataKey="earningsCents" name="Earned" fill="#e7b85f" radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer>}
        </div><p className="mt-2 text-xs text-muted-foreground">Total: <strong className="text-foreground">{report ? usd(report.totals.earningsCents) : "—"}</strong> across {report?.totals.earningsCount ?? 0} qualifying applications</p>
      </section>
    </div>

    <div className="mb-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <section className="panel p-5" aria-labelledby="review-workload-title"><div className="mb-4"><h2 id="review-workload-title" className="font-semibold">Review workload</h2><p className="mt-1 text-xs text-muted-foreground">Current retained application review states.</p></div><div className="grid grid-cols-3 gap-3">{[["Pending", pending, "text-amber-600"], ["Approved · unapplied", approved, "text-emerald-600"], ["Rejected", rejected, "text-rose-600"]].map(([label, value, color]) => <div className="rounded-lg border bg-background p-3" key={String(label)}><p className="text-[11px] text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p></div>)}</div><Link className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary" href="/bids?review=pending">Open review queue <ArrowUpRight size={14} /></Link></section>
      <section className="panel min-w-0 p-5" aria-labelledby="performance-title"><div className="mb-4 flex flex-wrap items-start justify-between gap-2"><div><h2 id="performance-title" className="font-semibold">{group === "profile" ? "Profile performance" : group === "bidder" ? "Bidder performance" : "Profile + bidder performance"}</h2><p className="mt-1 text-xs text-muted-foreground">Applied applications and interview invitations by first-application cohort.</p></div><span className="text-xs text-muted-foreground">Interview conversion</span></div>
        {!report?.groups.length ? <p className="py-12 text-center text-sm text-muted-foreground">No applied applications in this date range.</p> : <div className="h-64 w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.groups.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 18, left: 12, bottom: 0 }}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="var(--border)" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} /><Tooltip formatter={(value, name, item) => [name === "Applied" ? `${value} applications` : `${value} invitations · ${item.payload.conversion ?? "—"}%`, name]} contentStyle={chartStyle} /><Bar dataKey="applied" name="Applied" fill="#8576ed" radius={[0, 4, 4, 0]} isAnimationActive={false} /><Bar dataKey="interviews" name="Interview invitations" fill="#34b991" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>}
        {!!report?.groups.length && <div className="max-h-44 overflow-auto border-t pt-2"><table className="w-full text-xs"><caption className="sr-only">Detailed performance groups</caption><thead><tr className="text-muted-foreground"><th className="py-1 text-left">Group</th><th className="text-right">Applied</th><th className="text-right">Invitations</th><th className="text-right">Conversion</th></tr></thead><tbody>{report.groups.map((item) => <tr key={item.key} className="border-t"><th className="py-1.5 text-left font-medium">{item.label}</th><td className="text-right">{item.applied}</td><td className="text-right">{item.interviews}</td><td className="text-right">{item.conversion === null ? "—" : `${item.conversion.toFixed(1)}%`}</td></tr>)}</tbody></table></div>}
      </section>
    </div>

    <section className="panel mb-5 p-5" aria-labelledby="source-breakdown-title"><h2 id="source-breakdown-title" className="font-semibold">Job source breakdown</h2><p className="mt-1 text-xs text-muted-foreground">Top sources among currently retained bids found in this range.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{report?.sources.length ? report.sources.map((source) => <div key={source.label} className="rounded-lg border bg-background p-3"><p className="truncate text-xs text-muted-foreground" title={source.label}>{source.label}</p><p className="mt-1 text-xl font-semibold">{source.value.toLocaleString()}</p></div>) : <p className="py-5 text-sm text-muted-foreground">No source activity in this range.</p>}</div></section>

    <section className="mb-7"><h2 className="mb-4 font-semibold">Bid applications</h2><BidWorkspace data={data} embedded /></section>
  </>;
}
