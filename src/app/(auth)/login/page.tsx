import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shell/logo";
import { brand } from "@/lib/brand";
import { getSession } from "@/server/auth/session";
import { DemoButton, LoginForm } from "./forms";
import { ProductPreview } from "./product-preview";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // If the session can't be checked, show the form. It reports the problem clearly when used.
  const session = await getSession().catch(() => null);
  if (session) redirect("/overview");

  return (
    <div className="grid flex-1 lg:grid-cols-2">
      <main className="flex flex-col bg-surface px-6 py-8 sm:px-12">
        <Logo />

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-12">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-bold text-fg">Sign in to {brand.name}</h1>
            <p className="text-sm leading-relaxed text-fg-muted">Your accounts, payments and cards, all in one calm place.</p>
          </div>

          <div className="flex flex-col gap-2.5">
            <DemoButton />
            <p className="text-xs leading-relaxed text-fg-muted">
              No sign-up needed. You get a private workspace with a year of sample activity, which expires within 24 hours.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <span className="h-px flex-1 bg-border" />
            or use your account
            <span className="h-px flex-1 bg-border" />
          </div>

          <LoginForm />
        </div>

        <p className="text-xs text-fg-subtle">A simulation for demonstration. All data is fictional and no real money moves.</p>
      </main>

      <ProductPreview />
    </div>
  );
}
