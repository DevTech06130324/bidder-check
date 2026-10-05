"use client";
import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { WorkspaceData } from "@/lib/data";
import { PageHeading } from "./common";
import { SelectField } from "./common";
import { BID_TIMEZONE } from "@/lib/domain";
export function InterviewReport({ data }: { data: WorkspaceData }) {
  const today = formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd");
  const initial = new Date(`${today}T12:00:00Z`); initial.setUTCDate(initial.getUTCDate()-29);
  const [period,setPeriod]=useState("30"); const [from,setFrom]=useState(initial.toISOString().slice(0,10)); const [to,setTo]=useState(today); const [group,setGroup]=useState("profile");
  const rows=useMemo(()=>{
    const inRange=(day:string)=>period==="all"||(day>=from&&day<=to);
    const map=new Map<string,{label:string;applied:number;interviews:number}>();
    for(const bid of data.bids){if(!bid.applied||!bid.first_applied_at||bid.deleted_at)continue;const day=formatInTimeZone(bid.first_applied_at,BID_TIMEZONE,"yyyy-MM-dd");if(!inRange(day))continue;
      const resume=data.resumes.find(r=>r.id===bid.resume_id);const profile=data.candidateProfiles.find(p=>p.id===resume?.profile_id);const bidder=data.profiles.find(p=>p.id===bid.bidder_id);
      const keys=group==="profile"?[[profile?.id??"unknown",profile?.identifier??"Unknown profile"]]:group==="bidder"?[[bid.bidder_id,bidder?.display_name??"Bidder"]]:[[`${profile?.id??"unknown"}:${bid.bidder_id}`,`${profile?.identifier??"Unknown profile"} · ${bidder?.display_name??"Bidder"}`]];
      const [key,label]=keys[0] as [string,string];const entry=map.get(key)??{label,applied:0,interviews:0};entry.applied++;if(bid.interview_scheduled)entry.interviews++;map.set(key,entry);
    }
    for(const aggregate of data.historicalAggregates){if(aggregate.metric!=="earning"||!inRange(aggregate.report_day)||Number(aggregate.tracked_count)===0)continue;const profile=data.candidateProfiles.find(p=>p.id===aggregate.profile_id);const bidder=data.profiles.find(p=>p.id===aggregate.bidder_id);const key=group==="profile"?aggregate.profile_id:group==="bidder"?aggregate.bidder_id:`${aggregate.profile_id}:${aggregate.bidder_id}`;const label=group==="profile"?profile?.identifier??"Retained profile":group==="bidder"?bidder?.display_name??"Retained bidder":`${profile?.identifier??"Profile"} · ${bidder?.display_name??"Bidder"}`;const entry=map.get(key)??{label,applied:0,interviews:0};entry.applied+=Number(aggregate.tracked_count);entry.interviews+=Number(aggregate.interview_count);map.set(key,entry);}
    return [...map.values()].sort((a,b)=>b.applied-a.applied);
  },[data,period,from,to,group]);
  const excluded=data.historicalAggregates.filter(a=>a.metric==="earning"&&(period==="all"||(a.report_day>=from&&a.report_day<=to))).reduce((sum,a)=>sum+Math.max(0,Number(a.record_count)-Number(a.tracked_count)),0);
  const totals=rows.reduce((all,r)=>({applied:all.applied+r.applied,interviews:all.interviews+r.interviews}),{applied:0,interviews:0});
  return <>
    <PageHeading eyebrow="CONVERSION OUTCOMES" title="Interview performance" description="Applications with an interview invitation divided by applied applications, grouped by profile, bidder, or their assignment." />
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <SelectField label="Cohort period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="30">Last 30 CT days</option><option value="all">All dates</option><option value="custom">Custom range</option></SelectField>
      {period==="custom"&&<><label className="space-y-1 text-xs">From (CT)<input className="native-select" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="space-y-1 text-xs">Through (CT)<input className="native-select" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}
      <SelectField label="Group by" value={group} onChange={e=>setGroup(e.target.value)}><option value="profile">Candidate profile</option><option value="bidder">Bidder</option><option value="assignment">Profile · bidder assignment</option></SelectField>
    </div>
    <div className="mb-5 grid gap-4 sm:grid-cols-3"><div className="panel p-5"><p className="text-xs text-muted-foreground">Applied applications</p><strong className="mt-2 block text-2xl">{totals.applied.toLocaleString()}</strong></div><div className="panel p-5"><p className="text-xs text-muted-foreground">Interview invitations</p><strong className="mt-2 block text-2xl">{totals.interviews.toLocaleString()}</strong></div><div className="panel p-5"><p className="text-xs text-muted-foreground">Interview conversion</p><strong className="mt-2 block text-2xl">{totals.applied?`${Math.round(totals.interviews/totals.applied*100)}%`:"—"}</strong></div></div>
    {excluded>0&&<p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{excluded.toLocaleString()} retained historical applications have no recoverable interview status and are excluded from this ratio.</p>}
    <div className="panel overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-4">{group==="profile"?"Candidate profile":group==="bidder"?"Bidder":"Profile · bidder"}</th><th className="p-4">Applied applications</th><th className="p-4">Interview invitations</th><th className="p-4">Conversion</th></tr></thead><tbody>{rows.map(row=><tr key={row.label} className="border-b last:border-0"><td className="p-4 font-medium">{row.label}</td><td className="p-4">{row.applied}</td><td className="p-4">{row.interviews}</td><td className="p-4">{row.applied?`${Math.round(row.interviews/row.applied*100)}%`:"—"}</td></tr>)}{!rows.length&&<tr><td colSpan={4} className="p-10 text-center text-muted-foreground">No applied applications in this cohort.</td></tr>}</tbody></table></div>
  </>;
}
