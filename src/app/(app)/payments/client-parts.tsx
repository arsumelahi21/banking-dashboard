"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { VERIFICATION_THRESHOLD_CENTS } from "@/lib/payments";
import {
  addRecipientAction,
  cancelScheduledAction,
  sendScheduledNowAction,
  type RecipientFormState,
} from "@/server/payments/actions";

/** Confirming first, because both actions are immediate and can't be undone. */
export function ScheduledActions({ id, toName, amountCents }: { id: string; toName: string; amountCents: number }) {
  const canSendEarly = amountCents < VERIFICATION_THRESHOLD_CENTS;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const amount = formatMoney(amountCents);

  const run = (action: (id: string) => Promise<{ ok: boolean; message?: string }>) => {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await action(id);
        if (!result.ok) setError(result.message);
      } catch {
        setError("We couldn't reach the server. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {canSendEarly ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={pending} aria-label={`Send now: ${amount} to ${toName}`}>
              Send now
            </Button>
          </DialogTrigger>
          <DialogContent title="Send this payment now?" description={`${amount} to ${toName} will be sent right away instead of on its scheduled date.`}>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Keep schedule</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => run(sendScheduledNowAction)}>Send now</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
        ) : null}

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={pending} aria-label={`Cancel: ${amount} to ${toName}`}>
              Cancel
            </Button>
          </DialogTrigger>
          <DialogContent title="Cancel this payment?" description={`${amount} to ${toName} won't be sent. This can't be undone.`}>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Keep payment</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger" onClick={() => run(cancelScheduledAction)}>Cancel payment</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function RecipientForm({ onSaved }: { onSaved: () => void }) {
  const [state, action, pending] = useActionState<RecipientFormState, FormData>(addRecipientAction, { status: "idle" });

  useEffect(() => {
    if (state.status === "saved") onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Recipient name" name="name" required maxLength={80} autoComplete="off" error={state.errors?.name} />
      <Field label="Bank name" name="bankName" required maxLength={80} autoComplete="off" error={state.errors?.bankName} />
      <Field
        label="Account number"
        name="accountNumber"
        required
        inputMode="numeric"
        autoComplete="off"
        maxLength={17}
        error={state.errors?.accountNumber}
        hint="We only keep the last four digits."
      />
      {state.errors?.form ? <p role="alert" className="text-sm text-danger">{state.errors.form}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save recipient"}
      </Button>
    </form>
  );
}

export function AddRecipient() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus aria-hidden />
          Add recipient
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a recipient" description="Save who you pay, so you can choose them next time.">
        {/* Mounted only while open, so the form starts empty every time. */}
        {open ? <RecipientForm onSaved={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
