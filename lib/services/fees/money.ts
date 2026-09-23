/**
 * Money.
 *
 * Every amount in Volt is an integer number of paisa. There is no float anywhere in the
 * finance path, because a bursar reconciling a bank statement against a rounding error is
 * the fastest way to lose an accounts office.
 *
 * Pure functions, no database — so the arithmetic that decides what a family owes can be
 * tested exhaustively and cannot drift between the invoice screen, the voucher PDF and
 * the collection report.
 */

/** Percentages are stored as basis points so a 12.5% sibling discount stays an integer. */
export const BASIS_POINTS = 10_000;

export const PAISA_PER_RUPEE = 100;

export type DiscountRule = {
  type: 'PERCENT' | 'FIXED';
  /** Basis points when PERCENT, paisa when FIXED. */
  value: number;
  reason: string;
};

export type LineItem = {
  feeHeadId: string;
  label: string;
  amountPaisa: number;
};

export function rupeesToPaisa(rupees: number): number {
  return Math.round(rupees * PAISA_PER_RUPEE);
}

/**
 * Formats for a voucher or a screen.
 *
 * Deliberately not `Intl.NumberFormat` with a currency style: a bank challan carries plain
 * grouped digits, and "PKR 12,500" in the amount box is what makes a cashier reject it.
 */
export function formatPaisa(paisa: number): string {
  const negative = paisa < 0;
  const whole = Math.floor(Math.abs(paisa) / PAISA_PER_RUPEE);
  const rest = Math.abs(paisa) % PAISA_PER_RUPEE;
  const grouped = new Intl.NumberFormat('en-PK').format(whole);
  const body = rest === 0 ? grouped : `${grouped}.${String(rest).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Amount in words, for the challan.
 *
 * Pakistani bank vouchers carry the amount written out, and the lakh/crore grouping is not
 * what an English formatter produces. A voucher that says "twelve thousand five hundred"
 * where the counter expects "twelve thousand five hundred rupees only" gets queried.
 */
const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

function underThousand(value: number): string {
  if (value === 0) return '';
  if (value < 20) return ONES[value] ?? '';
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)] ?? '';
    const ones = ONES[value % 10] ?? '';
    return ones ? `${tens}-${ones}` : tens;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
  const rest = underThousand(value % 100);
  return rest ? `${hundreds} and ${rest}` : hundreds;
}

export function amountInWords(paisa: number): string {
  const rupees = Math.floor(Math.abs(paisa) / PAISA_PER_RUPEE);
  if (rupees === 0) return 'zero rupees only';

  // Crore, lakh, thousand, hundred — the grouping a Pakistani voucher uses.
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;

  if (crore > 0) parts.push(`${underThousand(crore)} crore`);
  if (lakh > 0) parts.push(`${underThousand(lakh)} lakh`);
  if (thousand > 0) parts.push(`${underThousand(thousand)} thousand`);
  if (rest > 0) parts.push(underThousand(rest));

  return `${parts.join(' ')} rupees only`;
}

/**
 * Applies a school's discounts to a subtotal.
 *
 * Order matters and is fixed: percentages first against the full subtotal, then fixed
 * amounts. Applying a fixed waiver first and then a percentage would quietly shrink the
 * scholarship, and two schools would reconcile the same student differently.
 *
 * The result is clamped at the subtotal. A discount cannot make a school owe a family
 * money; an overpayment is a credit note, which is a different record with an approval
 * trail behind it.
 */
export function applyDiscounts(
  subtotalPaisa: number,
  discounts: readonly DiscountRule[],
): { discountPaisa: number; totalPaisa: number; applied: { reason: string; amountPaisa: number }[] } {
  const applied: { reason: string; amountPaisa: number }[] = [];
  let discount = 0;

  for (const rule of discounts.filter((entry) => entry.type === 'PERCENT')) {
    // Rounded half-up in the family's favour is not a thing a bursar can explain, so this
    // rounds to the nearest paisa and the voucher shows the result.
    const amount = Math.round((subtotalPaisa * rule.value) / BASIS_POINTS);
    if (amount <= 0) continue;
    discount += amount;
    applied.push({ reason: rule.reason, amountPaisa: amount });
  }

  for (const rule of discounts.filter((entry) => entry.type === 'FIXED')) {
    if (rule.value <= 0) continue;
    discount += rule.value;
    applied.push({ reason: rule.reason, amountPaisa: rule.value });
  }

  const capped = Math.min(discount, subtotalPaisa);
  return { discountPaisa: capped, totalPaisa: subtotalPaisa - capped, applied };
}

export function subtotalOf(lineItems: readonly LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.amountPaisa, 0);
}

export type InvoiceBalance = {
  total: number;
  paid: number;
  credited: number;
  /** What the family still owes. Never negative. */
  outstanding: number;
  /** Paid plus credited beyond the total — a real thing, and the bursar must see it. */
  overpaid: number;
};

/**
 * The balance on one invoice.
 *
 * Credit notes count towards settling it exactly as payments do, which is what makes
 * "never edit an invoice after a payment" a workable rule rather than an obstacle: a
 * mistake is corrected by adding a record, not by rewriting one.
 */
export function balanceOf(
  total: number,
  payments: readonly { amount: number }[],
  creditNotes: readonly { amount: number }[] = [],
): InvoiceBalance {
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const credited = creditNotes.reduce((sum, note) => sum + note.amount, 0);
  const settled = paid + credited;
  return {
    total,
    paid,
    credited,
    outstanding: Math.max(0, total - settled),
    overpaid: Math.max(0, settled - total),
  };
}

export type ComputedStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'WAIVED';

/**
 * The status an invoice should carry, derived rather than set by hand.
 *
 * OVERDUE is a function of the clock, so it is computed on read. Storing it would mean a
 * nightly job whose failure silently tells a bursar that nobody owes anything.
 */
export function statusFor(
  balance: InvoiceBalance,
  dueDate: Date,
  now: Date,
  options: { isWaived?: boolean } = {},
): ComputedStatus {
  if (options.isWaived) return 'WAIVED';
  if (balance.outstanding === 0) return 'PAID';
  // A part-paid invoice past its date is still overdue: the bursar chases the balance.
  if (now > dueDate) return 'OVERDUE';
  return balance.paid > 0 || balance.credited > 0 ? 'PARTIAL' : 'UNPAID';
}

/** The aging buckets the accounts office works in. */
export const AGING_BUCKETS = ['CURRENT', '0-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: Date, now: Date): AgingBucket {
  const days = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
  if (days < 0) return 'CURRENT';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function daysOverdue(dueDate: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000));
}

/**
 * Voucher numbers.
 *
 * Human-readable and sortable: the bursar reads these down a bank statement, and a random
 * id is unusable at a counter. The school prefix keeps them distinguishable when a family
 * has children at two campuses on the same platform.
 */
export function voucherNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Compares two voucher numbers loosely, for reconciliation.
 *
 * A bank statement narration is typed by a cashier: it drops the prefix, loses the dashes,
 * pads differently, or arrives with the family's name glued to the front. Matching on
 * exact equality finds almost nothing.
 */
export function voucherDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * The runs of digits in a string, each kept separate.
 *
 * Flattening a whole narration to digits invents numbers that were never written: a line
 * reading "FEE TST-2026-000003 TRXREC1" collapses to "20260000031", which contains
 * "000031" — the sequence of a completely different voucher. A voucher number is a
 * contiguous run, so the comparison has to respect the boundaries.
 */
export function digitRuns(value: string): string[] {
  return value.match(/\d+/g) ?? [];
}
