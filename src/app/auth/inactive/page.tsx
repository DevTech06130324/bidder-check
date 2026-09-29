import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
export default function Inactive() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Your account is archived</h1>
      <p className="my-4 text-muted-foreground">
        Contact your client or administrator to restore access.
      </p>
      <form action={signOut}>
        <Button>Sign out</Button>
      </form>
    </>
  );
}
