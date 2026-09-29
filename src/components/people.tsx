"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ArrowUpRight, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import type { WorkspaceData } from "@/lib/data";
import type { Row } from "@/lib/database.types";
import { usd, initials } from "@/lib/domain";
import {
  createBidder,
  updateBidder,
  updateClient,
} from "@/app/(workspace)/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "./ui/dialog";
import {
  PageHeading,
  Field,
  SelectField,
  SaveButton,
  EmptyState,
} from "./common";
export function CreateBidderDialog({
  data,
  invitation,
}: {
  data: WorkspaceData;
  invitation?: Row<"invitations">;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={invitation ? "outline" : "default"}
          size={invitation ? "sm" : "default"}
        >
          {invitation ? <RotateCcw size={15} /> : <Plus size={16} />}{" "}
          {invitation ? "Retry creation" : "Add bidder"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a bidder account</DialogTitle>
          <DialogDescription>
            Their initial password is 123456. Share their sign-in details
            directly; they can change their password in Settings.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          action={(form) =>
            start(async () => {
              const result = await createBidder(form);
              if (result.error) toast.error(result.error);
              else {
                toast.success(
                  "Bidder account created. Initial password: 123456",
                );
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          <SelectField
            label="Workspace"
            name="workspace_id"
            defaultValue={invitation?.workspace_id ?? data.workspaces[0]?.id}
            required
          >
            {data.workspaces.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Full name"
            name="display_name"
            required
            defaultValue={invitation?.display_name}
          />
          <Field
            label="Email address"
            name="email"
            type="email"
            required
            defaultValue={invitation?.email}
          />
          <Field
            label="Default rate per bid (USD)"
            name="rate"
            type="number"
            min="0"
            step="0.01"
            defaultValue={
              invitation?.default_rate_cents != null
                ? invitation.default_rate_cents / 100
                : ""
            }
            placeholder="Set later"
          />
          <div className="flex justify-end pt-2">
            <SaveButton pending={pending} label="Create bidder" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function EditPerson({
  person,
  bidder,
}: {
  person: Row<"profiles">;
  bidder?: Row<"bidders">;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage {person.display_name}</DialogTitle>
          <DialogDescription>
            Archived accounts lose access. Their history and earnings are
            preserved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          action={(form) =>
            start(async () => {
              const result = await (bidder
                ? updateBidder(form)
                : updateClient(form));
              if (result.error) toast.error(result.error);
              else {
                toast.success("Account updated");
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          <input type="hidden" name="user_id" value={person.id} />
          <Field
            label="Full name"
            name="display_name"
            defaultValue={person.display_name}
            required
          />
          {bidder && (
            <Field
              label="Default rate per bid (USD)"
              name="rate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={
                bidder.default_rate_cents === null
                  ? ""
                  : bidder.default_rate_cents / 100
              }
            />
          )}
          <SelectField
            label="Account status"
            name="archived"
            defaultValue={String(person.archived)}
          >
            <option value="false">Active</option>
            <option value="true">Archived — remove access</option>
          </SelectField>
          <SaveButton pending={pending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function People({ data }: { data: WorkspaceData }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const people = data.profiles.filter(
    (p) =>
      p.role !== "admin" &&
      p.id !== data.profile.id &&
      (!search ||
        `${p.display_name} ${p.email}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (tab === "all" || p.role === tab),
  );
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE PROGRESS"
        title="Better work, together."
        description="A clear view of your team, their profiles, and their progress."
      >
        <CreateBidderDialog data={data} />
      </PageHeading>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            label: "Team members",
            value: data.bidders.filter((b) => !b.archived).length,
          },
          {
            label: "Resume profiles",
            value: data.resumes.filter((r) => !r.archived).length,
          },
          {
            label: "Pending accounts",
            value: data.invitations.filter((i) => !i.accepted_at).length,
          },
        ].map((s) => (
          <div className="panel flex items-center gap-4 p-5" key={s.label}>
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <Users size={20} />
            </div>
            <div>
              <p className="text-2xl font-semibold">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div className="flex gap-1">
            {(data.profile.role === "admin"
              ? ["all", "client", "bidder"]
              : ["all"]
            ).map((t) => (
              <Button
                size="sm"
                variant={tab === t ? "secondary" : "ghost"}
                key={t}
                onClick={() => setTab(t)}
                className="capitalize"
              >
                {t === "all" ? "All people" : `${t}s`}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              size={15}
              className="absolute left-3 top-2.5 text-muted-foreground"
            />
            <Input
              aria-label="Search people"
              placeholder="Search name or email…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {!people.length ? (
          <EmptyState
            title="Your team starts here"
            description="Add your first bidder, then give them a resume profile and a rate to get started."
          />
        ) : (
          <div className="divide-y">
            {people.map((p) => {
              const b = data.bidders.find((b) => b.user_id === p.id);
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center gap-4 p-5"
                >
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {initials(p.display_name || p.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={b ? `/users/${p.id}` : "/users"}
                        className="font-semibold hover:text-primary"
                      >
                        {p.display_name}
                      </Link>
                      <Badge
                        variant="secondary"
                        className="text-[10px] capitalize"
                      >
                        {p.role}
                      </Badge>
                      {p.archived && <Badge variant="outline">Archived</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {p.email}
                    </p>
                  </div>
                  {b && (
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-semibold">
                        {b.default_rate_cents === null
                          ? "Rate not set"
                          : usd(b.default_rate_cents)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        per application
                      </p>
                    </div>
                  )}
                  <EditPerson person={p} bidder={b} />
                  {b && (
                    <Button asChild variant="ghost" size="icon">
                      <Link
                        href={`/users/${p.id}`}
                        aria-label={`View ${p.display_name}`}
                      >
                        <ArrowUpRight size={16} />
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      {data.invitations.some((i) => !i.accepted_at) && (
        <section className="panel mt-6 p-5">
          <h2 className="mb-4 font-semibold">Pending accounts</h2>
          <div className="divide-y">
            {data.invitations
              .filter((i) => !i.accepted_at)
              .map((i) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={i.id}
                >
                  <div>
                    <p className="text-sm font-medium">{i.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.email} · Expires{" "}
                      {new Date(i.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <CreateBidderDialog data={data} invitation={i} />
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
