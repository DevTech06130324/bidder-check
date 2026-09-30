"use server";
import { getContext } from "@/lib/auth";
import { adminClient } from "@/lib/admin";
import { revalidatePath } from "next/cache";
import {
  normalizeJobUrl,
  moneyToCents,
  validateUpload,
  chicagoDateRange,
} from "@/lib/domain";
import type { Database } from "@/lib/database.types";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateScreenshotBytes } from "@/lib/image-validation";

type Result<T = undefined> = { data?: T; error?: string };
async function perform<T>(
  fn: () => Promise<T>,
  mutate = true,
): Promise<Result<T>> {
  try {
    const data = await fn();
    if (mutate) revalidatePath("/", "layout");
    return { data };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "Something went wrong. Please try again.";
    return {
      error: message.includes("duplicate key")
        ? "This record already exists. Check the resume identifier or job URL."
        : message,
    };
  }
}
async function rpc<N extends keyof Database["public"]["Functions"]>(
  name: N,
  args: Database["public"]["Functions"][N]["Args"],
) {
  const { supabase } = await getContext();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
const text = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const id = (value: string) => (value ? z.uuid().parse(value) : null);
export async function saveBid(form: FormData) {
  return perform(async () => {
    const url = normalizeJobUrl(text(form, "url"));
    return await rpc("save_bid", {
      p_id: id(text(form, "id")),
      p_resume: z.uuid().parse(text(form, "resume_id")),
      p_company: text(form, "company"),
      p_role: text(form, "role_name"),
      p_url: url,
      p_source: text(form, "source"),
      p_arrangement: text(form, "arrangement"),
      p_status: text(form, "job_status"),
    });
  });
}
export async function saveResume(form: FormData) {
  return perform(
    async () =>
      await rpc("save_resume", {
        p_id: id(text(form, "id")),
        p_workspace: z.uuid().parse(text(form, "workspace_id")),
        p_bidder: z.uuid().parse(text(form, "bidder_id")),
        p_identifier: text(form, "identifier"),
        p_name: text(form, "candidate_name"),
        p_email: text(form, "email"),
        p_phone: text(form, "phone"),
        p_address: text(form, "address"),
        p_links: text(form, "links"),
        p_instructions: text(form, "instructions"),
        p_rate: moneyToCents(text(form, "rate")),
      }),
  );
}
export async function archiveResume(resumeId: string, archived: boolean) {
  return perform(
    async () =>
      await rpc("archive_resume", { p_id: resumeId, p_archived: archived }),
  );
}
async function changeManagedEmail(form: FormData, role: "client" | "bidder") {
  const account = z.uuid().parse(text(form, "user_id"));
  const allowed = await rpc("can_manage_account", { p_account: account });
  if (!allowed) throw new Error("Access denied");
  const { supabase } = await getContext();
  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", account)
    .single();
  if (target?.role !== role) throw new Error("Account type does not match");
  const email = text(form, "email");
  if (email) {
    z.email().parse(email);
    const { error } = await adminClient().auth.admin.updateUserById(account, {
      email: email.toLowerCase(),
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
  }
}
export async function updateBidder(form: FormData) {
  return perform(async () => {
    const rate = moneyToCents(text(form, "rate"));
    if (!text(form, "display_name")) throw new Error("Name required");
    await changeManagedEmail(form, "bidder");
    await rpc("update_bidder", {
      p_bidder: text(form, "user_id"),
      p_name: text(form, "display_name"),
      p_rate: rate,
      p_archived: text(form, "archived") === "true",
    });
  });
}
export async function updateClient(form: FormData) {
  return perform(async () => {
    const { profile } = await getContext();
    if (profile.role !== "admin") throw new Error("Access denied");
    if (!text(form, "display_name")) throw new Error("Name required");
    await changeManagedEmail(form, "client");
    await rpc("update_client", {
      p_client: text(form, "user_id"),
      p_name: text(form, "display_name"),
      p_archived: text(form, "archived") === "true",
    });
  });
}
export async function reviewClient(
  account: string,
  status: "approved" | "rejected",
  reason: string,
) {
  return perform(async () =>
    rpc("review_client", {
      p_client: account,
      p_status: status,
      p_reason: reason,
    }),
  );
}
export async function resetManagedPassword(
  account: string,
  confirmed: boolean,
) {
  return perform(async () => {
    if (confirmed !== true) throw new Error("Confirm the password reset first");
    if (
      !(await rpc("can_manage_account", { p_account: z.uuid().parse(account) }))
    )
      throw new Error("Access denied");
    const { error } = await adminClient().auth.admin.updateUserById(account, {
      password: "123456",
    });
    if (error) throw new Error(error.message);
    await rpc("record_account_event", {
      p_account: account,
      p_event: "password_reset",
    });
  });
}
export async function createClientAccount(form: FormData) {
  return perform(async () => {
    const { profile } = await getContext();
    if (profile.role !== "admin") throw new Error("Access denied");
    const email = z.email().parse(text(form, "email")).toLowerCase();
    const name = z.string().min(1).max(100).parse(text(form, "display_name"));
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password: "123456",
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error) throw new Error(error.message);
    await rpc("review_client", {
      p_client: data.user.id,
      p_status: "approved",
      p_reason: null,
    });
    await rpc("record_account_event", {
      p_account: data.user.id,
      p_event: "created",
    });
  });
}
export async function trashBid(bid: string, deleted: boolean) {
  return perform(async () =>
    rpc("trash_bid", { p_bid: z.uuid().parse(bid), p_deleted: deleted }),
  );
}
export async function createBidder(form: FormData) {
  return perform(async () => {
    const { supabase } = await getContext();
    const admin = adminClient();
    const email = z.email().parse(text(form, "email")).toLowerCase();
    const { data: reservation, error } = await supabase.rpc("invite_bidder", {
      p_workspace: text(form, "workspace_id"),
      p_email: email,
      p_name: text(form, "display_name"),
      p_rate: moneyToCents(text(form, "rate")),
    });
    if (error) throw new Error(error.message);
    if (!reservation)
      throw new Error("Account reservation failed. Please retry.");
    const { error: createError } = await admin.auth.admin.createUser({
      id: reservation,
      email,
      password: "123456",
      email_confirm: true,
      user_metadata: { display_name: text(form, "display_name") },
    });
    if (createError)
      throw new Error(
        `Account creation could not finish: ${createError.message}. Retry from pending accounts.`,
      );
  });
}
export async function unapplyBid(bidId: string, reason: string) {
  return perform(
    async () =>
      await rpc("set_applied", {
        p_bid: bidId,
        p_applied: false,
        p_file: null,
        p_reason: reason,
      }),
  );
}
export async function saveSettings(form: FormData) {
  return perform(
    async () =>
      await rpc("save_settings", {
        p_name: text(form, "display_name"),
        p_workspace: id(text(form, "workspace_id")),
        p_workspace_name: text(form, "workspace_name"),
        p_timezone: text(form, "timezone"),
      }),
  );
}
export async function prepareUpload(
  kind: "resume" | "screenshot",
  target: string,
  name: string,
  mime: string,
  size: number,
) {
  return perform(async () => {
    validateUpload(kind, mime, size);
    adminClient();
    const { supabase } = await getContext();
    const { data, error } = await supabase.rpc("prepare_file", {
      p_kind: kind,
      p_target: target,
      p_name: name,
      p_mime: mime,
      p_size: size,
    });
    if (error) throw new Error(error.message);
    const { data: file, error: readError } = await supabase
      .from("files")
      .select("*")
      .eq("id", data!)
      .single();
    if (readError) throw new Error(readError.message);
    return file;
  });
}
function matchesSignature(bytes: Uint8Array, mime: string) {
  const head = Array.from(bytes.slice(0, 12));
  if (mime === "image/png")
    return head.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (mime === "image/jpeg")
    return head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (mime === "image/webp")
    return (
      Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
      Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
    );
  if (mime === "application/pdf")
    return Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
  if (mime === "application/msword")
    return head.slice(0, 8).join(",") === "208,207,17,224,161,177,26,225";
  return head[0] === 80 && head[1] === 75 && head[2] === 3 && head[3] === 4;
}
export async function finalizeUpload(fileId: string) {
  return perform(async () => {
    const { supabase, profile } = await getContext();
    const { data: file, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .single();
    if (error || !file) throw new Error("File not found.");
    if (file.created_by !== profile.id)
      throw new Error("Only the uploader can finalize this file.");
    // Download with the caller's JWT so storage RLS checks current access again.
    const { data: blob, error: downloadError } = await supabase.storage
      .from("private-files")
      .download(file.storage_path);
    if (downloadError || !blob)
      throw new Error("Upload has not completed. Please retry.");
    if (blob.size !== file.size_bytes)
      throw new Error("File size does not match the upload.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!matchesSignature(bytes, file.mime))
      throw new Error("The file contents do not match its type.");
    if (file.kind === "screenshot")
      await validateScreenshotBytes(bytes, file.mime);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const { error: finalError } = await adminClient().rpc(
      "finalize_verified_file",
      {
        p_actor: profile.id,
        p_id: file.id,
        p_sha: sha,
      },
    );
    if (finalError) throw new Error(finalError.message);
    return file.id;
  });
}
export async function getFileUrl(fileId: string) {
  return perform(async () => {
    const { supabase } = await getContext();
    const { data: file, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("finalized", true)
      .single();
    if (error || !file) throw new Error("File is unavailable.");
    const { data, error: storageError } = await supabase.storage
      .from("private-files")
      .createSignedUrl(file.storage_path, 60);
    if (storageError) throw new Error(storageError.message);
    return { url: data.signedUrl, name: file.filename, mime: file.mime };
  }, false);
}
export async function getBidHistory(bidId: string) {
  return perform(async () => {
    const { supabase } = await getContext();
    const { data, error } = await supabase
      .from("bid_events")
      .select("*")
      .eq("bid_id", bidId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }, false);
}

export async function getBidRows(
  mode: string,
  from: string,
  to: string,
  trash: boolean,
  bidderId?: string,
) {
  // Reads deliberately do not invalidate the route (thumbnail reads must not loop).
  try {
    const { supabase } = await getContext();
    const bounds = chicagoDateRange(mode, from, to);
    const rows: Database["public"]["Tables"]["bids"]["Row"][] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase
        .from("bids")
        .select("*")
        .order("found_at", { ascending: false })
        .order("id")
        .range(offset, offset + 999);
      query = trash
        ? query.not("deleted_at", "is", null)
        : query.is("deleted_at", null);
      if (bounds.from) query = query.gte("found_at", bounds.from);
      if (bounds.to) query = query.lt("found_at", bounds.to);
      if (bidderId) query = query.eq("bidder_id", z.uuid().parse(bidderId));
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return { data: rows };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not load bids",
    };
  }
}

export async function updateBidCell(
  bid: string,
  field: string,
  value: string,
  version: number,
) {
  return perform(
    async () =>
      (await rpc("update_bid_cell", {
        p_bid: z.uuid().parse(bid),
        p_field: field,
        p_value:
          field === "url"
            ? normalizeJobUrl(value)
            : z.string().max(8192).parse(value),
        p_version: z.number().int().nonnegative().parse(version),
      })) as {
        ok?: boolean;
        conflict?: boolean;
        row: import("@/lib/database.types").Row<"bids">;
      },
    false,
  );
}
export async function checkBidImport(
  resume: string,
  date: string,
  rows: import("@/lib/sheets").ImportRow[],
) {
  return perform(async () => {
    if (Buffer.byteLength(JSON.stringify(rows)) > 2 * 1024 * 1024)
      throw new Error("Import payload is too large");
    return (await rpc("validate_bid_import", {
      p_resume: z.uuid().parse(resume),
      p_date: date,
      p_rows: rows.map((row) => ({ ...row, url: normalizeJobUrl(row.url) })),
    })) as import("@/lib/sheets").ImportError[];
  }, false);
}
export async function importBids(
  resume: string,
  date: string,
  rows: import("@/lib/sheets").ImportRow[],
  request: string,
) {
  return perform(async () => {
    if (Buffer.byteLength(JSON.stringify(rows)) > 2 * 1024 * 1024)
      throw new Error("Import payload is too large");
    return (await rpc("import_bids", {
      p_resume: z.uuid().parse(resume),
      p_date: date,
      p_rows: rows.map((row) => ({ ...row, url: normalizeJobUrl(row.url) })),
      p_request: z.uuid().parse(request),
    })) as {
      ids?: string[];
      errors?: import("@/lib/sheets").ImportError[];
      date: string;
      bidder: string;
      resume: string;
    };
  });
}
