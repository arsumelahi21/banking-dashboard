"use client";

import { CheckCircle2, Snowflake, Sun, XCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { centsToDollarString } from "@/lib/money";
import {
  setCardFrozenAction,
  setCardLimitAction,
  simulatePurchaseAction,
  type LimitFormState,
  type PurchaseResponse,
} from "@/server/cards/actions";

type CardSummary = { id: string; label: string; status: "active" | "frozen"; monthlyLimitCents: number };

function LimitForm({ card, onSaved }: { card: CardSummary; onSaved: () => void }) {
  const [state, action, pending] = useActionState<LimitFormState, FormData>(setCardLimitAction, { status: "idle" });

  useEffect(() => {
    if (state.status === "saved") onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="cardId" value={card.id} />
      <Field
        label="Monthly limit"
        name="limit"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={centsToDollarString(card.monthlyLimitCents)}
        error={state.status === "error" ? state.message : undefined}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save limit"}
      </Button>
    </form>
  );
}

function PurchaseForm({ card }: { card: CardSummary }) {
  const [pending, startTransition] = useTransition();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<PurchaseResponse | null>(null);
  // One key per attempt. It stays the same if the connection fails, so a retry can't double-charge.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [connectionError, setConnectionError] = useState(false);

  const submit = () => {
    setConnectionError(false);
    startTransition(async () => {
      try {
        const response = await simulatePurchaseAction({ cardId: card.id, idempotencyKey, merchant, amount });
        setResult(response);
        if (response.ok) setIdempotencyKey(crypto.randomUUID());
      } catch {
        setConnectionError(true);
      }
    });
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="Merchant" value={merchant} maxLength={60} autoComplete="off" onChange={(event) => setMerchant(event.target.value)} />
      <Field label="Amount" value={amount} inputMode="decimal" autoComplete="off" placeholder="$0.00" onChange={(event) => setAmount(event.target.value)} />

      {connectionError ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          We couldn&apos;t reach the server. It&apos;s safe to try again.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {result.message}
        </p>
      ) : null}
      {result?.ok ? (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg">
          {result.outcome === "approved" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          )}
          <div>
            <p className="font-medium">{result.outcome === "approved" ? "Approved" : "Declined"}</p>
            <p className="text-fg-muted">
              {result.outcome === "approved" ? "The funds are held until it settles." : result.reason?.replace(/^Declined: /, "")}{" "}
              <Link href={`/transactions?tx=${result.transactionId}`} className="underline">
                View transaction
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Authorizing…" : "Simulate purchase"}
      </Button>
    </form>
  );
}

export function CardControls({ card }: { card: CardSummary }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [limitOpen, setLimitOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const frozen = card.status === "frozen";

  const toggleFreeze = () => {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await setCardFrozenAction(card.id, !frozen);
        if (!result.ok) setError(result.message);
      } catch {
        setError("We couldn't reach the server. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={pending} onClick={toggleFreeze} aria-label={`${frozen ? "Unfreeze" : "Freeze"} ${card.label} card`}>
          {frozen ? <Sun aria-hidden /> : <Snowflake aria-hidden />}
          {frozen ? "Unfreeze" : "Freeze"}
        </Button>

        <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Edit limit for ${card.label} card`}>
              Edit limit
            </Button>
          </DialogTrigger>
          <DialogContent title={`${card.label} card limit`} description="The most this card can spend in a calendar month.">
            {limitOpen ? <LimitForm card={card} onSaved={() => setLimitOpen(false)} /> : null}
          </DialogContent>
        </Dialog>

        <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Simulate purchase on ${card.label} card`}>
              Simulate purchase
            </Button>
          </DialogTrigger>
          <DialogContent title="Simulate a purchase" description="See how this card responds. It runs the real freeze, limit and balance checks.">
            {purchaseOpen ? <PurchaseForm card={card} /> : null}
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
