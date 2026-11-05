import { Badge } from "@/components/ui/badge";
import { statusLabels, type TransactionStatus } from "@/lib/transaction-filters";

const tones = { posted: "positive", pending: "neutral", failed: "danger" } as const;

/** In lists, settled is the normal case and stays quiet. Pass `showSettled` where status is the point. */
export function TransactionStatusBadge({ status, showSettled = false }: { status: TransactionStatus; showSettled?: boolean }) {
  if (status === "posted" && !showSettled) return null;
  return <Badge tone={tones[status]}>{statusLabels[status]}</Badge>;
}
