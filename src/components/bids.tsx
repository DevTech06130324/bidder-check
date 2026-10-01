"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  ColumnDef,
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
  BriefcaseBusiness,
  SlidersHorizontal,
  Clock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceData } from "@/lib/data";
import type { Row } from "@/lib/database.types";
import { usd, dateInRange, BID_TIMEZONE } from "@/lib/domain";
import {
  saveBid,
  trashBid,
  getBidRows,
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
import { ScreenshotCell } from "./screenshot-cell";
import { FileUpload } from "./file-upload";
import { BulkBidToolbar } from "./bulk-bid-toolbar";
import { BidGrid } from "./bid-grid";
import { SheetsImport, type ImportResult } from "./sheets-import";
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
  const [checked, setChecked] = useState<Record<string, number>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const editing = useRef(false);
  const deferredRefresh = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  function editingChanged(value: boolean) {
    editing.current = value;
    setIsEditing(value);
    if (!value)
      setToday(formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd"));
    if (!value && deferredRefresh.current) {
      deferredRefresh.current = false;
      setRevision((n) => n + 1);
    }
  }
  function imported(result: ImportResult) {
    setPaste(null);
    setSearch("");
    setStatus("all");
    setArrangement("all");
    setSource("all");
    setJob("all");
    setTrash(false);
    setBidder(result.bidder);
    setResume(result.resume);
    setDateMode("custom");
    setFrom(result.date);
    setTo(result.date);
    setFilters(true);
    setRevision((n) => n + 1);
    router.refresh();
  }
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
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const [dateMode, setDateMode] = useState("today");
  const [trash, setTrash] = useState(false);
  const [today, setToday] = useState(() =>
    formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd"),
  );
  const [list, setList] = useState(data.bids);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => {
      if (editing.current) {
        deferredRefresh.current = true;
        return;
      }
      setToday(formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd"));
    };
    const focus = () => {
      if (editing.current) {
        deferredRefresh.current = true;
        return;
      }
      update();
      setRevision((n) => n + 1);
    };
    const timer = setInterval(update, 15000);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (editing.current) {
        deferredRefresh.current = true;
        return;
      }
      setLoading(true);
      const result = await getBidRows(
        dateMode,
        from,
        to,
        trash,
        bidderId,
      ).catch(() => ({
        error: "Could not refresh bids. Your previous results are still shown.",
        data: undefined,
      }));
      if (cancelled) return;
      if (editing.current) {
        deferredRefresh.current = true;
        setLoading(false);
        return;
      }
      setLoading(false);
      if (result.error) {
        setLoadError(result.error);
      } else {
        setLoadError("");
        setList(result.data ?? []);
        const eligible = new Set((result.data ?? []).map((row) => row.id));
        setChecked((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => eligible.has(id)),
          ),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [data, dateMode, from, to, trash, bidderId, today, revision]);
  const active = list.find((b) => b.id === selected);
  const timezone = BID_TIMEZONE;
  const previousDay = new Date(`${today}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = previousDay.toISOString().slice(0, 10);
  const rows = useMemo(
    () =>
      list.filter(
        (b) =>
          (!bidderId || b.bidder_id === bidderId) &&
          (bidder === "all" || b.bidder_id === bidder) &&
          (resume === "all" || b.resume_id === resume) &&
          (arrangement === "all" || b.arrangement === arrangement) &&
          (job === "all" || b.job_status === job) &&
          (source === "all" || b.source === source) &&
          Boolean(b.deleted_at) === trash &&
          dateInRange(
            b.found_at,
            dateMode === "today"
              ? today
              : dateMode === "yesterday"
                ? yesterday
                : dateMode === "custom"
                  ? from
                  : "",
            dateMode === "today"
              ? today
              : dateMode === "yesterday"
                ? yesterday
                : dateMode === "custom"
                  ? to
                  : "",
            timezone,
          ) &&
          `${b.company} ${b.role_name} ${b.url}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [
      list,
      trash,
      dateMode,
      today,
      yesterday,
      bidderId,
      bidder,
      resume,
      arrangement,
      job,
      source,
      from,
      to,
      timezone,
      search,
    ],
  );
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (b) => status === "all" || b.applied === (status === "applied"),
      ),
    [rows, status],
  );
  function openBid(b: Bid) {
    setSelected(b.id);
    setReason("");
    setHistory([]);
    start(async () => {
      const result = await getBidHistory(b.id);
      if (result.error) toast.error(result.error);
      else setHistory(result.data ?? []);
    });
  }
  async function toggleTrash(b: Bid) {
    const result = await trashBid(b.id, !b.deleted_at);
    if (result.error) toast.error(result.error);
    else {
      toast.success(b.deleted_at ? "Bid restored" : "Bid moved to trash");
      setSelected(undefined);
      setRevision((n) => n + 1);
      router.refresh();
    }
  }
  const ct = (stamp: string | null) =>
    stamp
      ? formatInTimeZone(stamp, BID_TIMEZONE, "MMM d, yyyy h:mm a") + " CT"
      : "-";
  const columns: ColumnDef<Bid>[] = [
    {
      accessorKey: "found_at",
      header: ({ column }) => (
        <button
          disabled={isEditing}
          onClick={() => column.toggleSorting()}
          className="flex items-center gap-1"
        >
          Added date (CT)
          <ArrowUpDown size={11} />
        </button>
      ),
      cell: ({ row }) => (
        <span className="text-xs">{ct(row.original.found_at)}</span>
      ),
    },
    {
      accessorKey: "resume_id",
      header: "Resume ID",
      cell: ({ row }) => (
        <Badge variant="outline">
          {data.resumes.find((r) => r.id === row.original.resume_id)
            ?.identifier ?? "-"}
        </Badge>
      ),
    },
    {
      accessorKey: "company",
      header: "Company name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.company}</span>
      ),
    },
    { accessorKey: "role_name", header: "Role" },
    {
      accessorKey: "url",
      header: "Link",
      cell: ({ row }) => (
        <a
          className="text-primary underline"
          href={row.original.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open job at ${row.original.company}`}
        >
          Open job
        </a>
      ),
    },
    {
      accessorKey: "bidder_id",
      header: "Bidder ID",
      cell: ({ row }) => (
        <button
          className="text-left text-xs"
          title={row.original.bidder_id}
          aria-label={`Copy bidder account ID ${row.original.bidder_id}`}
          onClick={() =>
            void navigator.clipboard.writeText(row.original.bidder_id).then(
              () => toast.success("Account ID copied"),
              () => toast.error("Could not copy account ID"),
            )
          }
        >
          {data.profiles.find((p) => p.id === row.original.bidder_id)
            ?.display_name ?? "Bidder"}
          <span className="block font-mono text-[10px] text-muted-foreground">
            {row.original.bidder_id.slice(0, 8)}... Copy ID
          </span>
        </button>
      ),
    },
    { accessorKey: "source", header: "Job site" },
    {
      accessorKey: "applied",
      header: "Applied status",
      cell: ({ row }) => <AppliedBadge applied={row.original.applied} />,
    },
    {
      accessorKey: "applied_at",
      header: "Applied time (CT)",
      cell: ({ row }) => (
        <span className="text-xs">{ct(row.original.applied_at)}</span>
      ),
    },
    {
      accessorKey: "arrangement",
      header: "Work arrangement",
      cell: ({ getValue }) => (
        <span className="capitalize">{String(getValue())}</span>
      ),
    },
    { accessorKey: "job_status", header: "Job status" },
    {
      id: "screenshot",
      header: "Screenshot",
      cell: ({ row }) => (
        <ScreenshotCell
          bid={row.original}
          disabled={isEditing || pending}
          onBusy={(value) => {
            setUploadBusy(value);
            editingChanged(value);
          }}
        />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || isEditing}
            onClick={() => start(() => toggleTrash(row.original))}
          >
            {row.original.deleted_at ? "Restore" : "Move to trash"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`View ${row.original.role_name} at ${row.original.company}`}
            onClick={() => openBid(row.original)}
          >
            History & details
          </Button>
        </div>
      ),
    },
  ];
  // TanStack Table owns memoization internally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredRows,
    getRowId: (row) => row.id,
    autoResetPageIndex: false,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  const filterKey = JSON.stringify([
    search,
    status,
    arrangement,
    resume,
    bidder,
    source,
    job,
    dateMode,
    from,
    to,
    trash,
    sorting,
    dateMode === "today" || dateMode === "yesterday" ? today : "",
  ]);
  useEffect(() => {
    setChecked({});
    table.setPageIndex(0);
  }, [filterKey, table]);
  useEffect(() => {
    const max = Math.max(
      0,
      Math.ceil(filteredRows.length / table.getState().pagination.pageSize) - 1,
    );
    if (table.getState().pagination.pageIndex > max) table.setPageIndex(max);
  }, [filteredRows.length, table]);
  return (
    <>
      {paste !== null && (
        <SheetsImport
          data={data}
          initialText={paste}
          bidderId={bidderId}
          onClose={() => setPaste(null)}
          onSuccess={imported}
        />
      )}
      {!embedded && (
        <PageHeading
          eyebrow="EVERY OPPORTUNITY, ACCOUNTED FOR"
          title="Your bid workspace."
          description="From the first find to the final click. Keep every application in view."
        >
          <Button variant="outline" onClick={() => setPaste("")}>
            Paste from Sheets
          </Button>
          <BidDialog data={data} />
        </PageHeading>
      )}
      <section className="panel overflow-hidden">
        <fieldset disabled={isEditing} className="min-w-0">
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
                      rows.filter(
                        (b) => s === "all" || b.applied === (s === "applied"),
                      ).length
                    }
                  </span>
                </Button>
              ))}
            </div>
            {embedded && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPaste("")}>
                  Paste from Sheets
                </Button>
                <BidDialog data={data} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
            {[
              ["today", "Today (CT)"],
              ["yesterday", "Yesterday (CT)"],
              ["all", "All dates"],
              ["custom", "Custom range"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={dateMode === value ? "secondary" : "ghost"}
                aria-pressed={dateMode === value}
                onClick={() => setDateMode(value)}
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              className="ml-auto"
              variant={trash ? "secondary" : "outline"}
              aria-pressed={trash}
              onClick={() => setTrash(!trash)}
            >
              {trash ? "Back to active bids" : "Trash"}
            </Button>
            {dateMode === "custom" && (
              <div className="flex flex-wrap gap-3">
                <Field
                  label="Found from (CT)"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <Field
                  label="Found through (CT)"
                  type="date"
                  min={from}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            )}
          </div>
          {loadError && (
            <p role="alert" className="px-5 pt-3 text-sm text-destructive">
              {loadError}{" "}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevision((n) => n + 1)}
              >
                Retry
              </Button>
            </p>
          )}
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
        </fieldset>
        <BulkBidToolbar
          targets={Object.entries(checked).map(([id, version]) => ({
            id,
            version,
          }))}
          trash={trash}
          manager={data.profile.role !== "bidder"}
          bidderId={bidderId}
          disabled={isEditing || pending}
          loading={loading}
          clear={() => setChecked({})}
          onBusy={(value) => {
            setBulkBusy(value);
            editingChanged(value);
          }}
          onDone={() => {
            setChecked({});
            setSelected(undefined);
            setRevision((n) => n + 1);
            router.refresh();
          }}
        />
        {!filteredRows.length ? (
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
            <BidGrid
              key={JSON.stringify([
                table.getState().pagination.pageIndex,
                table
                  .getRowModel()
                  .rows.map((row) => row.original.id)
                  .join(","),
                dateMode === "today" || dateMode === "yesterday" ? today : "",
                sorting,
                search,
                status,
                arrangement,
                resume,
                bidder,
                source,
                job,
                dateMode,
                from,
                to,
                trash,
              ])}
              checked={checked}
              disabled={pending || bulkBusy || uploadBusy}
              onCheck={(rows, value) =>
                setChecked((current) => {
                  const next = { ...current };
                  rows.forEach((row) => {
                    if (value) next[row.id] = row.version;
                    else delete next[row.id];
                  });
                  if (Object.keys(next).length > 500) {
                    toast.error("Select at most 500 bids per operation");
                    return current;
                  }
                  return next;
                })
              }
              table={table}
              data={data}
              onRow={(row) =>
                setList((current) =>
                  current.map((b) => (b.id === row.id ? row : b)),
                )
              }
              onBusy={editingChanged}
              onPaste={setPaste}
              onOpen={openBid}
            />
            <div className="flex items-center justify-between border-t px-5 py-4 text-xs text-muted-foreground">
              <span>
                {table.getState().pagination.pageIndex * 10 + 1}–
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * 10,
                  filteredRows.length,
                )}{" "}
                of {filteredRows.length} bids
              </span>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Previous page"
                  size="icon-sm"
                  variant="outline"
                  disabled={isEditing || !table.getCanPreviousPage()}
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
                  disabled={isEditing || !table.getCanNextPage()}
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
                  {!active.deleted_at && <BidDialog data={data} bid={active} />}
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
                {!active.deleted_at && (
                  <div className="space-y-4 border-t pt-5">
                    <h3 className="text-sm font-semibold">
                      {active.applied
                        ? "Replace screenshot"
                        : active.evidence_file_id
                          ? "Upload new proof"
                          : "Application proof"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Upload automatically records the application
                    </p>
                    <FileUpload
                      kind="screenshot"
                      target={active.id}
                      onUploaded={() => {
                        setSelected(undefined);
                        setRevision((n) => n + 1);
                        router.refresh();
                      }}
                    />
                  </div>
                )}
                {active.applied &&
                  !active.deleted_at &&
                  data.profile.role !== "bidder" && (
                    <div className="space-y-3 border-t pt-5">
                      <h3 className="text-sm font-semibold">
                        Correct application status
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        This removes earnings until new proof is submitted.
                      </p>
                      <Textarea
                        aria-label="Correction reason"
                        placeholder="Reason for correction"
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
                              setRevision((n) => n + 1);
                              router.refresh();
                            }
                          })
                        }
                      >
                        <RotateCcw size={14} /> Mark unapplied
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
