import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-content-center gap-4 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This page may have moved or is unavailable to your account.
      </p>
      <Link className="text-primary" href="/dashboard">
        Back to your workspace →
      </Link>
    </main>
  );
}
