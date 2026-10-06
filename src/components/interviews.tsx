"use client";
import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeading } from "./common";
import { SelectField } from "./common";
import { BID_TIMEZONE } from "@/lib/domain";
import { getEarningsPerformance, type EarningsReport } from "@/app/(workspace)/actions";
export function InterviewReport() {
  const today = formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd");
  const initial = new Date(`${today}T12:00:00Z`); initial.setUTCDate(initial.getUTCDate()-29);
  const [period,setPeriod]=useState("30"); const [from,setFrom]=useState(initial.toISOString().slice(0,10)); const [to,setTo]=useState(today); const [group,setGroup]=useState("profile");
  const [report,setReport]=useState<EarningsReport|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const [refresh,setRefresh]=useState(0);
  useEffect(()=>{let current=true;void getEarningsPerformance({from:period==="all"?undefined:from,to:period==="all"?undefined:to,group:group as "profile"|"bidder"|"assignment"}).then(result=>{if(!current)return;if(result.error||!result.data)setError(result.error??"Interview report is unavailable.");else{setReport(result.data);setError("");}setLoading(false);});return()=>{current=false;};},[period,from,to,group,refresh]);
  const rows=report?.groups??[]; const excluded=report?.totals.excludedInterviewCount??0;
  const totals={applied:report?.totals.trackedApplications??0,interviews:report?.totals.trackedInterviews??0};
  return <>
    <PageHeading eyebrow="CONVERSION OUTCOMES" title="Interview performance" description="Applications with an interview invitation divided by applied applications, grouped by profile, bidder, or their assignment." />
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <SelectField label="Cohort period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="30">Last 30 CT days</option><option value="all">All dates</option><option value="custom">Custom range</option></SelectField>
      {period==="custom"&&<><label className="space-y-1 text-xs">From (CT)<input className="native-select" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="space-y-1 text-xs">Through (CT)<input className="native-select" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}
      <SelectField label="Group by" value={group} onChange={e=>setGroup(e.target.value)}><option value="profile">Candidate profile</option><option value="bidder">Bidder</option><option value="assignment">Profile · bidder assignment</option></SelectField>
    </div>
    <div className="mb-5 grid gap-4 sm:grid-cols-3"><div className="panel p-5"><p className="text-xs text-muted-foreground">Applied applications</p><strong className="mt-2 block text-2xl">{totals.applied.toLocaleString()}</strong></div><div className="panel p-5"><p className="text-xs text-muted-foreground">Interview invitations</p><strong className="mt-2 block text-2xl">{totals.interviews.toLocaleString()}</strong></div><div className="panel p-5"><p className="text-xs text-muted-foreground">Interview conversion</p><strong className="mt-2 block text-2xl">{totals.applied?`${Math.round(totals.interviews/totals.applied*100)}%`:"—"}</strong></div></div>
    {excluded>0&&<p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{excluded.toLocaleString()} retained historical applications have no recoverable interview status and are excluded from this ratio.</p>}
    {error&&<p role="alert" className="mb-4 text-sm text-destructive">{error} <button className="underline" onClick={()=>{setLoading(true);setRefresh(n=>n+1);}}>Retry</button></p>}
    <div className="panel overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-4">{group==="profile"?"Candidate profile":group==="bidder"?"Bidder":"Profile · bidder"}</th><th className="p-4">Applied applications</th><th className="p-4">Interview invitations</th><th className="p-4">Conversion</th></tr></thead><tbody>{loading?<tr><td colSpan={4} className="p-10 text-center text-muted-foreground">Loading interview report…</td></tr>:rows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="p-4 font-medium">{row.label}</td><td className="p-4">{row.applied}</td><td className="p-4">{row.interviews}</td><td className="p-4">{row.applied?`${Math.round(row.interviews/row.applied*100)}%`:"—"}</td></tr>)}{!loading&&!rows.length&&<tr><td colSpan={4} className="p-10 text-center text-muted-foreground">No applied applications in this cohort.</td></tr>}</tbody></table></div>
  </>;
}
