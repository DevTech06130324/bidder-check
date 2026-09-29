import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function Forgot() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Let’s get you back in.
      </h1>
      <p className="mb-9 mt-3 text-muted-foreground">
        Contact your client or administrator to recover your account. If you are
        already signed in, change your password in Settings.
      </p>
      <Button asChild className="w-full">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
    </>
  );
}
