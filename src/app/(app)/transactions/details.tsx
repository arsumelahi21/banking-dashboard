"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { TransactionStatusBadge } from "@/components/transaction-status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { formatFullDay } from "@/lib/format";
import { methodLabels } from "@/lib/transaction-filters";
import type { TransactionDetail } from "@/server/queries/transactions";
import { updateMemo, type MemoFormState } from "@/server/transactions/actions";

const MEMO_MAX_LENGTH = 280;

function statusNote({ status, amountCents, signed }: Pick<TransactionDetail, "status" | "amountCents" | "signed">) {
  if (status === "failed") return "This transaction failed, so no money moved and your balance isn't affected.";
  if (status !== "pending") return null;
  // Held money and incoming money behave differently, so the note has to say which this is.
  return signed && amountCents > 0
    ? "Still settling. This amount isn't available to spend yet."
    : "Still settling. This amount already reduces your available balance.";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <dt className="shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

function CopyReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="font-mono text-xs break-all">{value}</code>
      <button
        type="button"
        aria-label={copied ? "Reference copied" : "Copy reference"}
        className="cursor-pointer rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </span>
  );
}

function MemoForm({ transactionId, memo }: { transactionId: string; memo: string | null }) {
  const [state, action, pending] = useActionState<MemoFormState, FormData>(updateMemo, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="transactionId" value={transactionId} />
      <label htmlFor="memo" className="text-sm font-medium text-fg">
        Memo
      </label>
      <textarea
        id="memo"
        name="memo"
        rows={3}
        maxLength={MEMO_MAX_LENGTH}
        defaultValue={memo ?? ""}
        placeholder="Add a note for your team"
        className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save memo"}
        </Button>
        <p role="status" className={state.status === "error" ? "text-xs text-danger" : "text-xs text-fg-muted"}>
          {state.status === "saved" ? "Saved" : state.message}
        </p>
      </div>
    </form>
  );
}

export function TransactionDetails({ detail, closeHref }: { detail: TransactionDetail | null; closeHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const note = detail ? statusNote(detail) : null;

  const close = () => {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      {detail ? (
        <DialogContent
          layout="sheet"
          title={detail.counterparty}
          description={detail.description}
          onCloseAutoFocus={(event) => {
            // The link that opened this panel isn't a Radix trigger, so return focus by hand.
            event.preventDefault();
            document.getElementById(`tx-${detail.id}`)?.focus();
          }}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-start gap-2">
              <Money
                cents={detail.amountCents}
                signed={detail.signed}
                display
                className={detail.status === "failed" ? "text-3xl text-fg-muted line-through" : "text-3xl text-fg"}
              />
              <TransactionStatusBadge status={detail.status} showSettled />
              {note ? <p className="text-sm text-fg-muted">{note}</p> : null}
            </div>

            <dl className="divide-y divide-border border-y border-border">
              <Row label="Date">
                {formatFullDay(detail.occurredAt)}, {detail.occurredAt.toISOString().slice(11, 16)} UTC
              </Row>
              <Row label="Type">{methodLabels[detail.method]}</Row>
              <Row label="Category">{detail.category}</Row>
              {detail.card ? (
                <Row label="Card">
                  {detail.card.label} ••{detail.card.last4}
                  <span className="block text-xs text-fg-muted">{detail.card.holder}</span>
                </Row>
              ) : null}
              <Row label="Reference">
                <CopyReference value={detail.id} />
              </Row>
            </dl>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">Ledger entries</h3>
              <ul className="rounded-lg border border-border">
                {detail.lines.map((line) => (
                  <li key={line.id} className="flex items-center justify-between gap-4 border-b border-border px-3 py-2 text-sm last:border-b-0">
                    <span className="min-w-0 truncate text-fg">
                      {line.accountKind === "external" ? detail.counterparty : line.accountName}
                      {line.numberLast4 ? <span className="text-fg-muted"> ••{line.numberLast4}</span> : null}
                    </span>
                    <Money cents={line.amountCents} className="text-fg" />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">Every entry is balanced by an equal and opposite one, and can never be edited.</p>
            </section>

            <MemoForm key={detail.id} transactionId={detail.id} memo={detail.memo} />
          </div>
        </DialogContent>
      ) : (
        <DialogContent layout="sheet" title="Transaction not found" description="It doesn't exist, or you don't have access to it.">
          <Button variant="secondary" onClick={close}>
            Back to transactions
          </Button>
        </DialogContent>
      )}
    </Dialog>
  );
}
