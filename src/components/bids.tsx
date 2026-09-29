"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Plus,
  Search,
  ArrowUpDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Check,
  BriefcaseBusiness,
  SlidersHorizontal,
  Clock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceData } from "@/lib/data";
import type { Row } from "@/lib/database.types";
import { usd, dateInRange, localDateTimeToISO } from "@/lib/domain";
import {
  saveBid,
  applyBid,
  unapplyBid,
  getBidHistory,
} from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import {
  PageHeading,
  Field,
  SelectField,
  SaveButton,
  EmptyState,
  FileButton,
  AppliedBadge,
} from "./common";
import { FileUpload } from "./file-upload";
type Bid = Row<"bids">;
export function BidDialog({ data, bid }: { data: WorkspaceData; bid?: Bid }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = data.resumes.filter(
    (r) =>
      (!r.archived &&
        !data.bidders.find((b) => b.user_id === r.bidder_id)?.archived) ||
      r.id === bid?.resume_id,
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={bid ? "outline" : "default"}
          size={bid ? "sm" : "default"}
          disabled={!active.length}
        >
          {!bid && <Plus size={16} />} {bid ? "Edit details" : "Add bid"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {bid ? "Keep the details up to date" : "One more opportunity."}
          </DialogTitle>
          <DialogDescription>
            {bid
              ? "Update this job’s details and availability."
              : "Save a job now. Add your application screenshot when you’re done."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          action={(form) =>
            start(async () => {
              const found = String(form.get("found_at") ?? "");
              if (found) form.set("found_at", localDateTimeToISO(found));
              const result = await saveBid(form);
              if (result.error) toast.error(result.error);
              else {
                toast.success(bid ? "Bid updated" : "Opportunity added");
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          <input type="hidden" name="id" value={bid?.id ?? ""} />
          {bid?.first_applied_at ? (
            <>
              <input type="hidden" name="resume_id" value={bid.resume_id} />
              <p className="rounded-lg bg-secondary p-3 text-xs">
                Resume:{" "}
                {data.resumes.find((r) => r.id === bid.resume_id)?.identifier} ·
                Locked after first application
              </p>
            </>
          ) : (
            <SelectField
              label="Resume profile"
              name="resume_id"
              required
              defaultValue={bid?.resume_id ?? active[0]?.id}
            >
              {active.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.identifier} · {r.candidate_name}
                </option>
              ))}
            </SelectField>
          )}
          <Field
            label="Job URL"
            name="url"
            type="url"
            required
            placeholder="https://company.com/careers/…"
            defaultValue={bid?.url}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Company name"
              name="company"
              required
              defaultValue={bid?.company}
              placeholder="Acme"
            />
            <Field
              label="Role name"
              name="role_name"
              required
              defaultValue={bid?.role_name}
              placeholder="Senior Software Engineer"
            />
            <SelectField
              label="Work arrangement"
              name="arrangement"
              defaultValue={bid?.arrangement ?? "remote"}
            >
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </SelectField>
            <SelectField
              label="Job status"
              name="job_status"
              defaultValue={bid?.job_status ?? "open"}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </SelectField>
            <Field
              label="Jobsite source"
              name="source"
              list="job-sources"
              required
              defaultValue={bid?.source}
              placeholder="LinkedIn, Indeed, company site…"
            />
            <Field
              label="Found time (your local time)"
              name="found_at"
              type="datetime-local"
              defaultValue={
                bid
                  ? new Date(
                      new Date(bid.found_at).getTime() -
                        new Date(bid.found_at).getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : undefined
              }
            />
          </div>
          <datalist id="job-sources">
            {[
              "LinkedIn",
              "Indeed",
              "Glassdoor",
              "Wellfound",
              "Company website",
              "Other",
            ].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex justify-end">
            <SaveButton
              pending={pending}
              label={bid ? "Save changes" : "Add opportunity"}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function BidWorkspace({
  data,
  embedded = false,
  bidderId,
}: {
  data: WorkspaceData;
  embedded?: boolean;
  bidderId?: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [arrangement, setArrangement] = useState("all");
  const [resume, setResume] = useState("all");
  const [bidder, setBidder] = useState(bidderId ?? "all");
  const [source, setSource] = useState("all");
  const [job, setJob] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "found_at", desc: true },
  ]);
  const [selected, setSelected] = useState<string>();
  const [history, setHistory] = useState<Row<"bid_events">[]>([]);
  const [evidence, setEvidence] = useState<string>();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = data.bids.find((b) => b.id === selected);
  const timezone = data.workspaces[0]?.timezone ?? "America/Chicago";
  const rows = useMemo(
    () =>
      data.bids.filter(
        (b) =>
          (!bidderId || b.bidder_id === bidderId) &&
          (bidder === "all" || b.bidder_id === bidder) &&
          (resume === "all" || b.resume_id === resume) &&
          (status === "all" || (status === "applied") === b.applied) &&
          (arrangement === "all" || b.arrangement === arrangement) &&
          (job === "all" || b.job_status === job) &&
          (source === "all" || b.source === source) &&
          dateInRange(
            b.found_at,
            from,
            to,
            data.workspaces.find((w) => w.id === b.workspace_id)?.timezone ??
              timezone,
          ) &&
          `${b.company} ${b.role_name} ${b.url}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [
      data,
      bidderId,
      bidder,
      resume,
      status,
      arrangement,
      job,
      source,
      from,
      to,
      timezone,
      search,
    ],
  );
  function openBid(b: Bid) {
    setSelected(b.id);
    setEvidence(undefined);
    setReason("");
    setHistory([]);
    start(async () => {
      const result = await getBidHistory(b.id);
      if (result.error) toast.error(result.error);
      else setHistory(result.data ?? []);
    });
  }
  const columns: ColumnDef<Bid>[] = [
    {
      accessorKey: "company",
      header: "Opportunity",
      cell: ({ row }) => (
        <button
          onClick={() => openBid(row.original)}
          className="flex items-center gap-3 text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-bold text-muted-foreground">
            {row.original.company.slice(0, 1)}
          </span>
          <span>
            <span className="block max-w-[220px] truncate text-xs font-semibold hover:text-primary">
              {row.original.role_name}
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {row.original.company}
            </span>
          </span>
        </button>
      ),
    },
    {
      accessorKey: "resume_id",
      header: "Resume",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-[10px] font-normal">
          {data.resumes.find((r) => r.id === row.original.resume_id)
            ?.identifier ?? "—"}
        </Badge>
      ),
    },
    {
      accessorKey: "arrangement",
      header: "Work type",
      cell: ({ getValue }) => (
        <span className="text-xs capitalize text-muted-foreground">
          {String(getValue())}
        </span>
      ),
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {String(getValue()) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "applied",
      header: "Application",
      cell: ({ row }) => <AppliedBadge applied={row.original.applied} />,
    },
    {
      accessorKey: "found_at",
      header: ({ column }) => (
        <button
          onClick={() => column.toggleSorting()}
          className="flex items-center gap-1"
        >
          Found <ArrowUpDown size={11} />
        </button>
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatInTimeZone(
            row.original.found_at,
            data.workspaces.find((w) => w.id === row.original.workspace_id)
              ?.timezone ?? timezone,
            "MMM d, yyyy",
          )}
        </span>
      ),
    },
    {
      id: "details",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`View ${row.original.role_name} at ${row.original.company}`}
          onClick={() => openBid(row.original)}
        >
          <ArrowUpRight size={15} />
        </Button>
      ),
    },
  ];
  // TanStack Table owns memoization internally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <>
      {!embedded && (
        <PageHeading
          eyebrow="EVERY OPPORTUNITY, ACCOUNTED FOR"
          title="Your bid workspace."
          description="From the first find to the final click. Keep every application in view."
        >
          <BidDialog data={data} />
        </PageHeading>
      )}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex gap-1">
            {["all", "unapplied", "applied"].map((s) => (
              <Button
                key={s}
                variant={status === s ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatus(s)}
                className="text-xs capitalize"
              >
                {s === "all" ? "All bids" : s}
                <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {
                    data.bids.filter(
                      (b) =>
                        (!bidderId || b.bidder_id === bidderId) &&
                        (s === "all" || b.applied === (s === "applied")),
                    ).length
                  }
                </span>
              </Button>
            ))}
          </div>
          {embedded && <BidDialog data={data} />}
        </div>
        <div className="flex gap-3 p-5">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-2.5 text-muted-foreground"
              size={15}
            />
            <Input
              aria-label="Search bids"
              className="max-w-sm pl-9"
              placeholder="Search company, role, or URL…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters(!filters)}
            aria-expanded={filters}
          >
            <SlidersHorizontal size={14} /> Filters
          </Button>
        </div>
        {filters && (
          <div className="grid gap-3 border-b px-5 pb-5 sm:grid-cols-3 xl:grid-cols-4">
            <SelectField
              label="Resume"
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            >
              <option value="all">All resumes</option>
              {data.resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.identifier}
                </option>
              ))}
            </SelectField>
            {data.profile.role !== "bidder" && !bidderId && (
              <SelectField
                label="Bidder"
                value={bidder}
                onChange={(e) => setBidder(e.target.value)}
              >
                <option value="all">All bidders</option>
                {data.bidders.map((b) => (
                  <option key={b.user_id} value={b.user_id}>
                    {
                      data.profiles.find((p) => p.id === b.user_id)
                        ?.display_name
                    }
                  </option>
                ))}
              </SelectField>
            )}
            <SelectField
              label="Work arrangement"
              value={arrangement}
              onChange={(e) => setArrangement(e.target.value)}
            >
              <option value="all">All arrangements</option>
              {["remote", "onsite", "hybrid"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Job status"
              value={job}
              onChange={(e) => setJob(e.target.value)}
            >
              <option value="all">All jobs</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </SelectField>
            <SelectField
              label="Jobsite source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="all">All sources</option>
              {[...new Set(data.bids.map((b) => b.source))]
                .filter(Boolean)
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </SelectField>
            <Field
              label="Found from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Field
              label="Found through"
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
            <Button
              variant="ghost"
              className="self-end"
              onClick={() => {
                setResume("all");
                setBidder(bidderId ?? "all");
                setArrangement("all");
                setJob("all");
                setSource("all");
                setFrom("");
                setTo("");
                setSearch("");
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {!rows.length ? (
          <EmptyState
            title={
              data.bids.length
                ? "No matching opportunities"
                : "Your next opportunity starts here"
            }
            description={
              data.bids.length
                ? "Try a different search or clear your filters."
                : "Add a job URL and choose a resume to start tracking. Each small step brings you closer."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-y bg-background/70">
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => (
                        <th
                          key={header.id}
                          className="whitespace-nowrap px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y">
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-background/60">
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="whitespace-nowrap px-5 py-4"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t px-5 py-4 text-xs text-muted-foreground">
              <span>
                {table.getState().pagination.pageIndex * 10 + 1}–
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * 10,
                  rows.length,
                )}{" "}
                of {rows.length} bids
              </span>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Previous page"
                  size="icon-sm"
                  variant="outline"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                >
                  <ChevronLeft size={14} />
                </Button>
                <span className="px-2">
                  {table.getState().pagination.pageIndex + 1}
                </span>
                <Button
                  aria-label="Next page"
                  size="icon-sm"
                  variant="outline"
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <Sheet
        open={!!active}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
          {active && (
            <>
              <SheetHeader className="p-0">
                <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BriefcaseBusiness size={24} />
                </span>
                <SheetTitle className="text-xl">{active.role_name}</SheetTitle>
                <SheetDescription>
                  {active.company} · {active.arrangement}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="flex items-center justify-between">
                  <AppliedBadge applied={active.applied} />
                  <BidDialog data={data} bid={active} />
                </div>
                <a
                  href={active.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm font-medium text-primary"
                >
                  Open job listing <ArrowUpRight size={14} />
                </a>
                <div className="grid grid-cols-2 gap-5 rounded-xl bg-background p-4">
                  {[
                    {
                      label: "Resume",
                      value: data.resumes.find((r) => r.id === active.resume_id)
                        ?.identifier,
                    },
                    { label: "Source", value: active.source },
                    { label: "Job status", value: active.job_status },
                    {
                      label: "Saved rate",
                      value:
                        active.rate_cents === null
                          ? "Set on application"
                          : usd(active.rate_cents),
                    },
                    {
                      label: "Found",
                      value: formatInTimeZone(
                        active.found_at,
                        timezone,
                        "MMM d, h:mm a",
                      ),
                    },
                    {
                      label: "Applied",
                      value: active.applied_at
                        ? formatInTimeZone(
                            active.applied_at,
                            timezone,
                            "MMM d, h:mm a",
                          )
                        : "Not yet",
                    },
                  ].map((x) => (
                    <div key={x.label}>
                      <p className="eyebrow mb-1.5">{x.label}</p>
                      <p className="text-xs capitalize">{x.value || "—"}</p>
                    </div>
                  ))}
                </div>
                {active.evidence_file_id && (
                  <FileButton
                    id={active.evidence_file_id}
                    label="View application screenshot"
                  />
                )}
                {active.applied ? (
                  data.profile.role !== "bidder" ? (
                    <div className="space-y-3 border-t pt-5">
                      <h3 className="text-sm font-semibold">
                        Correct application status
                      </h3>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Marking this unapplied removes its earnings. New proof
                        is required before it can be applied again.
                      </p>
                      <Textarea
                        aria-label="Correction reason"
                        placeholder="Why is this application being corrected?"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={pending || !reason.trim()}
                        onClick={() =>
                          start(async () => {
                            const result = await unapplyBid(active.id, reason);
                            if (result.error) toast.error(result.error);
                            else {
                              toast.success("Marked unapplied");
                              setSelected(undefined);
                              router.refresh();
                            }
                          })
                        }
                      >
                        <RotateCcw size={14} /> Mark unapplied
                      </Button>
                    </div>
                  ) : null
                ) : (
                  <div className="space-y-4 border-t pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Application proof
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Upload your confirmation screenshot to record the
                        application and its earnings.
                      </p>
                    </div>
                    <FileUpload
                      kind="screenshot"
                      target={active.id}
                      onUploaded={setEvidence}
                    />
                    {evidence && (
                      <p className="flex items-center gap-2 text-xs text-emerald-600">
                        <Check size={14} /> Screenshot verified and ready
                      </p>
                    )}
                    <Button
                      className="w-full"
                      disabled={!evidence || pending}
                      onClick={() =>
                        start(async () => {
                          const result = await applyBid(active.id, evidence!);
                          if (result.error) toast.error(result.error);
                          else {
                            toast.success("Application recorded");
                            setSelected(undefined);
                            router.refresh();
                          }
                        })
                      }
                    >
                      <Check size={15} /> Mark as applied
                    </Button>
                  </div>
                )}
                <div className="border-t pt-5">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                    <Clock size={15} /> Activity history
                  </h3>
                  {!history.length ? (
                    <p className="text-xs text-muted-foreground">
                      No application changes yet.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {history.map((e) => (
                        <div
                          key={e.id}
                          className="border-l-2 border-primary/20 pl-3"
                        >
                          <p className="text-xs font-medium capitalize">
                            Marked {e.event}
                          </p>
                          {e.reason && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {e.reason}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {formatInTimeZone(
                              e.created_at,
                              timezone,
                              "MMM d, yyyy · h:mm a",
                            )}
                          </p>
                          {e.file_id && (
                            <div className="mt-2">
                              <FileButton id={e.file_id} label="Evidence" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
