import { AuthForm } from "@/components/auth-form";
export default function Signup() {
  return (
    <>
      <p className="eyebrow mb-3">A FRESH START</p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Make room for progress.
      </h1>
      <p className="mb-9 mt-3 text-muted-foreground">
        Create a workspace. Bring your team together.
      </p>
      <AuthForm mode="signup" />
    </>
  );
}
