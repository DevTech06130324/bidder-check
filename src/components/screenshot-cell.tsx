"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Row } from "@/lib/database.types";
import { getFileUrl } from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { FileUpload } from "./file-upload";

export function ScreenshotCell({ bid }: { bid: Row<"bids"> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !bid.evidence_file_id) return;
    let cancelled = false;
    async function load() {
      const result = await getFileUrl(bid.evidence_file_id!);
      if (cancelled) return;
      if (result.data) {
        setUrl(result.data.url);
        setError("");
      } else {
        setUrl("");
        setError(result.error ?? "Preview unavailable");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 45000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, bid.evidence_file_id, retry]);
  return (
    <div ref={ref} className="w-52 space-y-2 whitespace-normal">
      {url && (
        <button
          className="block w-full overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => setOpen(true)}
          aria-label={`Preview screenshot for ${bid.company}`}
        >
          {/* Private, expiring URLs must bypass the public Next image optimization cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Application proof for ${bid.company}`}
            className="h-20 w-full object-cover"
            loading="lazy"
            onError={() => setError("Preview expired. Retry to refresh.")}
          />
        </button>
      )}
      {error && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry preview
        </Button>
      )}
      {!bid.deleted_at && (
        <FileUpload
          compact
          kind="screenshot"
          target={bid.id}
          label={
            bid.applied
              ? "Replace screenshot"
              : bid.evidence_file_id
                ? "Upload new proof"
                : "Upload screenshot"
          }
          onUploaded={() => router.refresh()}
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{bid.company} application proof</DialogTitle>
            <DialogDescription>
              {bid.applied
                ? "Current application screenshot"
                : "Historical proof; upload new proof to apply again"}
            </DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Enlarged application proof for ${bid.company}`}
            className="max-h-[75vh] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
