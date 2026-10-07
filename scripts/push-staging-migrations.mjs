import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const stagingUrl = "https://kdmvludtvhuuewmhurpw.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== stagingUrl)
  throw new Error("Refusing database migration: this command is staging-only.");
const projectRef = "kdmvludtvhuuewmhurpw";
const databaseUrl = process.env.SUPABASE_DB_URL;
const connection = databaseUrl
  ? new URL(databaseUrl)
  : new URL(
      `postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    );
if (!databaseUrl && process.env.SUPABASE_DB_PASSWORD)
  connection.password = process.env.SUPABASE_DB_PASSWORD;
const validDirectConnection =
  connection.hostname === `db.${projectRef}.supabase.co` &&
  connection.username === "postgres";
const validSessionPoolerConnection =
  connection.hostname.endsWith(".pooler.supabase.com") &&
  connection.username === `postgres.${projectRef}`;
if (
  ![validDirectConnection, validSessionPoolerConnection].some(Boolean) ||
  connection.pathname !== "/postgres" ||
  !connection.password
)
  throw new Error(
    "Set SUPABASE_DB_URL to the exact staging Session Pooler URL, or provide the staging direct-connection password.",
  );
connection.searchParams.set("sslmode", "require");
const dnsResolver = process.env.SUPABASE_DNS_RESOLVER ?? "https";
if (!["https", "native"].includes(dnsResolver))
  throw new Error("SUPABASE_DNS_RESOLVER must be https or native.");
const args = ["--dns-resolver", dnsResolver, "db", "push", "--db-url", connection.toString(), "--skip-vault", "--yes"];
if (process.argv.includes("--dry-run")) args.push("--dry-run");

const cli = fileURLToPath(
  new URL("../node_modules/supabase/dist/supabase.js", import.meta.url),
);
const child = spawn(process.execPath, [cli, ...args], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
