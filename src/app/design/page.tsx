import { Inbox } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/shell/page-header";
import { DesignDemos } from "./demos";

/** Component reference for development. Not available in production. */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <PageHeader title="Design system" description="Every shared component, in one place." />

      <Card>
        <CardHeader>
          <CardTitle>Total cash</CardTitle>
          <Badge tone="positive">+2.4% this month</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Money cents={184250337} display className="text-5xl" />
          <p className="flex gap-6 text-sm">
            <Money cents={1250000} signed />
            <Money cents={-482350} signed />
            <Money cents={0} signed />
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buttons and badges</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button>Send money</Button>
          <Button variant="secondary">Export</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Freeze card</Button>
          <Button disabled>Disabled</Button>
          <Badge>Pending</Badge>
          <Badge tone="accent">Scheduled</Badge>
          <Badge tone="positive">Settled</Badge>
          <Badge tone="warning">Needs approval</Badge>
          <Badge tone="danger">Failed</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forms and overlays</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Recipient" placeholder="Search recipients" hint="Saved recipients only." />
          <Field label="Amount" defaultValue="-5" error="Enter an amount above $0.00." />
          <DesignDemos />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Loading and empty states</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-3/4" />
          <EmptyState icon={Inbox} title="No transactions match" description="Try removing a filter." />
        </CardContent>
      </Card>
    </main>
  );
}
