import { spawn } from "node:child_process";

const stagingUrl = "https://kdmvludtvhuuewmhurpw.supabase.co";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== stagingUrl)
  throw new Error("Refusing database migration: this command is staging-only.");
if (!process.env.SUPABASE_DB_PASSWORD)
  throw new Error("SUPABASE_DB_PASSWORD is required in the staging environment.");

const connection = new URL(
  "postgresql://postgres@db.kdmvludtvhuuewmhurpw.supabase.co:5432/postgres?sslmode=require",
);
connection.password = process.env.SUPABASE_DB_PASSWORD;
const args = ["db", "push", "--db-url", connection.toString(), "--skip-vault", "--yes"];
if (process.argv.includes("--dry-run")) args.push("--dry-run");

const cli = new URL("../node_modules/supabase/dist/supabase.js", import.meta.url);
const child = spawn(process.execPath, [cli.pathname, ...args], {
  stdio: "inherit",
  shell: false,
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
