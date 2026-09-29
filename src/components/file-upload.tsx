"use client";
import { useRef, useState } from "react";
import { UploadCloud, LoaderCircle, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/client";
import { prepareUpload, finalizeUpload } from "@/app/(workspace)/actions";
import { validateUpload, uploadTypes } from "@/lib/domain";
import { Button } from "./ui/button";
export function FileUpload({
  kind,
  target,
  onUploaded,
}: {
  kind: "resume" | "screenshot";
  target: string;
  onUploaded?: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  async function upload(file: File) {
    if (progress !== null) return;
    try {
      validateUpload(kind, file.type, file.size);
      setProgress(0);
      setPhase("Preparing upload");
      const prepared = await prepareUpload(
        kind,
        target,
        file.name,
        file.type,
        file.size,
      );
      if (prepared.error || !prepared.data)
        throw new Error(prepared.error ?? "Could not prepare upload.");
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in again.");
      setPhase("Uploading");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/private-files/${prepared.data!.storage_path}`,
        );
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader(
          "apikey",
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        );
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.timeout = 120000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(
                new Error(
                  "Upload failed. Please choose the file again to retry.",
                ),
              );
        xhr.onerror = () =>
          reject(new Error("Connection lost. Please try again."));
        xhr.ontimeout = () =>
          reject(new Error("Upload timed out. Please try again."));
        xhr.send(file);
      });
      setPhase("Verifying file");
      const finalized = await finalizeUpload(prepared.data.id);
      if (finalized.error || !finalized.data)
        throw new Error(finalized.error ?? "Verification failed.");
      toast.success(
        kind === "resume" ? "Resume file saved" : "Screenshot uploaded",
      );
      onUploaded?.(finalized.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div
      tabIndex={0}
      aria-label={
        kind === "screenshot"
          ? "Upload or paste an application screenshot"
          : "Upload resume file"
      }
      className="rounded-xl border border-dashed border-primary/30 bg-primary/[.025] p-6 text-center focus-visible:outline-2 focus-visible:outline-primary"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) void upload(e.dataTransfer.files[0]);
      }}
      onPaste={(e) => {
        if (kind === "screenshot" && e.clipboardData.files[0]) {
          e.preventDefault();
          void upload(e.clipboardData.files[0]);
        }
      }}
    >
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label={
          kind === "resume" ? "Choose resume file" : "Choose screenshot"
        }
        accept={uploadTypes[kind].join(",")}
        disabled={progress !== null}
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0]);
        }}
      />
      {progress !== null ? (
        <LoaderCircle
          className="mx-auto mb-3 animate-spin text-primary"
          size={25}
        />
      ) : kind === "screenshot" ? (
        <ImagePlus className="mx-auto mb-3 text-primary" size={25} />
      ) : (
        <UploadCloud className="mx-auto mb-3 text-primary" size={25} />
      )}
      <p className="text-sm font-medium">
        {progress !== null
          ? `${phase}… ${progress}%`
          : kind === "screenshot"
            ? "Drop your screenshot here"
            : "Drop your resume here"}
      </p>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        {kind === "screenshot"
          ? "PNG, JPG or WebP · Paste with Ctrl+V"
          : "PDF, DOC or DOCX"}{" "}
        · Up to 10 MB
      </p>
      {progress !== null ? (
        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 rounded-full bg-secondary"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
        >
          Browse files
        </Button>
      )}
    </div>
  );
}
