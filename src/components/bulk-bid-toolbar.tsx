"use client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "sonner";
import type {
  BidTarget,
  CleanupOutcome,
  PurgeSnapshot,
} from "@/lib/bulk-types";
import { canRetryPurge, plural, purgeMessage } from "@/lib/purge-status";
import { usePurgeOperations } from "./use-purge-operations";
import {
  bulkBidState,
  prepareBidPurge,
  confirmBidPurge,
  retryPurgeCleanup,
  reviewBidsAction,
  manualApplyBidsAction,
} from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import { Field } from "./common";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

function retryToast(outcome: CleanupOutcome, pending: number) {
  if (outcome === "failed") toast.error("Cleanup failed — retry available");
  else if (outcome === "waiting")
    toast.info("Final verification is scheduled; nothing to retry yet");
  else if (outcome === "processing")
    toast.info("Cleanup is already in progress");
  else if (!pending) toast.success("Screenshot cleanup complete");
  else toast.success("Screenshots removed; final verification scheduled");
}

export function BulkBidToolbar({
  targets,
  trash,
  manager,
  bidderId,
  disabled,
  loading,
  clear,
  onDone,
  onBusy,
}: {
  targets: BidTarget[];
  trash: boolean;
  manager: boolean;
  bidderId?: string;
  disabled: boolean;
  loading: boolean;
  clear: () => void;
  onDone: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [snapshot, setSnapshot] = useState<PurgeSnapshot | null>(null),
    [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTime, setManualTime] = useState(() => formatInTimeZone(new Date(), "America/Chicago", "yyyy-MM-dd'T'HH:mm"));
  const [manualReason, setManualReason] = useState("");
  const [manualRequestId, setManualRequestId] = useState<string | null>(null);
  const { operations, finished, pollError, serverNow, begin, remember } =
    usePurgeOperations(manager);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Please retry.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function prepare(mode: "selected" | "all") {
    await run(async () => {
      const result = await prepareBidPurge(mode, targets, bidderId);
      if (result.error || !result.data) throw new Error(result.error);
      setSnapshot(result.data);
      setConfirmation("");
    });
  }
  return (
    <>
      <div
        className="flex min-h-14 flex-wrap items-center gap-2 border-y bg-muted/20 px-5 py-2"
        aria-label="Bulk application actions"
      >
        <span
          className="inline-flex size-5 shrink-0 items-center justify-center"
          role="status"
          aria-label={loading ? "Refreshing bids" : "Bids up to date"}
        >
          <LoaderCircle
            size={14}
            aria-hidden="true"
            className={loading ? "animate-spin" : "invisible"}
          />
        </span>
        <span className="min-w-20 text-xs tabular-nums">
          {targets.length} selected
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!targets.length || disabled || busy}
          onClick={clear}
        >
          Clear selection
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!targets.length || disabled || busy || loading}
          onClick={() =>
            void run(async () => {
              const result = await bulkBidState(targets, !trash);
              if (result.error) throw new Error(result.error);
              toast.success(
                trash
                  ? "Selected bids restored"
                  : "Selected bids moved to trash",
              );
              onDone();
            })
          }
        >
          {trash ? "Restore selected" : "Move selected to trash"}
        </Button>
        {manager && !trash && <Button
          size="sm"
          variant="outline"
          disabled={!targets.length || disabled || busy || loading}
          onClick={() => { setError(""); setManualOpen(true); }}
        >Mark selected as applied</Button>}
        {manager && !trash && <>
          <Button size="sm" variant="outline" disabled={!targets.length || disabled || busy || loading} onClick={()=>void run(async()=>{const result=await reviewBidsAction(targets,"approved","");if(result.error)throw new Error(result.error);toast.success(`${result.data??targets.length} applications approved`);onDone();})}>Approve selected</Button>
          <Button size="sm" variant="outline" disabled={!targets.length || disabled || busy || loading} onClick={()=>{const reason=window.prompt("Reason for rejecting the selected applications (required)");if(!reason?.trim())return;void run(async()=>{const result=await reviewBidsAction(targets,"rejected",reason);if(result.error)throw new Error(result.error);toast.success(`${result.data??targets.length} applications returned for correction`);onDone();});}}>Reject selected</Button>
        </>}
        {trash && manager && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={!targets.length || disabled || busy || loading}
              onClick={() => void prepare("selected")}
            >
              Delete selected permanently
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={disabled || busy || loading}
              onClick={() => void prepare("all")}
            >
              Empty trash
            </Button>
          </>
        )}
      </div>
      {pollError && (
        <p role="alert" className="border-b px-5 py-2 text-xs text-destructive">
          Screenshot cleanup status could not be refreshed. Retrying…
        </p>
      )}
      {operations.map((op) => (
        <div
          key={op.id}
          className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs"
          role="status"
        >
          <span>
            {plural(op.deletedCount, "application")} deleted.{" "}
            {purgeMessage(op, serverNow)}.
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || disabled || !canRetryPurge(op, serverNow)}
            onClick={() =>
              void run(async () => {
                const token = begin();
                const result = await retryPurgeCleanup(op.id);
                if (result.error || !result.data) throw new Error(result.error);
                remember(result.data.status, token);
                retryToast(
                  result.data.outcome,
                  result.data.status.pendingFiles,
                );
              })
            }
          >
            Retry cleanup
          </Button>
        </div>
      ))}
      {finished.map((op) => (
        <p key={op.id} role="status" className="border-b px-5 py-2 text-xs">
          {plural(op.deletedCount, "application")} deleted.{" "}
          {purgeMessage(op, serverNow)}.
        </p>
      ))}
      <Dialog
        open={manualOpen}
        onOpenChange={(open) => { if (!busy) setManualOpen(open); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark selected bids as applied?</DialogTitle>
            <DialogDescription>
              This records applications without screenshots, approves the selected bids, and includes them in earnings at their configured rates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="rounded-md bg-muted p-3 text-sm">
              {targets.length - targets.filter((target) => target.applied).length} will be marked applied; {targets.filter((target) => target.applied).length} already applied will remain unchanged.
            </p>
            <Field label="Applied date and time (CT)" type="datetime-local" value={manualTime} onChange={(event) => { setManualTime(event.target.value); setManualRequestId(null); }} />
            <label className="block space-y-1 text-xs font-medium">Reason (required)
              <Textarea value={manualReason} maxLength={1000} onChange={(event) => { setManualReason(event.target.value); setManualRequestId(null); }} placeholder="Add context for the application record" />
            </label>
            <p className="text-xs text-muted-foreground">The chosen time affects activity reports and the profile’s retention period.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button disabled={busy || !manualTime || !manualReason.trim() || !targets.length} onClick={() => void run(async () => {
              const requestId = manualRequestId ?? crypto.randomUUID();
              setManualRequestId(requestId);
              const result = await manualApplyBidsAction({ targets, localTime: manualTime, reason: manualReason, requestId });
              if (result.error || !result.data) throw new Error(result.error ?? "Could not apply selected bids");
              toast.success(`${result.data.applied} applications marked applied; ${result.data.unchanged} already applied`);
              setManualRequestId(null);
              setManualOpen(false);
              onDone();
            })}>Confirm application</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!snapshot}
        onOpenChange={(open) => {
          if (!open && !busy) setSnapshot(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Permanently delete {snapshot?.count} bids?
            </DialogTitle>
            <DialogDescription>
              {snapshot?.scope}. Application records, history and screenshots
              cannot be restored. This confirmation includes exactly{" "}
              {snapshot?.count} bids; table filters do not limit Empty trash.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Type DELETE to confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error} Close this dialog and prepare a new confirmation if the
              selection changed or expired.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSnapshot(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmation !== "DELETE" || busy}
              onClick={() =>
                void run(async () => {
                  if (!snapshot) return;
                  const token = begin();
                  const result = await confirmBidPurge(
                    snapshot.id,
                    confirmation,
                  );
                  if (result.error || !result.data)
                    throw new Error(result.error);
                  remember(result.data.status, token);
                  const { status, outcome } = result.data;
                  const note = !status.pendingFiles
                    ? "screenshot cleanup complete"
                    : outcome === "failed"
                      ? "screenshot cleanup failed and will retry automatically"
                      : "screenshot cleanup in progress";
                  (outcome === "failed" ? toast.warning : toast.success)(
                    `${plural(status.deletedCount, "application")} permanently deleted; ${note}`,
                  );
                  setSnapshot(null);
                  onDone();
                })
              }
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
