import { AuthForm } from "@/components/auth-form";
export default function Forgot() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        Let’s get you back in.
      </h1>
      <p className="mb-9 mt-3 text-muted-foreground">
        We’ll email you a link to reset your password.
      </p>
      <AuthForm mode="forgot" />
    </>
  );
}
