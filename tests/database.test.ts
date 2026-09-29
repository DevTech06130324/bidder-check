import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";

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
 create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 grant usage on schema auth, storage to authenticated, service_role;
 grant all on storage.objects to authenticated,service_role;
 `);
  await db.exec(
    readFileSync("supabase/migrations/202609290001_platform.sql", "utf8"),
  );
  await db.query(
    "insert into auth.users(id,email) values ($1,'client@test.com'),($2,'other@test.com')",
    [client, other],
  );
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
    "insert into auth.users(id,email) values ($1,'bidder@test.com')",
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
      "select public.save_bid(null,$1,'Acme','Engineer','https://example.com/jobs?id=1&utm_source=x','LinkedIn','remote','open',now()) as id",
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
      "select public.save_bid(null,$1,'Acme','Engineer','https://EXAMPLE.com/jobs?utm_campaign=x&id=1','Indeed','remote','open',now())",
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
        "select public.save_bid(null,$1,'Acme','Engineer',$2,'Indeed','remote','open',now())",
        [resume, url],
      ),
    ).rejects.toThrow();
  }
});
it("requires finalized evidence, snapshots rate, and reverses earnings", async () => {
  await asUser(bidder);
  await expect(
    db.query("select public.set_applied($1,true,null,null)", [bid]),
  ).rejects.toThrow();
  file = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'proof.png','image/png',100) as id",
      [bid],
    )
  ).rows[0].id;
  await expect(
    db.query("select public.set_applied($1,true,$2,null)", [bid, file]),
  ).rejects.toThrow();
  await expect(
    db.query("select public.finalize_file($1,$2)", [file, "a".repeat(64)]),
  ).rejects.toThrow();
  await db.exec("reset role; set role service_role");
  await db.query("select public.finalize_file($1,$2)", [file, "a".repeat(64)]);
  await asUser(bidder);
  await db.query("select public.set_applied($1,true,$2,null)", [bid, file]);
  await db.query("select public.set_applied($1,true,$2,null)", [bid, file]);
  const rows = (
    await db.query<{ rate_cents: number; applied: boolean }>(
      "select rate_cents,applied from public.bids",
    )
  ).rows;
  expect(rows[0]).toEqual({ rate_cents: 125, applied: true });
  expect(
    (await db.query("select * from public.bid_events where event='applied'"))
      .rows,
  ).toHaveLength(1);
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
  await expect(
    db.query("select public.set_applied($1,true,$2,null)", [bid, file]),
  ).rejects.toThrow();
  const newer = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'proof2.png','image/png',100) as id",
      [bid],
    )
  ).rows[0].id;
  await db.exec("reset role; set role service_role");
  await db.query("select public.finalize_file($1,$2)", [newer, "a".repeat(64)]);
  await asUser(bidder);
  await expect(
    db.query("select public.set_applied($1,true,$2,null)", [bid, newer]),
  ).rejects.toThrow();
  const valid = (
    await db.query<{ id: string }>(
      "select public.prepare_file('screenshot',$1,'proof3.png','image/png',100) as id",
      [bid],
    )
  ).rows[0].id;
  await db.exec("reset role; set role service_role");
  await db.query("select public.finalize_file($1,$2)", [valid, "b".repeat(64)]);
  await asUser(bidder);
  await db.query("select public.set_applied($1,true,$2,null)", [bid, valid]);
  expect(
    (
      await db.query<{ rate_cents: number }>(
        "select rate_cents from public.bids",
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
    "insert into auth.users(id,email) values($1,'peer@test.com')",
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
      "select public.save_bid(null,$1,'Acme','Engineer','https://example.com/jobs?id=1','Indeed','remote','open',now()) id",
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
  await db.query("select public.finalize_file($1,$2)", [proof, "c".repeat(64)]);
  await asUser(peer);
  await expect(
    db.query("select public.set_applied($1,true,$2,null)", [fresh, proof]),
  ).rejects.toThrow("configure a bid rate");
  await asUser(client);
  await db.query(
    "select public.save_resume($1,$2,$3,'PEER-01','Peer','','','','','',0)",
    [r, workspace, peer],
  );
  await asUser(peer);
  await Promise.all([
    db.query("select public.set_applied($1,true,$2,null)", [fresh, proof]),
    db.query("select public.set_applied($1,true,$2,null)", [fresh, proof]),
  ]);
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
      "select public.save_bid($1,$2,'Acme','Engineer','https://example.com/jobs?id=1','Indeed','remote','open',now())",
      [fresh, r2],
    ),
  ).rejects.toThrow("resume assignment");
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
