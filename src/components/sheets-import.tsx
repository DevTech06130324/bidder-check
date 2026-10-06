"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { WorkspaceData } from "@/lib/data";
import { BID_TIMEZONE } from "@/lib/domain";
import {
  parseSheet,
  mapSheet,
  validateImportRows,
  importFields,
  fieldLabels,
  type ImportField,
  type ImportRow,
  type ImportError,
} from "@/lib/sheets";
import { checkBidImport, importReviewedBids } from "@/app/(workspace)/actions";
import { classifyImportRows, type SkippedImportRow } from "@/lib/import-workflow";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, SelectField } from "./common";
import { toast } from "sonner";
export type ImportResult = { date: string; bidder: string; resume: string; importedCount: number; skipped: SkippedImportRow[] };
export function SheetsImport({
  data,
  initialText,
  bidderId,
  onClose,
  onSuccess,
}: {
  data: WorkspaceData;
  initialText: string;
  bidderId?: string;
  onClose: () => void;
  onSuccess: (result: ImportResult) => void;
}) {
  const [text, setText] = useState(initialText);
  const [workspace, setWorkspace] = useState(
    data.bidders.find((b) => b.user_id === bidderId)?.workspace_id ??
      data.workspaces[0]?.id ??
      "",
  );
  const [bidder, setBidder] = useState(
    bidderId ?? (data.profile.role === "bidder" ? data.profile.id : ""),
  );
  const [resume, setResume] = useState(""),
    [date, setDate] = useState(() =>
      formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd"),
    );
  const [defaults, setDefaults] = useState<Partial<ImportRow>>({
    arrangement: "remote",
    job_status: "open",
  });
  const [mapping, setMapping] = useState<(ImportField | "ignore")[]>([]),
    [source, setSource] = useState<string[][]>([]);
  const [rows, setRows] = useState<ImportRow[] | null>(null),
    [serverErrors, setServerErrors] = useState<ImportError[]>([]);
  const [sourceRows, setSourceRows] = useState<number[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false);
  const request = useRef(crypto.randomUUID());
  const frozen = useRef<{ resume: string; date: string; rows: ImportRow[]; sourceRows: number[]; requestId: string; skipped: SkippedImportRow[] } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const localErrors = useMemo(
    () => rows ? validateImportRows(rows).map((entry) => ({ ...entry, row: sourceRows[entry.row - 1] ?? entry.row })) : [],
    [rows, sourceRows],
  );
  const bidders = data.bidders.filter(
    (b) =>
      !b.archived &&
      (data.profile.role !== "admin" || b.workspace_id === workspace) &&
      (!bidderId || b.user_id === bidderId),
  );
  const resumes = data.resumes.filter(
    (r) => !r.archived && r.file_id && r.bidder_id === bidder,
  );
  useEffect(() => {
    if (!rows || !rows.length || !resume || !date) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const result = await checkBidImport(resume, date, rows);
        if (!cancelled) {
          setServerErrors((result.data ?? []).map((entry) => ({
            ...entry,
            row: sourceRows[entry.row - 1] ?? entry.row,
          })));
          setError(result.error ?? "");
        }
      } catch {
        if (!cancelled)
          setError(
            "Could not validate. Retry validation or check your connection.",
          );
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rows, resume, date, sourceRows]);
  function parse() {
    try {
      const parsed = parseSheet(text);
      const values = parsed;
      if (!values.length) throw new Error("Paste at least one data row.");
      setSource(parsed);
      setMapping(
        Array.from(
          { length: Math.max(...parsed.map((r) => r.length)) },
          (_, i) => importFields[i] ?? "ignore",
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function preview() {
    try {
      if (!resume || !date)
        throw new Error("Choose a bidder, resume and Added date.");
      if (!mapping.includes("url"))
        throw new Error("Map one column to Job URL.");
      const mapped = mapSheet(source, mapping, defaults);
      if (mapped.length > 500) throw new Error("Import at most 500 rows.");
      setRows(mapped);
      setSourceRows(mapped.map((_, index) => index + 1));
      setServerErrors([]);
      setChecking(true);
      setError("");
      request.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function changeRows(next: ImportRow[], nextSourceRows = sourceRows) {
    setAttempted(false);
    setRows(next);
    setSourceRows(nextSourceRows);
    setServerErrors([]);
    setChecking(next.length > 0);
    setError("");
    request.current = crypto.randomUUID();
  }
  async function submit() {
    if (!rows || busy) return;
    let payload = frozen.current;
    const reviewedSourceRows = displayed?.allowedSourceRows ?? [];
    let preSkipped: SkippedImportRow[] = [];
    let importSent = false;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      if (!payload) {
        if (!bidder || !resume || !date) throw new Error("Choose a bidder, resume, and Added date before importing.");
        if (!rows.length) throw new Error("Add at least one bid row to import.");
        const checked = await checkBidImport(resume, date, rows);
        if (checked.error) throw new Error(checked.error);
        const freshErrors = (checked.data ?? []).map((entry) => ({ ...entry, row: sourceRows[entry.row - 1] ?? entry.row }));
        const fresh = classifyImportRows(rows, sourceRows, [...localErrors, ...freshErrors]);
        preSkipped = fresh.skipped;
        const selected = new Set(reviewedSourceRows);
        const allowedIndexes = rows.map((_, index) => index).filter((index) => {
          const rowNumber = sourceRows[index] ?? index + 1;
          return selected.has(rowNumber) && !fresh.skipped.some((entry) => entry.sourceRow === rowNumber);
        });
        const allowed = allowedIndexes.map((index) => rows[index]);
        if (!allowed.length) {
          setServerErrors(freshErrors);
          setError("No rows are allowed to import after rechecking. Review the updated reasons and correct or remove blocked rows.");
          return;
        }
        payload = { resume, date, rows: allowed, sourceRows: allowedIndexes.map((index) => sourceRows[index] ?? index + 1), requestId: request.current, skipped: preSkipped };
      }
      if (payload.skipped.length) preSkipped = payload.skipped;
      importSent = true;
      const result = await importReviewedBids(payload.resume, payload.date, payload.rows, payload.sourceRows, payload.requestId);
      if (result.error) {
        frozen.current = result.uncertain ? payload : null;
        setUncertain(!!result.uncertain);
        setError(result.uncertain ? "Connection interrupted. Retry keeps the same request and will not duplicate bids." : result.error);
      }
      else if (result.data?.ids) {
        const backendSkipped = (result.data.skipped ?? []) as unknown as { sourceRow: number; reasons: ImportError[] }[];
        if (!result.data.ids.length) {
          setServerErrors(backendSkipped.flatMap((entry) => entry.reasons));
          setError("No rows are allowed to import after rechecking. Review the updated reasons and correct or remove blocked rows.");
          setAttempted(false);
          return;
        }
        frozen.current = null;
        setUncertain(false);
        const skippedByRow = new Map(preSkipped.map((entry) => [entry.sourceRow, entry]));
        backendSkipped.flatMap((entry) => {
          const index = payload!.sourceRows.indexOf(entry.sourceRow);
          return index < 0 ? [] : [[entry.sourceRow, { sourceRow: entry.sourceRow, row: payload!.rows[index], reasons: entry.reasons }] as const];
        }).forEach(([sourceRow, entry]) => skippedByRow.set(sourceRow, entry));
        const skipped = [
          ...skippedByRow.values(),
        ].sort((a, b) => a.sourceRow - b.sourceRow);
        toast.success(`${result.data.ids.length} ${result.data.ids.length === 1 ? "bid" : "bids"} imported${skipped.length ? `; ${skipped.length} ${skipped.length === 1 ? "row" : "rows"} skipped` : ""}`);
        onSuccess({ ...result.data, importedCount: result.data.ids.length, skipped });
      }
    } catch (e) {
      if (importSent && payload) {
        // Keep the exact payload and request ID after a response is lost.
        frozen.current = payload;
        setUncertain(true);
      }
      setError(importSent ? "Connection interrupted. Retry keeps the same request and will not duplicate bids." : e instanceof Error ? e.message : "Could not validate this import. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const serverIssueFields = new Set(serverErrors.map((entry) => `${entry.row}:${entry.field}`));
  const errors = [
    ...localErrors.filter((entry) => !serverIssueFields.has(`${entry.row}:${entry.field}`)),
    ...serverErrors,
  ];
  const displayed = rows ? classifyImportRows(rows, sourceRows, errors) : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !uncertain) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Paste new bids from Sheets</DialogTitle>
          <DialogDescription>
            Create new bids only. One bidder, resume and Added date apply to
            this batch. Existing rows are never overwritten.
          </DialogDescription>
        </DialogHeader>
        {!rows ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {data.profile.role === "admin" && (
                <SelectField
                  label="Client workspace"
                  disabled={!!bidderId}
                  value={workspace}
                  onChange={(e) => {
                    setWorkspace(e.target.value);
                    setBidder("");
                    setResume("");
                  }}
                >
                  {data.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </SelectField>
              )}
              <SelectField
                label="Import bidder"
                value={bidder}
                disabled={data.profile.role === "bidder" || !!bidderId}
                onChange={(e) => {
                  setBidder(e.target.value);
                  setResume("");
                }}
              >
                <option value="">Choose bidder</option>
                {bidders.map((b) => (
                  <option key={b.user_id} value={b.user_id}>
                    {data.profiles.find((p) => p.id === b.user_id)
                      ?.display_name ?? b.user_id}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Import resume"
                value={resume}
                onChange={(e) => setResume(e.target.value)}
              >
                <option value="">Choose resume</option>
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.identifier}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Added date (CT)"
                type="date"
                min="1900-01-01"
                max={formatInTimeZone(new Date(), BID_TIMEZONE, "yyyy-MM-dd")}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <SelectField
                label="Default work arrangement"
                value={defaults.arrangement}
                onChange={(e) =>
                  setDefaults({ ...defaults, arrangement: e.target.value })
                }
              >
                {["remote", "onsite", "hybrid"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </SelectField>
              <SelectField
                label="Default job status"
                value={defaults.job_status}
                onChange={(e) =>
                  setDefaults({ ...defaults, job_status: e.target.value })
                }
              >
                {["open", "closed"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </SelectField>
            </div>
            <label className="space-y-2 text-sm">
              Copied cells
              <Textarea
                aria-label="Copied Google Sheets cells"
                className="mt-2 min-h-28 font-mono text-xs"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSource([]);
                }}
                placeholder="Paste cells here (Ctrl/Cmd+V)"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Up to 500 bids and 512 KiB. Every row is data: paste without
              headings or remove the heading row in preview. Company and role
              are required; job site is optional.
            </p>
            <Button variant="outline" onClick={parse}>
              Read columns
            </Button>
            {!!source.length && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {mapping.map((field, i) => (
                    <SelectField
                      key={i}
                      label={`Column ${i + 1}: ${(source[0]?.[i] ?? "Empty").slice(0, 45)}`}
                      value={field}
                      onChange={(e) =>
                        setMapping(
                          mapping.map((v, j) =>
                            j === i
                              ? (e.target.value as ImportField | "ignore")
                              : v,
                          ),
                        )
                      }
                    >
                      <option value="ignore">Ignore</option>
                      {importFields.map((f) => (
                        <option key={f} value={f}>
                          {fieldLabels[f]}
                        </option>
                      ))}
                    </SelectField>
                  ))}
                </div>
                <Button onClick={preview}>Preview bids</Button>
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-sm">
              {rows.length} bids · {date} CT ·{" "}
              {resumes.find((r) => r.id === resume)?.identifier}
            </p>
            <div className="max-h-[45vh] overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    <th className="p-2">Row</th>
                    {importFields.map((f) => (
                      <th className="p-2 text-left" key={f}>
                        {fieldLabels[f]}
                      </th>
                    ))}
                    <th>Remove</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                    <th className="border p-2">{sourceRows[i] ?? i + 1}</th>
                      {importFields.map((f) => {
                        const issues = errors.filter(
                          (e) => e.row === (sourceRows[i] ?? i + 1) && e.field === f,
                        );
                        return (
                          <td key={f} className="min-w-40 border p-1">
                            <Input
                          aria-label={`Row ${sourceRows[i] ?? i + 1} ${fieldLabels[f]}`}
                          aria-invalid={!!issues.length}
                              className="h-8 text-xs"
                              value={row[f]}
                              disabled={busy || uncertain}
                              onChange={(e) =>
                                changeRows(
                                  rows.map((r, j) =>
                                    j === i ? { ...r, [f]: e.target.value } : r,
                                  ), sourceRows,
                                )
                              }
                            />
                            {issues.map((e, k) => (
                              <p key={k} className="max-w-52 text-destructive">
                                {e.message}
                              </p>
                            ))}
                          </td>
                        );
                      })}
                      <td className="border">
                        <Button
                          aria-label={`Remove row ${sourceRows[i] ?? i + 1}`}
                          size="sm"
                          variant="ghost"
                          disabled={busy || uncertain}
                          onClick={() =>
                            changeRows(rows.filter((_, j) => j !== i), sourceRows.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                      <td className="border px-2">
                        {errors.some((entry) => entry.row === (sourceRows[i] ?? i + 1)) ? (
                          <span className="font-medium text-destructive">Blocked</span>
                        ) : checking ? (
                          <span className="text-muted-foreground">Checking</span>
                        ) : (
                          <span className="font-medium text-emerald-700 dark:text-emerald-300">Allowed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {checking && (
              <p role="status" className="text-sm">
                Checking profile restrictions and duplicate applications...
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy || uncertain}
                onClick={() => {
                  setRows(null);
                  setChecking(false);
                  setError("");
                }}
              >
                Back to mapping
              </Button>
              <Button
                disabled={busy}
                onClick={submit}
              >
                {busy ? "Validating and importing..." : uncertain ? "Retry same import" : `Import ${displayed?.allowed.length ?? 0} allowed bids`}
              </Button>
              {error && (
                <Button
                  variant="outline"
                  disabled={busy || uncertain}
                  onClick={() => {
                    if (attempted) {
                      void submit();
                    } else {
                      setError("");
                      setChecking(true);
                      setRows([...rows]);
                    }
                  }}
                >
                  {attempted ? "Retry import" : "Retry validation"}
                </Button>
              )}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
