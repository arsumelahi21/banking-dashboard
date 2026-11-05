"use client";

import { CalendarClock, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { formatFullDay } from "@/lib/format";
import { formatMoney, parseDollarsToCents } from "@/lib/money";
import { MEMO_MAX_LENGTH, methodDescriptions, VERIFICATION_THRESHOLD_CENTS, type PaymentField } from "@/lib/payments";
import { previewPaymentAction, submitPaymentAction } from "@/server/payments/actions";
import type { PaymentPreview, SubmitResult } from "@/server/payments/service";

type AccountOption = { id: string; name: string; numberLast4: string | null; availableCents: number };
type RecipientOption = { id: string; name: string; bankName: string; numberLast4: string };

type Props = {
  accounts: AccountOption[];
  recipients: RecipientOption[];
  initialRecipientId?: string;
  minDate: string;
  maxDate: string;
};

type Step = "details" | "review" | "verify" | "done";
type DestinationType = "account" | "recipient";
type Errors = Partial<Record<PaymentField, string>>;

const CONNECTION_ERROR = "We couldn't reach the server. It's safe to try again; it won't send twice.";

const newKey = () => crypto.randomUUID();

function Stepper({ step, needsCode }: { step: Step; needsCode: boolean }) {
  const steps: { key: Step; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "review", label: "Review" },
    ...(needsCode ? [{ key: "verify" as const, label: "Verify" }] : []),
    { key: "done", label: "Done" },
  ];
  const current = steps.findIndex((item) => item.key === step);

  return (
    <ol aria-label="Payment progress" className="flex items-center gap-2 text-xs text-fg-muted">
      {steps.map((item, index) => (
        <li key={item.key} aria-current={index === current ? "step" : undefined} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden className="h-px w-4 bg-border-strong" /> : null}
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full tabular-nums",
              index === current ? "bg-accent text-accent-fg" : index < current ? "bg-accent-soft text-accent-soft-fg" : "bg-surface-2",
            )}
          >
            {index + 1}
          </span>
          <span className={index === current ? "font-medium text-fg" : undefined}>{item.label}</span>
        </li>
      ))}
    </ol>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function PaymentFlow({ accounts, recipients, initialRecipientId, minDate, maxDate }: Props) {
  const [step, setStep] = useState<Step>("details");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Errors>({});

  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<DestinationType>(initialRecipientId ? "recipient" : "account");
  const [toAccountId, setToAccountId] = useState("");
  const [recipientId, setRecipientId] = useState(initialRecipientId ?? "");
  const [method, setMethod] = useState<"ach" | "wire">("ach");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");

  // One key per intent to pay. Retries reuse it, which is what prevents a double
  // send. It only changes when the details are edited or a new payment begins.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    // Moves keyboard and screen reader users along with each step.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const from = accounts.find((account) => account.id === fromAccountId);
  const destinationName =
    destinationType === "account"
      ? accounts.find((account) => account.id === toAccountId)?.name
      : recipients.find((recipient) => recipient.id === recipientId)?.name;
  const amountCents = parseDollarsToCents(amount);
  const isScheduled = when === "later";

  const rawInput = () => ({
    idempotencyKey,
    fromAccountId,
    toAccountId: destinationType === "account" ? toAccountId : undefined,
    recipientId: destinationType === "recipient" ? recipientId : undefined,
    method: destinationType === "recipient" ? method : undefined,
    amount,
    memo,
    scheduledFor: isScheduled ? scheduledFor : undefined,
  });

  const review = () => {
    setErrors({});
    startTransition(async () => {
      try {
        const response = await previewPaymentAction(rawInput());
        if (!response.ok) {
          setErrors({ [response.field]: response.message });
          return;
        }
        setPreview(response.preview);
        setCode("");
        setStep("review");
      } catch {
        setErrors({ form: CONNECTION_ERROR });
      }
    });
  };

  const submit = () => {
    setErrors({});
    startTransition(async () => {
      try {
        const response = await submitPaymentAction(rawInput(), {
          challengeId: preview?.verification?.challengeId,
          code: preview?.verification ? code : undefined,
        });
        if (response.ok) {
          setResult(response.result);
          setStep("done");
          return;
        }
        // A details problem goes back to the form. A code problem stays here.
        if (response.field !== "form") {
          setIdempotencyKey(newKey());
          setErrors({ [response.field]: response.message });
          setStep("details");
          return;
        }
        setErrors({ form: response.message });
      } catch {
        // The result is unknown, so the key stays the same and retrying can't double-send.
        setErrors({ form: CONNECTION_ERROR });
      }
    });
  };

  const requestNewCode = () => {
    setErrors({});
    setCode("");
    review();
  };

  const editDetails = () => {
    // Changed details are a new intent, so they must not reuse the old key.
    setIdempotencyKey(newKey());
    setErrors({});
    setPreview(null);
    setStep("details");
  };

  const startOver = () => {
    setIdempotencyKey(newKey());
    setErrors({});
    setPreview(null);
    setResult(null);
    setAmount("");
    setMemo("");
    setCode("");
    setWhen("now");
    setScheduledFor("");
    setStep("details");
  };

  const needsCode = preview ? preview.verification !== null : amountCents !== null && amountCents >= VERIFICATION_THRESHOLD_CENTS;

  // Built only on the steps that show it: on the details step, the date may not be chosen yet.
  const renderSummary = () => (
    <dl className="divide-y divide-border border-y border-border">
      <SummaryRow label="From">
        {from?.name} ••{from?.numberLast4}
      </SummaryRow>
      <SummaryRow label="To">{destinationName}</SummaryRow>
      {destinationType === "recipient" ? <SummaryRow label="Method">{methodDescriptions[method].label}</SummaryRow> : null}
      <SummaryRow label="When">{isScheduled ? formatFullDay(scheduledFor) : "Now"}</SummaryRow>
      {memo.trim() ? <SummaryRow label="Memo">{memo.trim()}</SummaryRow> : null}
    </dl>
  );

  const amountHeadline = amountCents !== null ? <Money cents={amountCents} display className="text-4xl text-fg" /> : null;

  return (
    <div className="flex w-full max-w-xl flex-col gap-5">
      <Stepper step={step} needsCode={needsCode} />

      <Card className="flex flex-col gap-5 p-6">
        {step === "details" ? (
          // noValidate: the server checks everything and shows clear messages by each field.
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              review();
            }}
          >
            <h2 ref={heading} tabIndex={-1} className="text-base font-medium text-fg outline-none">
              Payment details
            </h2>

            <div className="flex flex-col gap-1.5">
              <span id="from-label" className="text-sm font-medium text-fg">From</span>
              <Select
                aria-label="From"
                value={fromAccountId}
                onValueChange={setFromAccountId}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: `${account.name} ••${account.numberLast4} · ${formatMoney(account.availableCents)} available`,
                }))}
                className="w-full"
              />
              {errors.from ? <p className="text-xs text-danger">{errors.from}</p> : null}
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-fg">To</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-strong bg-surface p-0.5">
                {(
                  [
                    ["account", "My accounts"],
                    ["recipient", "A recipient"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                      destinationType === value ? "bg-accent-soft font-medium text-accent-soft-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    <input
                      type="radio"
                      name="destination-type"
                      value={value}
                      checked={destinationType === value}
                      onChange={() => setDestinationType(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>

              {destinationType === "account" ? (
                <Select
                  aria-label="To account"
                  placeholder="Choose an account"
                  value={toAccountId}
                  onValueChange={setToAccountId}
                  options={accounts
                    .filter((account) => account.id !== fromAccountId)
                    .map((account) => ({ value: account.id, label: `${account.name} ••${account.numberLast4}` }))}
                  className="mt-1 w-full"
                />
              ) : recipients.length > 0 ? (
                <Select
                  aria-label="To recipient"
                  placeholder="Choose a recipient"
                  value={recipientId}
                  onValueChange={setRecipientId}
                  options={recipients.map((recipient) => ({
                    value: recipient.id,
                    label: `${recipient.name} · ${recipient.bankName} ••${recipient.numberLast4}`,
                  }))}
                  className="mt-1 w-full"
                />
              ) : (
                <p className="mt-1 text-sm text-fg-muted">
                  No recipients yet. <Link href="/payments" className="underline">Add one on the payments page.</Link>
                </p>
              )}
              {errors.to ? <p className="text-xs text-danger">{errors.to}</p> : null}
            </fieldset>

            {destinationType === "recipient" ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium text-fg">Method</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["ach", "wire"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                        method === value ? "border-accent bg-accent-soft" : "border-border-strong",
                      )}
                    >
                      <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} className="sr-only" />
                      <span className="text-sm font-medium text-fg">{methodDescriptions[value].label}</span>
                      <span className="text-xs text-fg-muted">{methodDescriptions[value].detail}</span>
                    </label>
                  ))}
                </div>
                {errors.method ? <p className="text-xs text-danger">{errors.method}</p> : null}
              </fieldset>
            ) : null}

            <Field
              label="Amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="$0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              error={errors.amount}
              hint={
                amountCents !== null && amountCents >= VERIFICATION_THRESHOLD_CENTS
                  ? `Payments of ${formatMoney(VERIFICATION_THRESHOLD_CENTS)} or more need a verification code.`
                  : undefined
              }
            />

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-fg">When</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-strong bg-surface p-0.5">
                {(
                  [
                    ["now", "Send now"],
                    ["later", "Schedule"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      "cursor-pointer rounded-md px-3 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
                      when === value ? "bg-accent-soft font-medium text-accent-soft-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    <input type="radio" name="when" value={value} checked={when === value} onChange={() => setWhen(value)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {isScheduled ? (
              <Field
                label="Date"
                type="date"
                min={minDate}
                max={maxDate}
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
                error={errors.date}
                hint="Your balance is checked again on this date."
              />
            ) : null}

            <Field
              label="Memo (optional)"
              maxLength={MEMO_MAX_LENGTH}
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              error={errors.memo}
            />

            <FormError message={errors.form} />

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Checking…" : "Review payment"}
            </Button>
          </form>
        ) : null}

        {step === "review" && preview ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 ref={heading} tabIndex={-1} className="text-base font-medium text-fg outline-none">
                Review your payment
              </h2>
              {amountHeadline}
            </div>
            {renderSummary()}
            {!isScheduled ? (
              <p className="text-sm text-fg-muted">
                {from?.name} will have <span className="text-fg tabular-nums">{formatMoney(preview.availableAfterCents)}</span> available after this.
              </p>
            ) : null}
            <FormError message={errors.form} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={editDetails} disabled={pending}>
                Edit details
              </Button>
              {preview.verification ? (
                <Button onClick={() => setStep("verify")}>Continue to verification</Button>
              ) : (
                <Button onClick={submit} disabled={pending}>
                  {pending ? "Sending…" : isScheduled ? "Schedule payment" : "Confirm and send"}
                </Button>
              )}
            </div>
          </>
        ) : null}

        {step === "verify" && preview?.verification ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-fg">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <h2 ref={heading} tabIndex={-1} className="text-base font-medium text-fg outline-none">
                  Verify this payment
                </h2>
                <p className="text-sm text-fg-muted">
                  Enter the code to approve {amountCents !== null ? formatMoney(amountCents) : "this payment"} to {destinationName}. It works once, for this payment only.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border-strong bg-surface-2 px-4 py-3">
              <p className="text-xs text-fg-muted">Demo only: a real system would send this to your phone.</p>
              <p className="font-mono text-xl tracking-widest text-fg" data-testid="demo-code">{preview.verification.code}</p>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
              Verification code
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </label>

            <FormError message={errors.form} />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={requestNewCode} disabled={pending}>
                Send a new code
              </Button>
              <Button type="submit" disabled={pending || code.length !== 6}>
                {pending ? "Sending…" : isScheduled ? "Verify and schedule" : "Verify and send"}
              </Button>
            </div>
          </form>
        ) : null}

        {step === "done" && result ? (
          <>
            <div role="status" className="flex flex-col gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-positive-soft text-positive">
                {result.kind === "scheduled" ? <CalendarClock className="size-5" aria-hidden /> : <CheckCircle2 className="size-5" aria-hidden />}
              </span>
              <div className="flex flex-col gap-1">
                <h2 ref={heading} tabIndex={-1} className="text-base font-medium text-fg outline-none">
                  {result.kind === "scheduled"
                    ? "Payment scheduled"
                    : destinationType === "account"
                      ? "Transfer complete"
                      : method === "ach"
                        ? "Payment on its way"
                        : "Payment sent"}
                </h2>
                {amountHeadline}
                {result.kind === "sent" && destinationType === "recipient" && method === "ach" ? (
                  <p className="text-sm text-fg-muted">Expected to settle in 1–2 business days. The funds are held until then.</p>
                ) : null}
              </div>
            </div>
            {renderSummary()}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={startOver}>
                Make another payment
              </Button>
              <Button asChild variant="secondary">
                {result.kind === "sent" ? (
                  <Link href={`/transactions?tx=${result.transactionId}`}>View transaction</Link>
                ) : (
                  <Link href="/payments">View scheduled payments</Link>
                )}
              </Button>
            </div>
          </>
        ) : null}
      </Card>
    </div>
  );
}
