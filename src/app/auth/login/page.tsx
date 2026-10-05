import { AuthForm } from "@/components/auth-form";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <>
      <p className="eyebrow mb-3">YOUR WORKSPACE AWAITS</p>
      <h1 className="text-3xl font-semibold tracking-tight">Welcome back.</h1>
      <p className="mb-9 mt-3 text-muted-foreground">
        Good to see you. Let’s pick up where you left off.
      </p>
      <AuthForm mode="login" error={error} next={next} />
    </>
  );
}
