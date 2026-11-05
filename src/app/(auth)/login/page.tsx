import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/logo";
import { Card } from "@/components/ui/card";
import { getSession } from "@/server/auth/session";
import { DemoButton, LoginForm } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // If the session can't be checked, show the form. It reports the problem clearly when used.
  const session = await getSession().catch(() => null);
  if (session) redirect("/overview");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Logo />

      <Card className="flex w-full max-w-sm flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl tracking-tight text-fg">Welcome</h1>
          <p className="text-sm text-fg-muted">
            Explore a private workspace with a year of sample activity. It&apos;s yours alone and
            expires within 24 hours.
          </p>
        </div>

        <DemoButton />

        <div className="flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          or sign in
          <span className="h-px flex-1 bg-border" />
        </div>

        <LoginForm />
      </Card>

      <p className="max-w-sm text-center text-xs text-fg-subtle">
        A simulation for demonstration. All data is fictional and no real money moves.
      </p>
    </main>
  );
}
