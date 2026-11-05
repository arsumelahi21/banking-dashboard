/**
 * Generates twelve months of believable activity for a fictional design and
 * engineering studio. Pure and deterministic: the same seed and date always give
 * the same data, which keeps it testable. Merchant names are illustrative only.
 */

import { brand } from "@/lib/brand";

export type AccountKey = "operating" | "payroll" | "reserve" | "external";
export type CardKey = "founder" | "engineering" | "marketing" | "travel";

export type GeneratedTransaction = {
  status: "pending" | "posted" | "failed";
  method: "ach" | "wire" | "card" | "transfer" | "interest" | "fee";
  description: string;
  counterparty: string;
  category: string;
  occurredAt: Date;
  card?: CardKey;
  lines: { account: AccountKey; amountCents: number }[];
};

export const seedAccounts = [
  { key: "operating", name: "Operating", kind: "checking", numberLast4: "4821" },
  { key: "payroll", name: "Payroll", kind: "checking", numberLast4: "7730" },
  { key: "reserve", name: "Reserve", kind: "savings", numberLast4: "1094" },
  { key: "external", name: "External", kind: "external", numberLast4: null },
] as const;

export const seedCards = [
  { key: "founder", holderName: "Alex Morgan", label: "Founder", numberLast4: "2207", monthlyLimitCents: 2_500_000 },
  { key: "engineering", holderName: "Dan Reyes", label: "Software", numberLast4: "6115", monthlyLimitCents: 4_000_000 },
  { key: "marketing", holderName: "Priya Nair", label: "Marketing", numberLast4: "3392", monthlyLimitCents: 3_000_000 },
  { key: "travel", holderName: "Team", label: "Travel", numberLast4: "8840", monthlyLimitCents: 1_500_000 },
] as const satisfies readonly { key: CardKey; holderName: string; label: string; numberLast4: string; monthlyLimitCents: number }[];

export const seedRecipients = [
  { name: "Landmark Properties", bankName: "First Republic Trust", numberLast4: "5512" },
  { name: "Elena Vasquez Design", bankName: "Harbor Bank", numberLast4: "9023" },
  { name: "Tomasz Nowak Consulting", bankName: "Union Savings", numberLast4: "1178" },
  { name: "Blue Harbor Health", bankName: "Cascade National", numberLast4: "3346" },
] as const;

const clients = [
  "Halcyon Health", "Brightwater Foods", "Cobalt Robotics", "Juniper Retail",
  "Orchard Logistics", "Summit Ridge Capital", "Tidewater Media", "Larkspur Energy",
];
const contractors = ["Elena Vasquez Design", "Tomasz Nowak Consulting", "Ravi Patel Engineering", "Studio Oriel"];
const subscriptions: { name: string; card: CardKey; low: number; high: number; day: number }[] = [
  { name: "Amazon Web Services", card: "engineering", low: 640_000, high: 1_120_000, day: 2 },
  { name: "Datadog", card: "engineering", low: 210_000, high: 285_000, day: 3 },
  { name: "Figma", card: "engineering", low: 135_000, high: 135_000, day: 5 },
  { name: "Google Workspace", card: "founder", low: 124_000, high: 124_000, day: 6 },
  { name: "Slack", card: "founder", low: 98_000, high: 98_000, day: 8 },
  { name: "GitHub", card: "engineering", low: 84_000, high: 84_000, day: 10 },
  { name: "Notion", card: "founder", low: 64_000, high: 64_000, day: 12 },
  { name: "Linear", card: "engineering", low: 52_000, high: 52_000, day: 14 },
];
const everydaySpend: { name: string; category: string; card: CardKey; low: number; high: number }[] = [
  { name: "Delta Air Lines", category: "Travel", card: "travel", low: 28_000, high: 94_000 },
  { name: "United Airlines", category: "Travel", card: "travel", low: 26_000, high: 88_000 },
  { name: "Marriott", category: "Travel", card: "travel", low: 19_000, high: 72_000 },
  { name: "Uber", category: "Travel", card: "travel", low: 1_400, high: 7_800 },
  { name: "Sweetgreen", category: "Meals", card: "founder", low: 1_600, high: 9_500 },
  { name: "Blue Bottle Coffee", category: "Meals", card: "founder", low: 700, high: 4_200 },
  { name: "Local Table Catering", category: "Meals", card: "founder", low: 18_000, high: 64_000 },
  { name: "Staples", category: "Office", card: "founder", low: 2_500, high: 21_000 },
  { name: "Apple", category: "Equipment", card: "engineering", low: 49_900, high: 329_900 },
  { name: "LinkedIn Ads", category: "Marketing", card: "marketing", low: 90_000, high: 340_000 },
  { name: "Google Ads", category: "Marketing", card: "marketing", low: 110_000, high: 420_000 },
];

/** Small, seedable random generator (mulberry32). */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (low: number, high: number) => Math.floor(next() * (high - low + 1)) + low,
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
    chance: (probability: number) => next() < probability,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Activity newer than this is still settling. */
const PENDING_WINDOW_MS = 2 * DAY_MS;

export function generateActivity(now: Date, seed = 20261106): GeneratedTransaction[] {
  const random = createRandom(seed);
  const items: GeneratedTransaction[] = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));

  const at = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, random.int(13, 22), random.int(0, 59), random.int(0, 59)));

  /** Money between an owned account and the outside world. */
  const external = (
    account: AccountKey,
    amountCents: number,
    details: Omit<GeneratedTransaction, "lines" | "status">,
  ) => {
    items.push({
      ...details,
      status: "posted",
      lines: [
        { account, amountCents },
        { account: "external", amountCents: -amountCents },
      ],
    });
  };

  const internal = (from: AccountKey, to: AccountKey, amountCents: number, occurredAt: Date, description: string) => {
    items.push({
      status: "posted",
      method: "transfer",
      description,
      counterparty: `${from === "operating" ? "Operating" : "Reserve"} to ${to === "payroll" ? "Payroll" : "Reserve"}`,
      category: "Internal transfer",
      occurredAt,
      lines: [
        { account: from, amountCents: -amountCents },
        { account: to, amountCents },
      ],
    });
  };

  const opening = new Date(start.getTime() - 2 * DAY_MS);
  external("operating", 180_000_000, {
    method: "wire",
    description: "Series A financing",
    counterparty: "Foundry Lane Ventures",
    category: "Financing",
    occurredAt: opening,
  });
  internal("operating", "reserve", 60_000_000, new Date(opening.getTime() + DAY_MS), "Move to reserve");
  internal("operating", "payroll", 2_500_000, new Date(opening.getTime() + DAY_MS), "Payroll account buffer");

  // Paid every two weeks, regardless of month boundaries.
  let payday = new Date(start.getTime() + 4 * DAY_MS);

  for (let index = 0; index <= 12; index += 1) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const year = monthStart.getUTCFullYear();
    const month = monthStart.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    // Revenue grows through the year, so the story moves from burning cash toward profit.
    const growth = 1 + (index / 12) * 0.4;

    const invoices = random.int(9, 12);
    for (let i = 0; i < invoices; i += 1) {
      const client = random.pick(clients);
      const isWire = random.chance(0.3);
      external("operating", Math.round(random.int(1_800_000, 4_400_000) * growth), {
        method: isWire ? "wire" : "ach",
        description: `Invoice ${1000 + index * 20 + i} payment`,
        counterparty: client,
        category: "Revenue",
        occurredAt: at(year, month, random.int(1, daysInMonth)),
      });
    }

    external("operating", -1_850_000, {
      method: "ach",
      description: "Office rent",
      counterparty: "Landmark Properties",
      category: "Rent",
      occurredAt: at(year, month, 1),
    });
    external("operating", -random.int(1_380_000, 1_460_000), {
      method: "ach",
      description: "Team health benefits",
      counterparty: "Blue Harbor Health",
      category: "Benefits",
      occurredAt: at(year, month, 15),
    });
    external("reserve", random.int(195_000, 215_000), {
      method: "interest",
      description: "Monthly interest",
      counterparty: brand.name,
      category: "Interest",
      occurredAt: at(year, month, daysInMonth),
    });

    if (month % 3 === 0) {
      external("operating", -random.int(3_800_000, 4_600_000), {
        method: "ach",
        description: "Quarterly estimated tax",
        counterparty: "US Treasury",
        category: "Taxes",
        occurredAt: at(year, month, 15),
      });
    }

    const contractorPayments = random.int(2, 4);
    for (let i = 0; i < contractorPayments; i += 1) {
      const isWire = random.chance(0.2);
      const occurredAt = at(year, month, random.int(5, daysInMonth));
      external("operating", -random.int(320_000, 1_450_000), {
        method: isWire ? "wire" : "ach",
        description: "Contractor invoice",
        counterparty: random.pick(contractors),
        category: "Contractors",
        occurredAt,
      });
      if (isWire) {
        external("operating", -2_500, {
          method: "fee",
          description: "Outgoing wire fee",
          counterparty: brand.name,
          category: "Bank fees",
          occurredAt,
        });
      }
    }

    for (const plan of subscriptions) {
      external("operating", -random.int(plan.low, plan.high), {
        method: "card",
        description: `${plan.name} subscription`,
        counterparty: plan.name,
        category: "Software",
        card: plan.card,
        occurredAt: at(year, month, plan.day),
      });
    }

    const everyday = random.int(24, 38);
    for (let i = 0; i < everyday; i += 1) {
      const merchant = random.pick(everydaySpend);
      const amount = random.int(merchant.low, merchant.high);
      const occurredAt = at(year, month, random.int(1, daysInMonth));
      external("operating", -amount, {
        method: "card",
        description: merchant.name,
        counterparty: merchant.name,
        category: merchant.category,
        card: merchant.card,
        occurredAt,
      });
      if (random.chance(0.03)) {
        external("operating", Math.round(amount / 2), {
          method: "card",
          description: `${merchant.name} refund`,
          counterparty: merchant.name,
          category: merchant.category,
          card: merchant.card,
          occurredAt: new Date(occurredAt.getTime() + 3 * DAY_MS),
        });
      }
    }

    // A declined card shows the failed state. It moves no money toward any balance.
    if (random.chance(0.5)) {
      const merchant = random.pick(everydaySpend);
      const amount = random.int(merchant.low, merchant.high);
      items.push({
        status: "failed",
        method: "card",
        description: `${merchant.name} (declined)`,
        counterparty: merchant.name,
        category: merchant.category,
        card: merchant.card,
        occurredAt: at(year, month, random.int(1, daysInMonth)),
        lines: [
          { account: "operating", amountCents: -amount },
          { account: "external", amountCents: amount },
        ],
      });
    }

    const monthEnd = new Date(Date.UTC(year, month + 1, 1));
    while (payday < monthEnd) {
      const wages = Math.round(random.int(8_900_000, 9_100_000) * (1 + (index / 12) * 0.08));
      const taxes = Math.round(wages * 0.26);
      internal("operating", "payroll", wages + taxes, new Date(payday.getTime() - DAY_MS), "Fund payroll");
      external("payroll", -wages, {
        method: "ach",
        description: "Payroll run",
        counterparty: "Gusto Payroll",
        category: "Payroll",
        occurredAt: payday,
      });
      external("payroll", -taxes, {
        method: "ach",
        description: "Payroll taxes",
        counterparty: "Gusto Payroll",
        category: "Payroll",
        occurredAt: new Date(payday.getTime() + 60 * 1000),
      });
      payday = new Date(payday.getTime() + 14 * DAY_MS);
    }
  }

  return items
    .filter((item) => item.occurredAt <= now)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((item) => {
      // Recent card and ACH activity hasn't settled yet. Payroll and transfers settle same day.
      const settling =
        item.status === "posted" &&
        (item.method === "card" || (item.method === "ach" && item.category !== "Payroll")) &&
        now.getTime() - item.occurredAt.getTime() < PENDING_WINDOW_MS;
      return settling ? { ...item, status: "pending" as const } : item;
    });
}
