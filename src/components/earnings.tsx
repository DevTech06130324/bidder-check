"use client";
import { useEffect, useState } from "react";
import { Wallet, CheckCheck, FileText } from "lucide-react";
import { usd } from "@/lib/domain";
import { PageHeading, Field, EmptyState } from "./common";
import { Button } from "./ui/button";
import { getEarningsPerformance, type EarningsReport } from "@/app/(workspace)/actions";
export function Earnings({
  bidderId,
  embedded = false,
}: {
  bidderId?: string;
  embedded?: boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [group, setGroup] = useState("bidder");
  const [report, setReport] = useState<EarningsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    void getEarningsPerformance({ from: from || undefined, to: to || undefined, bidder: bidderId, group: group === "bidder" ? "bidder" : "assignment" }).then((result) => {
      if (!current) return;
      if (result.error || !result.data) setError(result.error ?? "Earnings report is unavailable.");
      else { setReport(result.data); setError(""); }
      setLoading(false);
    });
    return () => { current = false; };
  }, [from, to, group, bidderId, refresh]);
  const total = report?.totals ?? { count: 0, cents: 0, resumes: 0, retainedCount: 0, trackedApplications: 0, trackedInterviews: 0, excludedInterviewCount: 0 };
  const groups = report?.groups ?? [];
  return (
    <>
      {!embedded && (
        <PageHeading
          eyebrow="THE VALUE OF YOUR PROGRESS"
          title="Every effort adds up."
          description="Earnings from saved bid rates and first application dates."
        />
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total earned", value: usd(total.cents), icon: Wallet },
          {
            label: "Qualifying applications",
            value: total.count,
            icon: CheckCheck,
          },
          {
            label: "Resumes with earnings",
            value: total.resumes,
            icon: FileText,
          },
        ].map((s) => (
          <div className="panel p-5" key={s.label}>
            <div className="flex justify-between text-xs text-muted-foreground">
              {s.label}
              <s.icon size={18} className="text-primary" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight">
              {s.value}
            </p>
          </div>
        ))}
      </div>
      <section className="panel p-5">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-1">
            {["bidder", "resume"].map((g) => (
              <Button
                key={g}
                size="sm"
                variant={group === g ? "secondary" : "ghost"}
                onClick={() => setGroup(g)}
              >
                By {g}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Field
              label="First applied from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Field
              label="Through"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              All time
            </Button>
          </div>
        </div>
        {error && <p role="alert" className="mb-4 text-sm text-destructive">{error} <Button size="sm" variant="outline" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Retry</Button></p>}
        {loading && <p className="py-8 text-center text-sm text-muted-foreground" role="status">Loading earnings…</p>}
        {!loading && !groups.length ? (
          <EmptyState
            title="Progress you can put a number on"
            description="Once an application is marked applied, its earnings will appear here."
          />
        ) : !loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-y text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-3 font-semibold">
                    {group === "bidder" ? "Team member" : "Resume profile"}
                  </th>
                  <th className="p-3 text-right font-semibold">Applications</th>
                  <th className="py-3 text-right font-semibold">
                    Earnings (USD)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="py-4">
                      <p className="text-sm font-semibold">{g.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {g.sub}
                      </p>
                    </td>
                    <td className="p-3 text-right text-sm">
                      {g.count}
                    </td>
                    <td className="py-4 text-right text-sm font-semibold">
                      {usd(g.cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t">
                <tr>
                  <td className="pt-4 font-semibold">Total</td>
                  <td className="pt-4 text-right font-semibold">
                    {total.count}
                  </td>
                  <td className="pt-4 text-right font-semibold text-primary">
                    {usd(total.cents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
        <p className="mt-6 rounded-lg bg-background p-3 text-[11px] leading-5 text-muted-foreground">
          Earnings use each bid’s saved rate and first application date.
          Unapplied bids are excluded; reapplying restores the original amount.
          This is an earnings record, not a payment or payout balance. Each
          workspace’s reporting timezone is used.
        </p>
          {!!total.retainedCount && <p className="mt-3 text-xs text-muted-foreground">Includes {total.retainedCount} retained historical applications. Their individual application details have been removed.</p>}
      </section>
    </>
  );
}
