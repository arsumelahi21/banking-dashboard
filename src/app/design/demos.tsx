"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

const accounts = [
  { value: "operating", label: "Operating" },
  { value: "reserve", label: "Reserve" },
];

export function DesignDemos() {
  return (
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
      <Select aria-label="Account" placeholder="Choose account" options={accounts} className="w-48" />

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open modal</Button>
        </DialogTrigger>
        <DialogContent title="Confirm transfer" description="Review the details before sending.">
          <DialogClose asChild>
            <Button>Confirm</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open sheet</Button>
        </DialogTrigger>
        <DialogContent layout="sheet" title="Transaction details" description="Card payment">
          <p className="text-sm text-fg-muted">Details go here.</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
