"use client";
import { useState } from "react";
import { Wallet, CheckCheck, FileText } from "lucide-react";
import type { WorkspaceData } from "@/lib/data";
import { usd, summarizeEarnings, dateInRange } from "@/lib/domain";
import { PageHeading, Field, EmptyState } from "./common";
import { Button } from "./ui/button";
export function Earnings({
  data,
  bidderId,
  embedded = false,
}: {
  data: WorkspaceData;
  bidderId?: string;
  embedded?: boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [group, setGroup] = useState("bidder");
  const records = data.bids.filter(
    (b) =>
      (!bidderId || b.bidder_id === bidderId) &&
      b.first_applied_at &&
      dateInRange(
        b.first_applied_at,
        from,
        to,
        data.workspaces.find((w) => w.id === b.workspace_id)?.timezone ??
          "America/Chicago",
      ),
  );
  const history = data.historicalAggregates.filter((row) =>
    row.metric === "earning" && (!bidderId || row.bidder_id === bidderId) &&
    (!from || row.report_day >= from) && (!to || row.report_day <= to),
  );
  const liveTotal = summarizeEarnings(records);
  const total = {
    count: liveTotal.count + history.reduce((sum, row) => sum + row.record_count, 0),
    cents: liveTotal.cents + history.reduce((sum, row) => sum + Number(row.earned_cents), 0),
  };
  const groups = (
    group === "bidder"
      ? data.bidders
          .filter((b) => !bidderId || b.user_id === bidderId)
          .map((b) => ({
            id: b.user_id,
            label:
              data.profiles.find((p) => p.id === b.user_id)?.display_name ??
              "Bidder",
            sub: data.profiles.find((p) => p.id === b.user_id)?.email ?? "",
            rows: records.filter((r) => r.bidder_id === b.user_id),
          }))
      : data.resumes
          .filter((r) => !bidderId || r.bidder_id === bidderId)
          .map((r) => ({
            id: r.id,
            label: data.candidateProfiles.find((p) => p.id === r.profile_id)?.identifier ?? "Profile",
            sub: `${data.candidateProfiles.find((p) => p.id === r.profile_id)?.candidate_name ?? "Candidate"} · ${data.profiles.find((p) => p.id === r.bidder_id)?.display_name ?? "Bidder"}`,
            rows: records.filter((b) => b.resume_id === r.id),
          }))
  ).map((g) => {
    const retained = history.filter((row) => (group === "bidder" ? row.bidder_id : row.resume_id) === g.id);
    const summary = summarizeEarnings(g.rows);
    return {
      ...g,
      summary: {
        count: summary.count + retained.reduce((sum, row) => sum + row.record_count, 0),
        cents: summary.cents + retained.reduce((sum, row) => sum + Number(row.earned_cents), 0),
      },
    };
  });
  return (
    <>
      {!embedded && (
        <PageHeading
          eyebrow="THE VALUE OF YOUR PROGRESS"
          title="Every effort adds up."
          description="Clear earnings, based on verified application screenshots."
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
            value: new Set([
              ...records.filter((r) => r.applied).map((r) => r.resume_id),
              ...history.map((row) => row.resume_id),
            ]).size,
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
        {!groups.length ? (
          <EmptyState
            title="Progress you can put a number on"
            description="Once an application has a screenshot and is marked applied, its earnings will appear here."
          />
        ) : (
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
                      {g.summary.count}
                    </td>
                    <td className="py-4 text-right text-sm font-semibold">
                      {usd(g.summary.cents)}
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
        )}
        <p className="mt-6 rounded-lg bg-background p-3 text-[11px] leading-5 text-muted-foreground">
          Earnings use each bid’s saved rate and first application date.
          Unapplied bids are excluded; reapplying restores the original amount.
          This is an earnings record, not a payment or payout balance. Each
          workspace’s reporting timezone is used.
        </p>
        {!!history.length && <p className="mt-3 text-xs text-muted-foreground">Includes {history.reduce((sum, row) => sum + row.record_count, 0)} retained historical applications. Their individual application details have been removed.</p>}
      </section>
    </>
  );
}
