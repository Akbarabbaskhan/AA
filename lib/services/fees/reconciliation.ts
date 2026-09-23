import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireCapability, type Actor } from '@/lib/permissions';
import { parseCsv, detectDelimiter } from '@/lib/services/import/csv';
import { balanceOf, digitRuns, rupeesToPaisa, voucherDigits } from './money';
import { recordPayment } from './payments';

/**
 * Bank statement reconciliation.
 *
 * The spec calls this "the accounts office's biggest daily pain", and it is: a bank
 * statement arrives as a CSV of narrations a cashier typed, and somebody matches each line
 * to a voucher by eye. Two hundred rows, every month, by hand.
 *
 * The job here is not to be clever. It is to be *right about what it is sure of* and
 * honest about the rest: a confident match is proposed, an ambiguous one is shown with its
 * candidates, and nothing is ever posted without a person pressing the button. A
 * reconciliation tool that silently mis-posts one payment in a hundred is worse than the
 * spreadsheet, because nobody checks it.
 */

/** Below this, a candidate is not offered at all — a weak guess costs more than no guess. */
const MIN_SCORE = 0.5;
/** At or above this, and unambiguously ahead of the runner-up, the match is proposed. */
const CONFIDENT_SCORE = 0.9;
/** The runner-up must be this far behind, or the row is ambiguous however high the score. */
const AMBIGUITY_MARGIN = 0.15;

export type StatementLine = {
  rowNumber: number;
  date: string;
  narration: string;
  amountPaisa: number;
  /** The bank's own reference, where the statement has a column for it. */
  reference: string | null;
};

const HEADER_ALIASES = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'posting date'],
  narration: ['narration', 'description', 'particulars', 'details', 'remarks', 'transaction details'],
  credit: ['credit', 'deposit', 'amount', 'credit amount', 'cr', 'deposits'],
  reference: ['reference', 'ref', 'cheque no', 'instrument no', 'utr', 'transaction id'],
} as const;

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

function columnFor(headers: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = headers.findIndex((header) => normalise(header) === alias);
    if (index !== -1) return index;
  }
  // Only after exact matches fail, and only on whole words, so "Debit Amount" does not
  // answer to "amount" while a real "Amount" column sits further along.
  for (const alias of aliases) {
    const index = headers.findIndex((header) =>
      new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s)`).test(normalise(header)),
    );
    if (index !== -1) return index;
  }
  return -1;
}

function parseAmount(raw: string): number | null {
  // Statements arrive with thousands separators, currency prefixes, trailing CR/DR, and
  // parenthesised negatives. A Number() on any of those silently yields NaN.
  const cleaned = raw
    .replace(/[^\d.,()-]/g, '')
    .replace(/,/g, '')
    .trim();
  if (cleaned === '') return null;
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith('-');
  const value = Number(cleaned.replace(/[()-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return rupeesToPaisa(negative ? -value : value);
}

function parseDate(raw: string): string | null {
  const text = raw.trim();
  // ISO first, then the two day-first formats Pakistani banks actually emit.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(text);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    return `${year}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function parseStatement(text: string): { lines: StatementLine[]; errors: string[] } {
  const table = parseCsv(text, detectDelimiter(text.slice(0, 4000)));
  const errors: string[] = [];

  const dateAt = columnFor(table.headers, HEADER_ALIASES.date);
  const narrationAt = columnFor(table.headers, HEADER_ALIASES.narration);
  const creditAt = columnFor(table.headers, HEADER_ALIASES.credit);
  const referenceAt = columnFor(table.headers, HEADER_ALIASES.reference);

  if (creditAt === -1) errors.push('No credit or amount column found.');
  if (narrationAt === -1 && referenceAt === -1) {
    errors.push('No narration or reference column found — there is nothing to match on.');
  }
  if (errors.length > 0) return { lines: [], errors };

  const lines: StatementLine[] = [];
  table.rows.forEach((row, index) => {
    if (row.every((cell) => cell.trim() === '')) return;
    const amount = parseAmount(row[creditAt] ?? '');
    // Debits are the school paying somebody; only money coming in settles a voucher.
    if (amount === null || amount <= 0) return;

    lines.push({
      rowNumber: index + 2,
      date: (dateAt === -1 ? null : parseDate(row[dateAt] ?? '')) ?? '',
      narration: (narrationAt === -1 ? '' : row[narrationAt] ?? '').trim(),
      amountPaisa: amount,
      reference: referenceAt === -1 ? null : (row[referenceAt] ?? '').trim() || null,
    });
  });

  return { lines, errors };
}

export type MatchCandidate = {
  invoiceId: string;
  voucherNumber: string;
  studentName: string;
  rollNumber: string;
  outstanding: number;
  score: number;
  /** Why it matched, in words the bursar can check against the row. */
  reasons: string[];
};

export type ReconciliationRow = {
  line: StatementLine;
  /** CONFIDENT: one clear winner. AMBIGUOUS: several plausible. UNMATCHED: nothing. */
  verdict: 'CONFIDENT' | 'AMBIGUOUS' | 'UNMATCHED';
  candidates: MatchCandidate[];
};

/**
 * Scores one invoice against one statement line.
 *
 * The voucher number carries almost all the signal, so it is weighted accordingly — but a
 * cashier retyping it drops the prefix and the dashes, so the comparison is on digits, and
 * a suffix match counts nearly as much as the whole thing. The amount is a strong
 * confirmation and a weak identifier on its own: half a school pays the same tuition.
 */
export function scoreMatch(
  line: StatementLine,
  invoice: { voucherNumber: string; outstanding: number; studentName: string; rollNumber: string },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const haystack = `${line.narration} ${line.reference ?? ''}`;
  // Runs, not one flattened string: see `digitRuns`. Joining them would match a sequence
  // that spans the gap between the narration and the reference and exists in neither.
  const runs = digitRuns(haystack);
  const voucher = invoice.voucherNumber;
  const sequence = voucherDigits(voucher).slice(-6);

  if (haystack.toLowerCase().includes(voucher.toLowerCase())) {
    score += 0.7;
    reasons.push('voucher number in full');
  } else if (sequence.length === 6 && runs.some((run) => run.includes(sequence))) {
    score += 0.55;
    reasons.push('voucher sequence');
  }

  if (line.amountPaisa === invoice.outstanding) {
    score += 0.3;
    reasons.push('exact amount');
  } else if (Math.abs(line.amountPaisa - invoice.outstanding) <= 100) {
    // A rupee either way is a bank rounding a fee, not a different payment.
    score += 0.2;
    reasons.push('amount within a rupee');
  }

  const roll = invoice.rollNumber.toLowerCase();
  if (roll.length >= 4 && haystack.toLowerCase().includes(roll)) {
    score += 0.25;
    reasons.push('roll number');
  }

  // A surname in the narration is weak on its own and useful as a tiebreak. Names shorter
  // than four characters match half the school, so they are ignored.
  const surname = invoice.studentName.split(/\s+/).at(-1)?.toLowerCase() ?? '';
  if (surname.length >= 4 && haystack.toLowerCase().includes(surname)) {
    score += 0.15;
    reasons.push('surname');
  }

  return { score: Math.min(1, score), reasons };
}

export const reconcileQuerySchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  academicYearId: z.string().uuid().optional(),
});

/**
 * Proposes matches for a statement.
 *
 * Read-only: it posts nothing. The bursar reviews and confirms, because an auto-posted
 * wrong match is a family told they have not paid when they have.
 */
export async function proposeMatches(
  actor: Actor,
  raw: z.infer<typeof reconcileQuerySchema>,
): Promise<{ rows: ReconciliationRow[]; errors: string[]; summary: { confident: number; ambiguous: number; unmatched: number } }> {
  requireCapability(actor, 'payment.reconcile');
  const input = reconcileQuerySchema.parse(raw);

  const { lines, errors } = parseStatement(input.csv);
  if (errors.length > 0) {
    return { rows: [], errors, summary: { confident: 0, ambiguous: 0, unmatched: 0 } };
  }

  const open = await prisma.invoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      ...(input.academicYearId ? { academicYearId: input.academicYearId } : {}),
    },
    select: {
      id: true,
      voucherNumber: true,
      total: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
    },
  });

  const invoices = open
    .map((invoice) => ({
      invoiceId: invoice.id,
      voucherNumber: invoice.voucherNumber,
      studentName: invoice.student.user.name,
      rollNumber: invoice.student.rollNumber,
      outstanding: balanceOf(invoice.total, invoice.payments, invoice.creditNotes).outstanding,
    }))
    .filter((invoice) => invoice.outstanding > 0);

  const rows: ReconciliationRow[] = lines.map((line) => {
    const scored = invoices
      .map((invoice) => {
        const { score, reasons } = scoreMatch(line, invoice);
        return { ...invoice, score, reasons };
      })
      .filter((candidate) => candidate.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const best = scored[0];
    const runnerUp = scored[1];

    if (!best) return { line, verdict: 'UNMATCHED' as const, candidates: [] };

    const clear = !runnerUp || best.score - runnerUp.score >= AMBIGUITY_MARGIN;
    const verdict = best.score >= CONFIDENT_SCORE && clear ? 'CONFIDENT' : 'AMBIGUOUS';
    return { line, verdict, candidates: scored };
  });

  return {
    rows,
    errors: [],
    summary: {
      confident: rows.filter((row) => row.verdict === 'CONFIDENT').length,
      ambiguous: rows.filter((row) => row.verdict === 'AMBIGUOUS').length,
      unmatched: rows.filter((row) => row.verdict === 'UNMATCHED').length,
    },
  };
}

export const confirmMatchesSchema = z.object({
  matches: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        amountPaisa: z.number().int().min(1),
        reference: z.string().min(1).max(120),
        paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type ConfirmResult = {
  posted: number;
  /** Rows that could not be posted, with the reason — never silently dropped. */
  failed: { invoiceId: string; reference: string; reason: string }[];
};

/**
 * Posts the matches the bursar confirmed.
 *
 * Each row goes through the ordinary payment path, so it gets the same duplicate-reference
 * guard, the same status sync and the same audit entry as a payment typed in by hand. A
 * bulk importer with its own shortcut write is how a module ends up with two versions of
 * the truth.
 *
 * A failure on one row does not abandon the rest: a bursar who imported ninety rows wants
 * the eighty-eight that worked plus a list of the two that did not.
 */
export async function confirmMatches(
  actor: Actor,
  raw: z.infer<typeof confirmMatchesSchema>,
): Promise<ConfirmResult> {
  requireCapability(actor, 'payment.reconcile');
  const input = confirmMatchesSchema.parse(raw);

  let posted = 0;
  const failed: ConfirmResult['failed'] = [];

  for (const match of input.matches) {
    try {
      await recordPayment(actor, {
        invoiceId: match.invoiceId,
        amount: match.amountPaisa,
        method: 'BANK',
        reference: match.reference,
        ...(match.paidAt ? { paidAt: new Date(`${match.paidAt}T00:00:00.000Z`) } : {}),
      });
      posted += 1;
    } catch (error) {
      failed.push({
        invoiceId: match.invoiceId,
        reference: match.reference,
        reason: error instanceof Error ? error.message : 'Could not post',
      });
    }
  }

  return { posted, failed };
}
