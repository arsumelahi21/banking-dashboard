"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Logo } from "@/components/shell/logo";

/**
 * Catches failures in the app's own layout, such as being unable to check a session,
 * which the error page inside that layout can't. Shows no details, which could expose
 * internals. They stay in the server logs.
 */
export default function RootError({ retry }: { retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <Logo />
      <EmptyState
        icon={TriangleAlert}
        title="We're having trouble right now"
        description="Your accounts and money aren't affected. Please try again in a moment."
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    </main>
  );
}
