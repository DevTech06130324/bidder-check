import { AuthForm } from "@/components/auth-form";
export default function Update() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Your workspace is ready.
      </h1>
      <p className="mb-9 mt-3 text-muted-foreground">
        Choose a secure password to continue.
      </p>
      <AuthForm mode="update" />
    </>
  );
}
