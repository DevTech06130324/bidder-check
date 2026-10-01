"use client";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import type { BidTarget, PurgeSnapshot, PurgeStatus } from "@/lib/bulk-types";
import {
  bulkBidState,
  prepareBidPurge,
  confirmBidPurge,
  getPurgeStatus,
  recentBidPurges,
} from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import { Field } from "./common";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

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
  const [error, setError] = useState(""),
    [operations, setOperations] = useState<PurgeStatus[]>([]);
  function remember(status: PurgeStatus) {
    setOperations((current) => [
      status,
      ...current.filter((o) => o.id !== status.id),
    ]);
  }
  useEffect(() => {
    if (!manager) return;
    let cancelled = false;
    async function load() {
      const result = await recentBidPurges();
      if (!cancelled && result.data) setOperations(result.data);
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [manager]);
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
      {operations
        .filter((o) => o.pendingFiles > 0)
        .map((op) => (
          <div
            key={op.id}
            className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs"
            role="status"
          >
            <span>
              {op.deletedCount} applications deleted.{" "}
              {op.failedFiles
                ? "Screenshot cleanup needs retry."
                : op.verifyingFiles === op.pendingFiles
                  ? "Screenshot verification pending."
                  : "Screenshot cleanup pending."}{" "}
              {op.pendingFiles} files remaining.
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() =>
                void run(async () => {
                  const result = await getPurgeStatus(op.id, true);
                  if (result.error || !result.data)
                    throw new Error(result.error);
                  remember(result.data);
                  if (!result.data.pendingFiles)
                    toast.success("Screenshot cleanup complete");
                })
              }
            >
              Retry cleanup
            </Button>
          </div>
        ))}
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
                  const result = await confirmBidPurge(
                    snapshot.id,
                    confirmation,
                  );
                  if (result.error || !result.data)
                    throw new Error(result.error);
                  remember(result.data);
                  toast.success(
                    `${result.data.deletedCount} applications permanently deleted${result.data.pendingFiles ? "; screenshot cleanup pending" : "; screenshot cleanup complete"}`,
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
