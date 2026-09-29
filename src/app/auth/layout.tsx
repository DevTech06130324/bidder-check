import { Brand } from "@/components/brand";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { ArrowUpRight, Check, ShieldCheck, Sparkles } from "lucide-react";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="auth-grid relative hidden flex-col overflow-hidden bg-[#19182f] p-12 text-white lg:flex">
        <Brand className="relative z-10" />
        <div className="relative z-10 m-auto max-w-lg py-20">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-violet-200">
            <Sparkles size={13} /> A little clarity. A lot of progress.
          </div>
          <h1 className="text-5xl font-semibold leading-[1.16] tracking-[-2px]">
            Great work starts
            <br />
            with a clear view<span className="text-violet-400">.</span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-[#aba9c5]">
            Bring your people, applications, and earnings together. Less keeping
            track. More moving forward.
          </p>
          <div className="mt-12 rotate-[-2deg] rounded-2xl border border-white/10 bg-white/[.06] p-6 shadow-2xl backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs text-violet-200">
                A more organized workday
              </span>
              <ArrowUpRight className="text-violet-300" size={18} />
            </div>
            <div className="mt-5 space-y-4">
              {[
                "The right resume, always at hand",
                "Every application accounted for",
                "Earnings you can see clearly",
              ].map((t) => (
                <div key={t} className="flex items-center gap-3 text-sm">
                  <span className="rounded-full bg-emerald-400/15 p-1 text-emerald-300">
                    <Check size={12} />
                  </span>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-xs text-[#aba9c5]">
          <ShieldCheck size={15} /> Private by design. Built around your team.
        </div>
        <BackgroundBeams className="opacity-40 motion-reduce:hidden" />
      </section>
      <section className="flex min-h-screen flex-col bg-card px-6 py-8 sm:px-14">
        <Brand className="lg:hidden" />
        <div className="m-auto w-full max-w-[370px] py-12">{children}</div>
        <p className="text-center text-xs text-muted-foreground">
          A calmer way to manage the work.
        </p>
      </section>
    </main>
  );
}
