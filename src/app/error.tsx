"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-content-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">
        We couldn’t open this workspace
      </h1>
      <p className="max-w-md text-muted-foreground">
        Please try again. If this is a new installation, confirm the Supabase
        migration and environment settings are configured.
      </p>
      <Button onClick={reset}>Try again</Button>
      <a href="/auth/login" className="text-sm text-primary">
        Return to sign in
      </a>
    </main>
  );
}
