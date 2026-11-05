"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SESSION_IDLE_MS } from "@/lib/session-cookie";
import { keepSessionAlive, signOut } from "@/server/auth/actions";

const WARNING_BEFORE_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 5 * 1000;

/**
 * Warns before the server's idle timeout so nobody loses their place without notice.
 * Compares clock times instead of counting down, so a laptop waking from sleep is
 * handled correctly. The server enforces the timeout whether or not this runs.
 */
export function SessionTimeout() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastActivity = useRef(0);
  const signingOut = useRef(false);
  const stayButton = useRef<HTMLButtonElement>(null);
  const [warning, setWarning] = useState(false);
  const [pending, startTransition] = useTransition();

  // Every navigation is a request to the server, which counts as activity there too.
  useEffect(() => {
    lastActivity.current = Date.now();
  }, [pathname, searchParams]);

  useEffect(() => {
    const check = () => {
      const idleFor = Date.now() - lastActivity.current;
      if (idleFor >= SESSION_IDLE_MS && !signingOut.current) {
        signingOut.current = true;
        signOut().catch(() => router.replace("/login"));
      } else if (idleFor >= SESSION_IDLE_MS - WARNING_BEFORE_MS) {
        setWarning(true);
      }
    };

    const interval = setInterval(check, CHECK_EVERY_MS);
    // Timers pause while a tab sleeps, so check straight away on return.
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  const stay = () => {
    startTransition(async () => {
      try {
        await keepSessionAlive();
        lastActivity.current = Date.now();
        setWarning(false);
      } catch {
        router.replace("/login");
      }
    });
  };

  return (
    <Dialog open={warning} onOpenChange={(open) => (open ? undefined : stay())}>
      <DialogContent
        title="Are you still there?"
        description="For your security, you'll be signed out soon because of inactivity."
        onOpenAutoFocus={(event) => {
          // Pressing Enter should keep someone signed in, whatever they were doing.
          event.preventDefault();
          stayButton.current?.focus();
        }}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => signOut()}>
            Sign out
          </Button>
          <Button ref={stayButton} onClick={stay} disabled={pending}>
            {pending ? "Staying signed in…" : "Stay signed in"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
