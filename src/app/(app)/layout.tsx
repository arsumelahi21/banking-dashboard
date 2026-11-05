import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { BottomNav, SidebarNav } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { SignOutButton } from "@/components/shell/user-menu";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";
import { requireSession } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh flex-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-border p-4 lg:flex">
        <Link href="/overview" className="w-fit rounded-md px-3 pt-2">
          <Logo />
        </Link>
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 pl-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{session.name}</p>
              <p className="truncate text-xs text-fg-muted">{session.orgName}</p>
            </div>
            <SignOutButton />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 pl-3">
            <p className="text-xs text-fg-subtle">Simulated data</p>
            <ThemeToggle initial={theme} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2 lg:hidden">
          <Link href="/overview" className="rounded-md">
            <Logo />
          </Link>
          <div className="flex items-center">
            <ThemeToggle initial={theme} />
            <SignOutButton />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:py-10"
        >
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
