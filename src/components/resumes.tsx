"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  FileText,
  Search,
  Mail,
  Phone,
  MapPin,
  Link as LinkIcon,
  Archive,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceData } from "@/lib/data";
import type { Row } from "@/lib/database.types";
import { usd, effectiveRate } from "@/lib/domain";
import { saveResume, archiveResume } from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
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
} from "./common";
import { FileUpload } from "./file-upload";
export function ResumeDialog({
  data,
  resume,
  bidderId,
}: {
  data: WorkspaceData;
  resume?: Row<"resumes">;
  bidderId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [bidder, setBidder] = useState(
    resume?.bidder_id ??
      bidderId ??
      data.bidders.find((b) => !b.archived)?.user_id ??
      "",
  );
  const router = useRouter();
  const membership = data.bidders.find((b) => b.user_id === bidder);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={resume ? "outline" : "default"}
          size={resume ? "sm" : "default"}
          disabled={!data.bidders.some((b) => !b.archived)}
        >
          {!resume && <Plus size={16} />}{" "}
          {resume ? "Edit profile" : "New resume"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {resume
              ? "Edit resume profile"
              : "A profile for the next opportunity"}
          </DialogTitle>
          <DialogDescription>
            Keep the details your bidder needs in one place. Add the resume file
            after saving.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          action={(form) =>
            start(async () => {
              const result = await saveResume(form);
              if (result.error) toast.error(result.error);
              else {
                toast.success("Resume profile saved");
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          <input type="hidden" name="id" value={resume?.id ?? ""} />
          <input
            type="hidden"
            name="workspace_id"
            value={membership?.workspace_id ?? ""}
          />
          <input type="hidden" name="bidder_id" value={bidder} />
          <SelectField
            label="Assigned bidder"
            value={bidder}
            disabled={!!resume}
            onChange={(e) => setBidder(e.target.value)}
            required
          >
            <option value="" disabled>
              Choose a bidder
            </option>
            {data.bidders
              .filter((b) => !b.archived || b.user_id === bidder)
              .map((b) => (
                <option key={b.user_id} value={b.user_id}>
                  {data.profiles.find((p) => p.id === b.user_id)
                    ?.display_name ?? "Bidder"}
                </option>
              ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Resume identifier"
              name="identifier"
              required
              placeholder="ENG-01"
              defaultValue={resume?.identifier}
            />
            <Field
              label="Candidate name"
              name="candidate_name"
              required
              defaultValue={resume?.candidate_name}
            />
            <Field
              label="Email address"
              name="email"
              type="email"
              defaultValue={resume?.email}
            />
            <Field
              label="Phone number"
              name="phone"
              type="tel"
              defaultValue={resume?.phone}
            />
          </div>
          <Field
            label="Postal address"
            name="address"
            defaultValue={resume?.address}
          />
          <Field
            label="Professional links"
            name="links"
            defaultValue={resume?.links}
            placeholder="LinkedIn, portfolio, GitHub…"
          />
          <div className="space-y-2">
            <label
              htmlFor={`instructions-${resume?.id ?? "new"}`}
              className="text-xs font-medium"
            >
              Application instructions
            </label>
            <Textarea
              id={`instructions-${resume?.id ?? "new"}`}
              name="instructions"
              rows={4}
              defaultValue={resume?.instructions}
              placeholder="Experience, preferences, and details to use when applying…"
            />
          </div>
          <Field
            label="Rate override per bid (USD)"
            name="rate"
            type="number"
            min="0"
            step="0.01"
            defaultValue={
              resume?.rate_override_cents != null
                ? resume.rate_override_cents / 100
                : ""
            }
            placeholder={
              membership?.default_rate_cents != null
                ? `Inherit ${usd(membership.default_rate_cents)}`
                : "Use bidder default"
            }
          />
          <div className="flex justify-end">
            <SaveButton
              pending={pending}
              label={resume ? "Save changes" : "Create profile"}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ResumeLibrary({
  data,
  bidderId,
  embedded = false,
}: {
  data: WorkspaceData;
  bidderId?: string;
  embedded?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const canEdit = data.profile.role !== "bidder";
  const list = data.resumes.filter(
    (r) =>
      (!bidderId || r.bidder_id === bidderId) &&
      (showArchived || !r.archived) &&
      `${r.identifier} ${r.candidate_name} ${r.email}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const active = data.resumes.find((r) => r.id === selected);
  return (
    <>
      {!embedded && (
        <PageHeading
          eyebrow="THE RIGHT PROFILE FOR EVERY OPPORTUNITY"
          title="Your resume library."
          description="All the details, documents, and directions your team needs."
        >
          {canEdit && <ResumeDialog data={data} bidderId={bidderId} />}
        </PageHeading>
      )}
      {embedded && (
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Resume profiles</h2>
          {canEdit && <ResumeDialog data={data} bidderId={bidderId} />}
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search
            className="absolute left-3 top-2.5 text-muted-foreground"
            size={15}
          />
          <Input
            aria-label="Search resumes"
            className="bg-card pl-9"
            placeholder="Search profiles, names, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{" "}
          Include archived
        </label>
      </div>
      {!list.length ? (
        <div className="panel">
          <EmptyState
            title="A place for every profile"
            description={
              canEdit
                ? "Create a resume profile and assign it to a bidder. Their application details will always be close at hand."
                : "Your client will add your resume profiles here. Check back soon."
            }
          />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const bidder = data.bidders.find((b) => b.user_id === r.bidder_id);
            const rate = effectiveRate(
              bidder?.default_rate_cents ?? null,
              r.rate_override_cents,
            );
            return (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className="panel group p-6 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="mb-5 flex items-start justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileText size={21} />
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {r.archived ? "Archived" : r.identifier}
                  </Badge>
                </div>
                <h3 className="text-base font-semibold group-hover:text-primary">
                  {r.candidate_name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.profiles.find((p) => p.id === r.bidder_id)
                    ?.display_name ?? "Assigned bidder"}
                </p>
                <div className="my-5 space-y-2.5 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2 truncate">
                    <Mail size={13} />
                    {r.email || "No email added"}
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone size={13} />
                    {r.phone || "No phone added"}
                  </p>
                </div>
                <div className="flex items-center justify-between border-t pt-4">
                  <span className="text-xs text-muted-foreground">
                    {data.bids.filter((b) => b.resume_id === r.id).length} bids
                    tracked
                  </span>
                  <span className="text-sm font-semibold">
                    {rate === null ? (
                      "Rate not set"
                    ) : (
                      <>
                        {usd(rate)}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          / bid
                        </span>
                      </>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
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
                <SheetTitle>{active.candidate_name}</SheetTitle>
                <SheetDescription>
                  {active.identifier} · Resume profile
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">
                    {active.archived ? "Archived" : "Active profile"}
                  </Badge>
                  {canEdit && !active.archived && (
                    <ResumeDialog data={data} resume={active} />
                  )}
                </div>
                {[
                  { icon: Mail, label: "Email", value: active.email },
                  { icon: Phone, label: "Phone", value: active.phone },
                  { icon: MapPin, label: "Address", value: active.address },
                  {
                    icon: LinkIcon,
                    label: "Professional links",
                    value: active.links,
                  },
                ].map((f) => (
                  <div key={f.label}>
                    <p className="eyebrow mb-2 flex items-center gap-2">
                      <f.icon size={12} />
                      {f.label}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {f.value || "Not provided"}
                    </p>
                  </div>
                ))}
                <div>
                  <p className="eyebrow mb-2">APPLICATION INSTRUCTIONS</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-background p-4 text-sm leading-6">
                    {active.instructions || "No additional instructions."}
                  </p>
                </div>
                <div className="space-y-3 border-t pt-5">
                  <h3 className="font-semibold">Resume document</h3>
                  {active.file_id ? (
                    <FileButton id={active.file_id} label="Open resume" />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No document uploaded yet.
                    </p>
                  )}
                  {canEdit && !active.archived && (
                    <FileUpload
                      kind="resume"
                      target={active.id}
                      onUploaded={() => router.refresh()}
                    />
                  )}
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await archiveResume(
                          active.id,
                          !active.archived,
                        );
                        if (result.error) toast.error(result.error);
                        else {
                          toast.success(
                            active.archived
                              ? "Resume restored"
                              : "Resume archived",
                          );
                          setSelected(undefined);
                          router.refresh();
                        }
                      })
                    }
                  >
                    {active.archived ? (
                      <RotateCcw size={15} />
                    ) : (
                      <Archive size={15} />
                    )}{" "}
                    {active.archived ? "Restore profile" : "Archive profile"}
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
