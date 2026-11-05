"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";

/** Shows no error details, which could expose internals. They stay in server logs. */
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={TriangleAlert}
        title="This page didn't load"
        description="Your accounts and money aren't affected. Please try again."
        action={<Button onClick={() => retry()}>Try again</Button>}
      />
    </Card>
  );
}
