import { PGlite } from "@electric-sql/pglite";
import { readFileSync, writeFileSync } from "node:fs";
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
alter table storage.objects enable row level security;`);
await db.exec(
  readFileSync("supabase/migrations/202609290001_platform.sql", "utf8"),
);
const map = (type) =>
  /\[\]$/.test(type)
    ? `${map(type.slice(0, -2))}[]`
    : [
          "integer",
          "bigint",
          "smallint",
          "numeric",
          "double precision",
          "real",
        ].includes(type)
      ? "number"
      : type === "boolean"
        ? "boolean"
        : type === "void"
          ? "undefined"
          : "string";
const { rows: columns } = await db.query(
  `select table_name,column_name,data_type,udt_name,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
);
let out =
  "// Generated from the SQL migration by scripts/generate-types.mjs. Do not edit.\nexport type Database = { public: { Tables: {\n";
for (const table of [...new Set(columns.map((c) => c.table_name))]) {
  const props = columns
    .filter((c) => c.table_name === table)
    .map(
      (c) =>
        `${c.column_name}: ${c.data_type === "ARRAY" ? "string[]" : map(c.data_type)}${c.is_nullable === "YES" ? " | null" : ""}`,
    )
    .join("; ");
  out += `${table}: { Row: { ${props} }; Insert: Partial<{ ${props} }>; Update: Partial<{ ${props} }>; Relationships: [] };\n`;
}
out += "}; Views: { [_ in never]: never }; Functions: {\n";
const { rows: fns } = await db.query(
  `select proname,proargnames,oidvectortypes(proargtypes) as args,pg_get_function_result(oid) as result from pg_proc where pronamespace='public'::regnamespace and prorettype<>'trigger'::regtype`,
);
for (const f of fns) {
  const types = f.args ? f.args.split(", ") : [];
  out += `${f.proname}: { Args: ${types.length ? "{ " + types.map((t, i) => `${f.proargnames[i]}: ${map(t)} | null`).join("; ") + " }" : "Record<string, never>"}; Returns: ${map(f.result)} };\n`;
}
out +=
  '}; Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never } } };\nexport type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];\n';
writeFileSync("src/lib/database.types.ts", out);
await db.close();
console.log("Generated database types from the executable migration.");
