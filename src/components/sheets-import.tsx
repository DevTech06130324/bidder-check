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
import { checkBidImport, importBids } from "@/app/(workspace)/actions";
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
export type ImportResult = { date: string; bidder: string; resume: string };
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
  const [text, setText] = useState(initialText),
    [headers, setHeaders] = useState(false);
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
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false);
  const request = useRef(crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const localErrors = useMemo(
    () => (rows ? validateImportRows(rows) : []),
    [rows],
  );
  const bidders = data.bidders.filter(
    (b) =>
      !b.archived &&
      (data.profile.role !== "admin" || b.workspace_id === workspace) &&
      (!bidderId || b.user_id === bidderId),
  );
  const resumes = data.resumes.filter(
    (r) => !r.archived && r.bidder_id === bidder,
  );
  useEffect(() => {
    if (!rows || !rows.length || localErrors.length || !resume || !date) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const result = await checkBidImport(resume, date, rows);
        if (!cancelled) {
          setServerErrors(result.data ?? []);
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
  }, [rows, resume, date, localErrors]);
  function parse() {
    try {
      const parsed = parseSheet(text, headers ? 501 : 500);
      const values = headers ? parsed.slice(1) : parsed;
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
      const mapped = mapSheet(
        headers ? source.slice(1) : source,
        mapping,
        defaults,
      );
      if (mapped.length > 500) throw new Error("Import at most 500 rows.");
      setRows(mapped);
      setServerErrors([]);
      setChecking(validateImportRows(mapped).length === 0);
      setError("");
      request.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function changeRows(next: ImportRow[]) {
    setAttempted(false);
    setRows(next);
    setServerErrors([]);
    setChecking(validateImportRows(next).length === 0 && next.length > 0);
    setError("");
    request.current = crypto.randomUUID();
  }
  async function submit() {
    if (!rows) return;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      const result = await importBids(resume, date, rows, request.current);
      if (result.error) setError(result.error);
      else if (result.data?.errors) {
        setServerErrors(result.data.errors);
        setAttempted(false);
      } else if (result.data?.ids) {
        toast.success(`${result.data.ids.length} bids imported`);
        onSuccess(result.data);
      }
    } catch {
      setError(
        "Connection interrupted. Retry keeps the same request and will not duplicate bids.",
      );
    } finally {
      setBusy(false);
    }
  }
  const errors = [...localErrors, ...serverErrors];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
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
              {(["company", "role_name", "source"] as const).map((f) => (
                <Field
                  key={f}
                  label={`Default ${fieldLabels[f].toLowerCase()}`}
                  value={defaults[f] ?? ""}
                  maxLength={200}
                  onChange={(e) =>
                    setDefaults({ ...defaults, [f]: e.target.value })
                  }
                />
              ))}
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={headers}
                onChange={(e) => {
                  setHeaders(e.target.checked);
                  setSource([]);
                }}
              />
              First row contains headers
            </label>
            <p className="text-xs text-muted-foreground">
              Up to 500 bids and 512 KiB. Blank mapped cells use shared
              defaults.
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
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <th className="border p-2">{i + 1}</th>
                      {importFields.map((f) => {
                        const issues = errors.filter(
                          (e) => e.row === i + 1 && e.field === f,
                        );
                        return (
                          <td key={f} className="min-w-40 border p-1">
                            <Input
                              aria-label={`Row ${i + 1} ${fieldLabels[f]}`}
                              aria-invalid={!!issues.length}
                              className="h-8 text-xs"
                              value={row[f]}
                              disabled={busy}
                              onChange={(e) =>
                                changeRows(
                                  rows.map((r, j) =>
                                    j === i ? { ...r, [f]: e.target.value } : r,
                                  ),
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
                          aria-label={`Remove row ${i + 1}`}
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            changeRows(rows.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {checking && (
              <p role="status" className="text-sm">
                Checking rows and existing URLs...
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRows(null);
                  setChecking(false);
                  setError("");
                }}
              >
                Back to mapping
              </Button>
              <Button
                disabled={
                  busy || checking || !!errors.length || !rows.length || !!error
                }
                onClick={submit}
              >
                {busy ? "Importing..." : `Import ${rows.length} bids`}
              </Button>
              {error && (
                <Button
                  variant="outline"
                  disabled={busy}
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
