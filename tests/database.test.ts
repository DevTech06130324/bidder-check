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
