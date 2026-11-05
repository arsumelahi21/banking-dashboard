import { Compass } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This page doesn't exist or has moved."
        action={
          <Button asChild variant="secondary">
            <Link href="/overview">Back to overview</Link>
          </Button>
        }
      />
    </main>
  );
}
