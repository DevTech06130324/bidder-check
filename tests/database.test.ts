import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

let db: PGlite;
const client = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const bidder = "00000000-0000-4000-8000-000000000003";
let workspace: string, resume: string, bid: string, file: string;
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 grant usage on schema auth, storage to authenticated, service_role;
 grant all on storage.objects to authenticated,service_role;
 `);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await db.query(
    "insert into auth.users(id,email) values ($1,'client@test.com'),($2,'other@test.com')",
    [client, other],
  );
  await db.exec(`do $$ begin
    if exists(select 1 from information_schema.columns where table_name='profiles' and column_name='approval_status') then
      update public.profiles set approval_status='approved';
    end if;
  end $$;`);
  await asUser(client);
  workspace = (
    await db.query<{ id: string }>("select id from public.workspaces")
  ).rows[0].id;
  await db.query(
    "select public.invite_bidder($1,'bidder@test.com','Jordan',125)",
    [workspace],
  );
  await db.exec("reset role");
  await db.query(
    "update public.invitations set id=$1 where email='bidder@test.com'",
    [bidder],
  );
  await db.query(
    "insert into auth.users(id,email,raw_app_meta_data) select $1,'bidder@test.com',jsonb_build_object('bidder_provisioning_id',id) from public.invitations where email='bidder@test.com'",
    [bidder],
  );
  await asUser(client);
  resume = (
    await db.query<{ id: string }>(
      "select public.save_resume(null,$1,$2,'ENG-01','Jordan','jordan@test.com','','','','Instructions',null) as id",
      [workspace, bidder],
    )
  ).rows[0].id;
  await asUser(bidder);
  bid = (
    await db.query<{ id: string }>(
      "select public.save_bid(null,$1,'Acme','Engineer','https://example.com/jobs?id=1&utm_source=x','LinkedIn','remote','open') as id",
      [resume],
    )
  ).rows[0].id;
}, 60000);
afterAll(async () => {
  await db?.close();
});
it("keeps invitations pending until email confirmation and supports retries", async () => {
  await asUser(client);
  const pending = await db.query<{ accepted_at: string | null }>(
    "select accepted_at from public.invitations where email='bidder@test.com'",
  );
  expect(pending.rows[0].accepted_at).toBeNull();
  await expect(
    db.query("select public.invite_bidder($1,'bidder@test.com','Jordan',125)", [
      workspace,
    ]),
  ).resolves.toBeDefined();
  await asUser(other);
  const otherWorkspace = (
    await db.query<{ id: string }>("select id from public.workspaces")
  ).rows[0].id;
  await expect(
    db.query("select public.invite_bidder($1,'bidder@test.com','Hijack',500)", [
      otherWorkspace,
    ]),
  ).rejects.toThrow();
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    bidder,
  ]);
  await asUser(client);
  expect(
    (
      await db.query<{ accepted_at: string | null }>(
        "select accepted_at from public.invitations where email='bidder@test.com'",
      )
    ).rows[0].accepted_at,
  ).not.toBeNull();
});
it("private storage is tenant scoped and immutable", async () => {
  await asUser(bidder);
  const upload = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'test.png','image/png',100) as id",
      [bid],
    )
  ).rows[0].id;
  const path = (
    await db.query<{ storage_path: string }>(
      "select storage_path from public.files where id=$1",
      [upload],
    )
  ).rows[0].storage_path;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('private-files',$1)",
    [path],
  );
  await asUser(other);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      "insert into storage.objects(bucket_id,name) values('private-files',$1)",
      [path + "/fake"],
    ),
  ).rejects.toThrow();
  await asUser(bidder);
  expect(
    (
      await db.query(
        "update storage.objects set metadata='{}' where name=$1 returning id",
        [path],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query("delete from storage.objects where name=$1 returning id", [
        path,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("isolates tenants and protects roles from direct writes", async () => {
  await asUser(other);
  expect((await db.query("select * from public.bids")).rows).toHaveLength(0);
  expect((await db.query("select * from public.resumes")).rows).toHaveLength(0);
  await expect(
    db.query("update public.profiles set role='admin' where id=$1", [other]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.set_applied($1,false,null,'correction')", [bid]),
  ).rejects.toThrow();
});
it("prevents bidder editing resume and duplicate normalized jobs", async () => {
  await asUser(bidder);
  await expect(
    db.query(
      "select public.save_resume($1,$2,$3,'ENG-01','bad','','','','','',null)",
      [resume, workspace, bidder],
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      "select public.save_bid(null,$1,'Acme','Engineer','https://EXAMPLE.com/jobs?utm_campaign=x&id=1','Indeed','remote','open')",
      [resume],
    ),
  ).rejects.toThrow();
});
it("normalizes equivalent raw-RPC URLs before enforcing uniqueness", async () => {
  await asUser(bidder);
  for (const url of [
    "https://example.com:443/jobs?id=1",
    "https://example.com/a/../jobs?id=1",
    "https://example.com/jobs?%75tm_source=x&id=1",
    "https://example.com/jobs?%69d=1",
  ]) {
    await expect(
      db.query(
        "select public.save_bid(null,$1,'Acme','Engineer',$2,'Indeed','remote','open')",
        [resume, url],
      ),
    ).rejects.toThrow();
  }
});
it("verified uploads apply atomically, replace proof, reject corrected content and preserve earnings", async () => {
  await asUser(bidder);
  await expect(
    db.query("select public.set_applied($1,true,null,null)", [bid]),
  ).rejects.toThrow();
  const prepare = async () =>
    (
      await db.query<{ id: string }>(
        "select public.prepare_file('screenshot',$1,'proof.png','image/png',100) id",
        [bid],
      )
    ).rows[0].id;
  const finish = async (id: string, hash: string) => {
    await db.exec("reset role; set role service_role");
    return db.query("select public.finalize_verified_file($1,$2,$3)", [
      id,
      hash.repeat(64),
      bidder,
    ]);
  };
  file = await prepare();
  await finish(file, "a");
  await asUser(bidder);
  const first = (
    await db.query<{
      applied: boolean;
      rate_cents: number;
      first_applied_at: string;
      applied_at: string;
    }>("select * from public.bids where id=$1", [bid])
  ).rows[0];
  expect(first.applied).toBe(true);
  expect(first.rate_cents).toBe(125);
  const replacement = await prepare();
  await finish(replacement, "b");
  await finish(replacement, "b");
  await asUser(bidder);
  const replaced = (
    await db.query<typeof first>("select * from public.bids where id=$1", [bid])
  ).rows[0];
  expect(replaced.first_applied_at).toEqual(first.first_applied_at);
  expect(new Date(replaced.applied_at).getTime()).toBeGreaterThan(
    new Date(first.applied_at).getTime(),
  );
  expect(
    (
      await db.query(
        "select * from public.bid_events where event='proof_replaced' and bid_id=$1",
        [bid],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query("select public.set_applied($1,false,null,'bad')", [bid]),
  ).rejects.toThrow("Access denied");
  await asUser(client);
  await db.query("select public.update_bidder($1,'Jordan',999,false)", [
    bidder,
  ]);
  await expect(
    db.query("select public.set_applied($1,false,null,'')", [bid]),
  ).rejects.toThrow();
  await db.query(
    "select public.set_applied($1,false,null,'Wrong confirmation')",
    [bid],
  );
  await asUser(bidder);
  const rejected = await prepare();
  await expect(finish(rejected, "b")).rejects.toThrow("previously rejected");
  await asUser(bidder);
  expect(
    (
      await db.query<{ finalized: boolean }>(
        "select finalized from public.files where id=$1",
        [rejected],
      )
    ).rows[0].finalized,
  ).toBe(false);
  const fresh = await prepare();
  await finish(fresh, "c");
  await asUser(bidder);
  expect(
    (
      await db.query<{ rate_cents: number }>(
        "select rate_cents from public.bids where id=$1",
        [bid],
      )
    ).rows[0].rate_cents,
  ).toBe(125);
});
it("revokes archived bidder access but retains client history", async () => {
  await asUser(client);
  await db.query("select public.update_bidder($1,'Jordan',125,true)", [bidder]);
  await asUser(bidder);
  expect((await db.query("select * from public.bids")).rows).toHaveLength(0);
  await expect(
    db.query("select public.set_applied($1,false,null,'undo')", [bid]),
  ).rejects.toThrow();
  await asUser(client);
  expect((await db.query("select * from public.bids")).rows).toHaveLength(1);
});
it("ignores client-supplied role metadata on signup", async () => {
  await db.exec("reset role");
  const attacker = "00000000-0000-4000-8000-000000000009";
  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data) values($1,\'attacker@test.com\',\'{"role":"admin","workspace_id":"anything"}\')',
    [attacker],
  );
  await asUser(attacker);
  expect(
    (
      await db.query<{ role: string }>(
        "select role from public.profiles where id=$1",
        [attacker],
      )
    ).rows[0].role,
  ).toBe("client");
  expect((await db.query("select * from public.bids")).rows).toHaveLength(0);
});
it("isolates peers, accepts explicit zero rates, and locks applied resume assignment", async () => {
  await asUser(client);
  const peer = "00000000-0000-4000-8000-000000000004";
  await db.query(
    "select public.invite_bidder($1,'peer@test.com','Peer',null)",
    [workspace],
  );
  await db.exec("reset role");
  await db.query(
    "update public.invitations set id=$1 where email='peer@test.com'",
    [peer],
  );
  await db.query(
    "insert into auth.users(id,email,raw_app_meta_data) select $1,'peer@test.com',jsonb_build_object('bidder_provisioning_id',id) from public.invitations where email='peer@test.com'",
    [peer],
  );
  await asUser(client);
  const r = (
    await db.query<{ id: string }>(
      "select public.save_resume(null,$1,$2,'PEER-01','Peer','','','','','',null) id",
      [workspace, peer],
    )
  ).rows[0].id;
  const r2 = (
    await db.query<{ id: string }>(
      "select public.save_resume(null,$1,$2,'PEER-02','Peer','','','','','',0) id",
      [workspace, peer],
    )
  ).rows[0].id;
  await asUser(peer);
  expect(
    (await db.query("select * from public.bids where id=$1", [bid])).rows,
  ).toHaveLength(0);
  await expect(
    db.query(
      "select public.prepare_file('resume',$1,'file.pdf','application/pdf',100)",
      [r],
    ),
  ).rejects.toThrow();
  const fresh = (
    await db.query<{ id: string }>(
      "select public.save_bid(null,$1,'Acme','Engineer','https://example.com/jobs?id=1','Indeed','remote','open') id",
      [r],
    )
  ).rows[0].id;
  const proof = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'proof.png','image/png',100) id",
      [fresh],
    )
  ).rows[0].id;
  await db.exec("reset role;set role service_role");
  await expect(
    db.query("select public.finalize_verified_file($1,$2,$3)", [
      proof,
      "d".repeat(64),
      peer,
    ]),
  ).rejects.toThrow("configure a bid rate");
  await asUser(client);
  await db.query(
    "select public.save_resume($1,$2,$3,'PEER-01','Peer','','','','','',0)",
    [r, workspace, peer],
  );
  await db.exec("reset role;set role service_role");
  await Promise.all([
    db.query("select public.finalize_verified_file($1,$2,$3)", [
      proof,
      "d".repeat(64),
      peer,
    ]),
    db.query("select public.finalize_verified_file($1,$2,$3)", [
      proof,
      "d".repeat(64),
      peer,
    ]),
  ]);
  await asUser(peer);
  expect(
    (
      await db.query<{ rate_cents: number }>(
        "select rate_cents from public.bids where id=$1",
        [fresh],
      )
    ).rows[0].rate_cents,
  ).toBe(0);
  expect(
    (
      await db.query(
        "select * from public.bid_events where bid_id=$1 and event='applied'",
        [fresh],
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    db.query(
      "select public.save_bid($1,$2,'Acme','Engineer','https://example.com/jobs?id=1','Indeed','remote','open')",
      [fresh, r2],
    ),
  ).rejects.toThrow("resume assignment");
});
it("bidder provisioning requires a server-assigned Auth identity and rejects signup metadata", async () => {
  await asUser(client);
  await db.query(
    "select public.invite_bidder($1,'reserved@test.com','Reserved',100)",
    [workspace],
  );
  await db.exec("reset role");
  const reserved = (
    await db.query<{ id: string }>(
      "select id from public.invitations where email='reserved@test.com'",
    )
  ).rows[0].id;
  await expect(
    db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'reserved@test.com',$1)",
      [JSON.stringify({ bidder_provisioning_id: reserved })],
    ),
  ).rejects.toThrow("reserved");
  const created = reserved;
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'reserved@test.com',now())",
    [created],
  );
  expect(
    (
      await db.query<{ role: string }>(
        "select role from public.profiles where id=$1",
        [created],
      )
    ).rows[0].role,
  ).toBe("bidder");
  expect(
    (
      await db.query<{ accepted_at: string }>(
        "select accepted_at from public.invitations where id=$1",
        [reserved],
      )
    ).rows[0].accepted_at,
  ).not.toBeNull();
});
it("admin can manage clients and archived client access is revoked", async () => {
  await db.exec("reset role");
  const admin = "00000000-0000-4000-8000-000000000005";
  await db.query(
    "insert into auth.users(id,email) values($1,'admin@test.com')",
    [admin],
  );
  await db.query("update public.profiles set role='admin' where id=$1", [
    admin,
  ]);
  await asUser(admin);
  expect(
    (await db.query("select * from public.bids")).rows.length,
  ).toBeGreaterThan(1);
  await db.query("select public.update_client($1,'Client',true)", [client]);
  await asUser(client);
  expect((await db.query("select * from public.bids")).rows).toHaveLength(0);
  await asUser("00000000-0000-4000-8000-000000000004");
  expect((await db.query("select * from public.bids")).rows).toHaveLength(0);
  await asUser(admin);
  expect(
    (await db.query("select * from public.bids")).rows.length,
  ).toBeGreaterThan(1);
});

it("public signup remains pending despite forged approval metadata and has no workspace access", async () => {
  await db.exec("reset role");
  const pending = "00000000-0000-4000-8000-000000000020";
  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,'pending@test.com',$2)",
    [pending, JSON.stringify({ approval_status: "approved", role: "admin" })],
  );
  await asUser(pending);
  const profile = (
    await db.query<{ approval_status: string }>(
      "select * from public.profiles where id=$1",
      [pending],
    )
  ).rows[0];
  expect(profile.approval_status).toBe("pending");
  expect((await db.query("select * from public.workspaces")).rows).toHaveLength(
    0,
  );
  await expect(
    db.query("select public.invite_bidder($1,'bad@test.com','Bad',1)", [
      workspace,
    ]),
  ).rejects.toThrow("Access denied");
});

it("only admins approve or reject clients and rejection needs a reason", async () => {
  const pending = "00000000-0000-4000-8000-000000000020";
  await asUser(pending);
  await expect(
    db.query("select public.review_client($1,'approved',null)", [pending]),
  ).rejects.toThrow();
  await asUser("00000000-0000-4000-8000-000000000005");
  await expect(
    db.query("select public.review_client($1,'rejected','')", [pending]),
  ).rejects.toThrow();
  await db.query("select public.review_client($1,'rejected','Needs review')", [
    pending,
  ]);
  await asUser(pending);
  expect(
    (
      await db.query<{ approval_reason: string }>(
        "select approval_reason from public.profiles where id=$1",
        [pending],
      )
    ).rows[0].approval_reason,
  ).toBe("Needs review");
  expect((await db.query("select * from public.workspaces")).rows).toHaveLength(
    0,
  );
  await asUser("00000000-0000-4000-8000-000000000005");
  await db.query("select public.review_client($1,'approved',null)", [pending]);
  await asUser(pending);
  expect((await db.query("select * from public.workspaces")).rows).toHaveLength(
    1,
  );
});

it("bid trash is reversible, serializes with proof, and retains duplicate protection", async () => {
  await asUser("00000000-0000-4000-8000-000000000005");
  await db.query("select public.update_client($1,'Client',false)", [client]);
  await asUser(client);
  await db.query("select public.update_bidder($1,'Jordan',125,false)", [
    bidder,
  ]);
  await asUser(bidder);
  const before = (
    await db.query<{ applied: boolean; rate_cents: number; found_at: string }>(
      "select * from public.bids where id=$1",
      [bid],
    )
  ).rows[0];
  const pendingFile = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'proof.png','image/png',100) id",
      [bid],
    )
  ).rows[0].id;
  await db.query("select public.trash_bid($1,true)", [bid]);
  await db.exec("reset role; set role service_role");
  await expect(
    db.query("select public.finalize_verified_file($1,$2,$3)", [
      pendingFile,
      "e".repeat(64),
      bidder,
    ]),
  ).rejects.toThrow("trash");
  await asUser(other);
  await expect(
    db.query("select public.trash_bid($1,false)", [bid]),
  ).rejects.toThrow("Access denied");
  await asUser(bidder);
  await expect(
    db.query(
      "select public.save_bid(null,$1,'Acme','Engineer','https://example.com/jobs?id=1','Indeed','remote','open')",
      [resume],
    ),
  ).rejects.toThrow("restore");
  await db.query("select public.trash_bid($1,false)", [bid]);
  await db.query("select public.trash_bid($1,false)", [bid]);
  const restored = (
    await db.query<typeof before & { deleted_at: null }>(
      "select * from public.bids where id=$1",
      [bid],
    )
  ).rows[0];
  expect(restored.deleted_at).toBeNull();
  expect(restored.rate_cents).toBe(before.rate_cents);
  expect(restored.applied).toBe(before.applied);
  expect(restored.found_at).toEqual(before.found_at);
  expect(
    (
      await db.query(
        "select * from public.bid_events where bid_id=$1 and event='restored'",
        [bid],
      )
    ).rows,
  ).toHaveLength(1);
});
it("found time cannot be supplied or changed through APIs", async () => {
  await asUser(bidder);
  await expect(
    db.query(
      "select public.save_bid(null,$1,'Backdated','Engineer','https://example.com/backdated','Indeed','remote','open','2000-01-01')",
      [resume],
    ),
  ).rejects.toThrow();
  const before = (
    await db.query<{ found_at: string }>(
      "select found_at from public.bids where id=$1",
      [bid],
    )
  ).rows[0].found_at;
  await db.query(
    "select public.save_bid($1,$2,'Updated','Engineer','https://example.com/jobs?id=1','Indeed','remote','open')",
    [bid, resume],
  );
  expect(
    (
      await db.query<{ found_at: string }>(
        "select found_at from public.bids where id=$1",
        [bid],
      )
    ).rows[0].found_at,
  ).toEqual(before);
  await expect(
    db.query("update public.bids set found_at='2000-01-01' where id=$1", [bid]),
  ).rejects.toThrow();
});
it("managed credentials are scoped and Auth email edits synchronize atomically", async () => {
  await asUser(client);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.can_manage_account($1) allowed",
        [bidder],
      )
    ).rows[0].allowed,
  ).toBe(true);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.can_manage_account($1) allowed",
        [other],
      )
    ).rows[0].allowed,
  ).toBe(false);
  await asUser(bidder);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.can_manage_account($1) allowed",
        [bidder],
      )
    ).rows[0].allowed,
  ).toBe(false);
  await db.exec("reset role");
  await db.query("update auth.users set email='changed@test.com' where id=$1", [
    bidder,
  ]);
  expect(
    (
      await db.query<{ email: string }>(
        "select email from public.profiles where id=$1",
        [bidder],
      )
    ).rows[0].email,
  ).toBe("changed@test.com");
  await expect(
    db.query("update auth.users set email='other@test.com' where id=$1", [
      bidder,
    ]),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ email: string }>(
        "select email from auth.users where id=$1",
        [bidder],
      )
    ).rows[0].email,
  ).toBe("changed@test.com");
});
it("admin cannot use bidder editing to mutate a client or nonexistent account", async () => {
  await asUser("00000000-0000-4000-8000-000000000005");
  await expect(
    db.query("select public.update_bidder($1,'Wrong target',0,true)", [client]),
  ).rejects.toThrow("Bidder not found");
});
it("an old bidder email can be reused with a fresh identity after an email change", async () => {
  await asUser(other);
  const w = (await db.query<{ id: string }>("select id from public.workspaces"))
    .rows[0].id;
  const reservation = (
    await db.query<{ id: string }>(
      "select public.invite_bidder($1,'bidder@test.com','Replacement',100) id",
      [w],
    )
  ).rows[0].id;
  expect(reservation).not.toBe(bidder);
  await db.exec("reset role");
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'bidder@test.com',now())",
    [reservation],
  );
  expect(
    (
      await db.query<{ email: string }>(
        "select email from public.profiles where id=$1",
        [bidder],
      )
    ).rows[0].email,
  ).toBe("changed@test.com");
});

it("pending clients cannot mutate settings through direct RPC", async () => {
  await db.exec("reset role");
  const pending = "00000000-0000-4000-8000-000000000031";
  await db.query(
    "insert into auth.users(id,email) values($1,'settings-pending@test.com')",
    [pending],
  );
  await asUser(pending);
  await expect(
    db.query(
      "select public.save_settings('New name',null,'','America/Chicago')",
    ),
  ).rejects.toThrow("Access denied");
});
it("imports atomically with receipts and version-checks individual cells", async () => {
  await asUser(client);
  const rid = (
    await db.query<{ id: string }>(
      "select public.save_resume(null,$1,$2,'SHEET-01','Jordan','jordan@test.com','','','','Instructions',null) id",
      [workspace, bidder],
    )
  ).rows[0].id;
  await asUser(bidder);
  const rows = [
    {
      company: "Sheets Inc",
      role_name: "Engineer",
      url: "https://example.com/sheet/1",
      source: "Google",
      arrangement: "remote",
      job_status: "open",
    },
  ];
  const request = "00000000-0000-4000-8000-000000000099";
  const run = async (values = rows, key = request) =>
    (
      await db.query<{ result: { ids: string[]; errors?: unknown[] } }>(
        "select public.import_bids($1,'2026-03-08',$2::jsonb,$3) result",
        [rid, JSON.stringify(values), key],
      )
    ).rows[0].result;
  const first = await run();
  expect(first.ids).toHaveLength(1);
  expect(await run()).toEqual(first);
  await expect(run([{ ...rows[0], company: "Changed" }])).rejects.toThrow(
    /different content/,
  );
  const b = (
    await db.query<{
      found_at: Date;
      created_at: Date;
      version: number;
      applied: boolean;
    }>("select * from public.bids where id=$1", [first.ids[0]])
  ).rows[0];
  expect(new Date(b.found_at).toISOString()).toBe("2026-03-08T06:00:00.000Z");
  expect(b.applied).toBe(false);
  expect(new Date(b.created_at).getTime()).toBeGreaterThan(
    new Date(b.found_at).getTime(),
  );
  const edit = async (version: number, field = "company", value = "Updated") =>
    (
      await db.query<{
        result: {
          ok: boolean;
          conflict?: boolean;
          row: { company: string; version: number };
        };
      }>("select public.update_bid_cell($1,$2,$3,$4) result", [
        first.ids[0],
        field,
        value,
        version,
      ])
    ).rows[0].result;
  expect((await edit(b.version)).ok).toBe(true);
  const stale = await edit(b.version);
  expect(stale.conflict).toBe(true);
  expect(stale.row.company).toBe("Updated");
  await expect(
    edit(stale.row.version, "found_at", "2020-01-01"),
  ).rejects.toThrow(/editable/);
  await asUser(other);
  await expect(edit(stale.row.version)).rejects.toThrow(/Access denied/);
  await asUser(bidder);
  await db.query("select public.trash_bid($1,true)", [first.ids[0]]);
  const duplicate = await run(
    [rows[0], { ...rows[0], url: "https://example.com/sheet/2" }],
    "00000000-0000-4000-8000-000000000098",
  );
  expect(JSON.stringify(duplicate.errors)).toMatch(/restore/i);
  expect(
    (
      await db.query(
        "select id from public.bids where url='https://example.com/sheet/2'",
      )
    ).rows,
  ).toHaveLength(0);
  await expect(edit(stale.row.version)).rejects.toThrow(/trash/);
  const invalid = await run(
    [{ ...rows[0], url: "javascript:alert(1)" }],
    "00000000-0000-4000-8000-000000000097",
  );
  expect(invalid.errors?.length).toBeGreaterThan(0);
});
it("imports enforce limits, permissions, dates, receipt privacy and locked resumes", async () => {
  await asUser(bidder);
  const rid = (
    await db.query<{ id: string }>(
      "select id from public.resumes where identifier='SHEET-01'",
    )
  ).rows[0].id;
  const row = {
    company: "A",
    role_name: "R",
    url: "https://example.com/batch/new",
    source: "",
    arrangement: "remote",
    job_status: "open",
  };
  const validate = async (rows: unknown, date = "2026-11-01") =>
    db.query("select public.validate_bid_import($1,$2,$3::jsonb)", [
      rid,
      date,
      JSON.stringify(rows),
    ]);
  await expect(validate([row], "2999-01-01")).rejects.toThrow(/future/);
  await expect(
    validate(
      Array.from({ length: 501 }, () => row),
      "2026-03-08",
    ),
  ).rejects.toThrow(/500/);
  await asUser(other);
  await expect(validate([row], "2026-03-08")).rejects.toThrow(/Access denied/);
  expect(
    (await db.query("select * from public.bid_import_receipts")).rows,
  ).toHaveLength(0);
  await asUser("00000000-0000-4000-8000-000000000005");
  await db.query("select public.update_client($1,'Client',true)", [client]);
  await asUser(bidder);
  expect(
    (await db.query("select * from public.bid_import_receipts")).rows,
  ).toHaveLength(0);
  await expect(validate([row], "2026-03-08")).rejects.toThrow(/Access denied/);
  await asUser("00000000-0000-4000-8000-000000000005");
  await db.query("select public.update_client($1,'Client',false)", [client]);
  await asUser(bidder);
  const applied = (
    await db.query<{ id: string; version: number }>(
      "select id,version from public.bids where first_applied_at is not null and deleted_at is null limit 1",
    )
  ).rows[0];
  await expect(
    db.query("select public.update_bid_cell($1,'resume_id',$2,$3)", [
      applied.id,
      rid,
      applied.version,
    ]),
  ).rejects.toThrow(/locked/);
});
it("canonicalizes raw Unicode/spaces and rejects invalid HTTP authorities in database writes", async () => {
  await db.exec("reset role");
  const normalize = async (url: string) =>
    (
      await db.query<{ u: string }>("select public.normalize_job_url($1) u", [
        url,
      ])
    ).rows[0].u;
  expect(await normalize("https://example.com/r\u00e9sum\u00e9")).toBe(
    await normalize("https://example.com/r%C3%A9sum%C3%A9"),
  );
  expect(await normalize("https://example.com/job here")).toBe(
    await normalize("https://example.com/job%20here"),
  );
  await expect(normalize("https://example.com:99999/job")).rejects.toThrow();
  await expect(normalize("https://127.1/job")).rejects.toThrow();
  expect(await normalize("https://example.com:00444/a")).toBe(
    "https://example.com:444/a",
  );
  await asUser(bidder);
  const rid = (
    await db.query<{ id: string }>(
      "select id from public.resumes where identifier='SHEET-01'",
    )
  ).rows[0].id;
  const id = (
    await db.query<{ id: string }>(
      "select public.save_bid(null,$1,'Unicode','Role','https://example.com/r%C3%A9sum%C3%A9','','remote','open') id",
      [rid],
    )
  ).rows[0].id;
  await db.query("select public.trash_bid($1,true)", [id]);
  const errors = (
    await db.query<{ e: { message: string }[] }>(
      "select public.validate_bid_import($1,'2026-03-08',$2::jsonb) e",
      [
        rid,
        JSON.stringify([
          {
            company: "A",
            role_name: "R",
            url: "https://example.com/r\u00e9sum\u00e9",
            source: "",
            arrangement: "remote",
            job_status: "open",
          },
        ]),
      ],
    )
  ).rows[0].e;
  expect(errors[0].message).toMatch(/restore/);
});
it("commits the maximum 500-row batch once and preserves original results on retry", async () => {
  await asUser(bidder);
  const rid = (
    await db.query<{ id: string }>(
      "select id from public.resumes where identifier='SHEET-01'",
    )
  ).rows[0].id;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    company: `Capacity ${i}`,
    role_name: "Engineer",
    url: `https://example.com/capacity/${i}`,
    source: "",
    arrangement: "remote",
    job_status: "open",
  }));
  const args = [
    rid,
    JSON.stringify(rows),
    "00000000-0000-4000-8000-000000000096",
  ];
  const first = (
    await db.query<{ r: { ids: string[] } }>(
      "select public.import_bids($1,'2025-10-01',$2::jsonb,$3) r",
      args,
    )
  ).rows[0].r;
  expect(first.ids).toHaveLength(500);
  expect(
    (
      await db.query<{ r: unknown }>(
        "select public.import_bids($1,'2025-10-01',$2::jsonb,$3) r",
        args,
      )
    ).rows[0].r,
  ).toEqual(first);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.bids where url like 'https://example.com/capacity/%'",
      )
    ).rows[0].n,
  ).toBe(500);
});
it("bulk mutations are atomic and permanent deletion is manager-only, snapshot-bound and retry-safe", async () => {
  await asUser(bidder);
  const targets = (
    await db.query<{ id: string; version: number }>(
      "select id,version from public.bids where url like 'https://example.com/capacity/%' order by id limit 2",
    )
  ).rows;
  await expect(
    db.query("select public.bulk_bid_state($1::jsonb,true)", [
      JSON.stringify([targets[0], { ...targets[1], version: -1 }]),
    ]),
  ).rejects.toThrow(/changed/i);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.bids where id=$1 and deleted_at is null",
        [targets[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  await db.query("select public.bulk_bid_state($1::jsonb,true)", [
    JSON.stringify(targets),
  ]);
  const trashed = targets.map((t) => ({ ...t, version: t.version + 1 }));
  await expect(
    db.query("select public.prepare_bid_purge('selected',$1::jsonb,null)", [
      JSON.stringify(trashed),
    ]),
  ).rejects.toThrow(/manager|denied/i);
  await asUser(client);
  const op = (
    await db.query<{ r: { id: string; count: number } }>(
      "select public.prepare_bid_purge('selected',$1::jsonb,null) r",
      [JSON.stringify(trashed)],
    )
  ).rows[0].r;
  expect(op.count).toBe(2);
  await asUser(other);
  await expect(
    db.query("select public.confirm_bid_purge($1)", [op.id]),
  ).rejects.toThrow(/denied/i);
  await asUser(client);
  const deleted = (
    await db.query<{ r: { deletedCount: number } }>(
      "select public.confirm_bid_purge($1) r",
      [op.id],
    )
  ).rows[0].r;
  expect(deleted.deletedCount).toBe(2);
  expect(
    (
      await db.query<{ r: unknown }>("select public.confirm_bid_purge($1) r", [
        op.id,
      ])
    ).rows[0].r,
  ).toEqual(deleted);
  expect(
    (
      await db.query("select id from public.bids where id=any($1::uuid[])", [
        targets.map((t) => t.id),
      ])
    ).rows,
  ).toHaveLength(0);
  await asUser(bidder);
  const receipt = (
    await db.query<{ result: { ids: string[] }; payload_hash: string }>(
      "select * from public.bid_import_receipts where request_id=$1",
      ["00000000-0000-4000-8000-000000000096"],
    )
  ).rows[0];
  expect(receipt.payload_hash).toHaveLength(64);
  const rid = (
    await db.query<{ id: string }>(
      "select id from public.resumes where identifier='SHEET-01'",
    )
  ).rows[0].id;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    company: `Capacity ${i}`,
    role_name: "Engineer",
    url: `https://example.com/capacity/${i}`,
    source: "",
    arrangement: "remote",
    job_status: "open",
  }));
  const replay = (
    await db.query<{ r: { purgedCount: number } }>(
      "select public.import_bids($1,'2025-10-01',$2::jsonb,$3) r",
      [rid, JSON.stringify(rows), "00000000-0000-4000-8000-000000000096"],
    )
  ).rows[0].r;
  expect(replay.purgedCount).toBe(2);
});

it("purge rejects expired/changed snapshots, isolates scope and cleans unfinished proof in leased passes", async () => {
  await asUser(bidder);
  const make = async (suffix: string) =>
    (
      await db.query<{ id: string }>(
        "select public.save_bid(null,$1,'Purge','Engineer',$2,'','remote','open') id",
        [resume, `https://example.com/purge/${suffix}`],
      )
    ).rows[0].id;
  const one = await make("one"),
    two = await make("two");
  const proof = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'unfinished.png','image/png',100) id",
      [one],
    )
  ).rows[0].id;
  await db.query("select public.trash_bid($1,true)", [one]);
  await asUser(client);
  const prepare = async () =>
    (
      await db.query<{ r: { id: string; count: number } }>(
        "select public.prepare_bid_purge('selected',(select jsonb_agg(jsonb_build_object('id',id,'version',version)) from public.bids where id=$1),$2) r",
        [one, bidder],
      )
    ).rows[0].r;
  const stale = await prepare();
  await db.query("select public.trash_bid($1,false)", [one]);
  await expect(
    db.query("select public.confirm_bid_purge($1)", [stale.id]),
  ).rejects.toThrow(/changed/i);
  await db.query("select public.trash_bid($1,true)", [one]);
  const expired = await prepare();
  await db.exec("reset role");
  await db.query(
    "update public.bid_purge_operations set expires_at=now()-interval '1 second' where id=$1",
    [expired.id],
  );
  await asUser(client);
  await expect(
    db.query("select public.confirm_bid_purge($1)", [expired.id]),
  ).rejects.toThrow(/expired/i);
  const op = await prepare();
  await db.query("select public.trash_bid($1,true)", [two]);
  await db.query("select public.confirm_bid_purge($1)", [op.id]);
  expect(
    (await db.query("select id from public.bids where id=$1", [two])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select id from public.files where id=$1", [proof])).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select id from public.bid_events where bid_id=$1", [one]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select id from public.resumes where id=$1", [resume]))
      .rows,
  ).toHaveLength(1);
  await expect(
    db.query("select * from public.storage_cleanup_tasks"),
  ).rejects.toThrow(/permission/i);
  await expect(
    db.query("select public.claim_storage_cleanup(null,50)"),
  ).rejects.toThrow(/permission/i);
  await asUser(other);
  await expect(
    db.query("select public.retry_bid_cleanup($1)", [op.id]),
  ).rejects.toThrow(/denied/i);
  await asUser(client);
  const status = async () =>
    (
      await db.query<{
        r: {
          pendingFiles: number;
          verifyingFiles: number;
          failedFiles: number;
        };
      }>("select public.bid_purge_status($1) r", [op.id])
    ).rows[0].r;
  expect((await status()).pendingFiles).toBe(1);
  await db.exec("reset role;set role service_role");
  const claim = async () =>
    (
      await db.query<{ id: string; lease_id: string }>(
        "select * from public.claim_storage_cleanup($1,50)",
        [op.id],
      )
    ).rows;
  const task = (await claim())[0];
  expect(await claim()).toHaveLength(0);
  await db.query("select public.finish_storage_cleanup($1,$2,false)", [
    task.id,
    task.lease_id,
  ]);
  await asUser(client);
  expect((await status()).failedFiles).toBe(1);
  await db.query("select public.retry_bid_cleanup($1)", [op.id]);
  await db.exec("reset role;set role service_role");
  const retry = (await claim())[0];
  await db.query("select public.finish_storage_cleanup($1,$2,true)", [
    retry.id,
    retry.lease_id,
  ]);
  expect(await claim()).toHaveLength(0);
  await asUser(client);
  expect((await status()).verifyingFiles).toBe(1);
  await db.query("select public.retry_bid_cleanup($1)", [op.id]);
  await db.exec("reset role;set role service_role");
  expect(await claim()).toHaveLength(0);
  await db.query(
    "update public.storage_cleanup_tasks set next_attempt_at=now()-interval '1 second' where id=$1",
    [task.id],
  );
  const final = (await claim())[0];
  await db.query("select public.finish_storage_cleanup($1,$2,true)", [
    final.id,
    final.lease_id,
  ]);
  expect(
    (
      await db.query<{ storage_path: string | null }>(
        "select storage_path from public.storage_cleanup_tasks where id=$1",
        [task.id],
      )
    ).rows[0].storage_path,
  ).toBeNull();
  await asUser(client);
  expect((await status()).pendingFiles).toBe(0);
  await asUser(bidder);
  await expect(make("one")).resolves.toBeTruthy();
});

it("keeps older unfinished cleanup discoverable after newer completed purges", async () => {
  await db.exec("reset role");
  const old = (
    await db.query<{ id: string }>(
      "insert into public.bid_purge_operations(actor_id,scope,targets,count,completed_at) values($1,'Selected trashed bids','[]',1,now()-interval '1 day') returning id",
      [client],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.storage_cleanup_tasks(operation_id,storage_path,last_error) values($1,'synthetic/pending','retry pending')",
    [old],
  );
  await db.query(
    "insert into public.bid_purge_operations(actor_id,scope,targets,count,completed_at) select $1,'Selected trashed bids','[]',1,now() from generate_series(1,11)",
    [client],
  );
  await asUser(client);
  const status = (
    await db.query<{ r: { id: string }[] }>(
      "select public.recent_bid_purges() r",
    )
  ).rows[0].r;
  expect(status.map((o) => o.id)).toContain(old);
});
