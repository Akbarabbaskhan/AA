import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  amountInWords,
  applyDiscounts,
  balanceOf,
  daysOverdue,
  formatPaisa,
  rupeesToPaisa,
  statusFor,
  subtotalOf,
  voucherDigits,
  voucherNumber,
} from '@/lib/services/fees/money';
import { parseStatement, scoreMatch } from '@/lib/services/fees/reconciliation';
import { digitRuns } from '@/lib/services/fees/money';
import { defaultersToCsv } from '@/lib/services/fees/reports';

const DAY = 86_400_000;

describe('formatPaisa', () => {
  it('groups rupees and hides an exact zero paisa remainder', () => {
    expect(formatPaisa(1_250_000)).toBe('12,500');
  });

  it('shows the paisa when there are any', () => {
    expect(formatPaisa(1_250_050)).toBe('12,500.50');
  });

  it('formats zero as zero, not as an empty string', () => {
    expect(formatPaisa(0)).toBe('0');
  });

  it('keeps a negative readable', () => {
    expect(formatPaisa(-50_000)).toBe('-500');
  });

  it('round-trips rupees', () => {
    expect(formatPaisa(rupeesToPaisa(12_500))).toBe('12,500');
  });
});

describe('amountInWords', () => {
  it('writes a fee in the lakh grouping a Pakistani challan uses', () => {
    expect(amountInWords(rupeesToPaisa(125_000))).toBe('one lakh twenty-five thousand rupees only');
  });

  it('handles a plain four-figure amount', () => {
    expect(amountInWords(rupeesToPaisa(12_500))).toBe('twelve thousand five hundred rupees only');
  });

  it('joins hundreds with "and"', () => {
    expect(amountInWords(rupeesToPaisa(1_250))).toBe('one thousand two hundred and fifty rupees only');
  });

  it('reads the teens correctly', () => {
    expect(amountInWords(rupeesToPaisa(19))).toBe('nineteen rupees only');
  });

  it('does not write a zero amount as an empty string', () => {
    expect(amountInWords(0)).toBe('zero rupees only');
  });

  it('reaches crore without losing a group', () => {
    expect(amountInWords(rupeesToPaisa(12_345_678))).toContain('crore');
    expect(amountInWords(rupeesToPaisa(12_345_678))).toContain('lakh');
  });
});

describe('applyDiscounts', () => {
  const subtotal = rupeesToPaisa(20_000);

  it('applies a percentage against the full subtotal', () => {
    const result = applyDiscounts(subtotal, [
      { type: 'PERCENT', value: 1_250, reason: 'Sibling' },
    ]);
    expect(result.discountPaisa).toBe(rupeesToPaisa(2_500));
    expect(result.totalPaisa).toBe(rupeesToPaisa(17_500));
  });

  it('applies percentages before fixed amounts, so a waiver never shrinks a scholarship', () => {
    const withFixedFirst = applyDiscounts(subtotal, [
      { type: 'FIXED', value: rupeesToPaisa(5_000), reason: 'Waiver' },
      { type: 'PERCENT', value: 2_500, reason: 'Scholarship' },
    ]);
    // 25% of the full 20,000 is 5,000, plus the 5,000 waiver.
    expect(withFixedFirst.discountPaisa).toBe(rupeesToPaisa(10_000));
  });

  it('never makes the school owe the family money', () => {
    const result = applyDiscounts(subtotal, [
      { type: 'FIXED', value: rupeesToPaisa(50_000), reason: 'Full waiver' },
    ]);
    expect(result.discountPaisa).toBe(subtotal);
    expect(result.totalPaisa).toBe(0);
  });

  it('names every discount it applied, for the voucher', () => {
    const result = applyDiscounts(subtotal, [
      { type: 'PERCENT', value: 1_000, reason: 'Sibling' },
      { type: 'FIXED', value: rupeesToPaisa(1_000), reason: 'Staff child' },
    ]);
    expect(result.applied.map((entry) => entry.reason)).toEqual(['Sibling', 'Staff child']);
  });

  it('ignores a zero-value rule rather than listing it', () => {
    expect(applyDiscounts(subtotal, [{ type: 'FIXED', value: 0, reason: 'None' }]).applied).toEqual([]);
  });
});

describe('balanceOf', () => {
  const total = rupeesToPaisa(12_500);

  it('counts credit notes towards settlement exactly as payments do', () => {
    const balance = balanceOf(total, [{ amount: rupeesToPaisa(10_000) }], [{ amount: rupeesToPaisa(2_500) }]);
    expect(balance.outstanding).toBe(0);
  });

  it('reports an overpayment rather than hiding it', () => {
    const balance = balanceOf(total, [{ amount: rupeesToPaisa(15_000) }]);
    expect(balance.outstanding).toBe(0);
    expect(balance.overpaid).toBe(rupeesToPaisa(2_500));
  });

  it('never returns a negative outstanding', () => {
    expect(balanceOf(total, [{ amount: total * 2 }]).outstanding).toBe(0);
  });
});

describe('statusFor', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');
  const future = new Date('2026-10-10T00:00:00.000Z');
  const past = new Date('2026-08-10T00:00:00.000Z');
  const total = rupeesToPaisa(10_000);

  it('is PAID once nothing is outstanding, even past the due date', () => {
    const balance = balanceOf(total, [{ amount: total }]);
    expect(statusFor(balance, past, now)).toBe('PAID');
  });

  it('is OVERDUE when part-paid and past the date — the bursar still chases the balance', () => {
    const balance = balanceOf(total, [{ amount: rupeesToPaisa(4_000) }]);
    expect(statusFor(balance, past, now)).toBe('OVERDUE');
  });

  it('is PARTIAL when part-paid and still in date', () => {
    const balance = balanceOf(total, [{ amount: rupeesToPaisa(4_000) }]);
    expect(statusFor(balance, future, now)).toBe('PARTIAL');
  });

  it('is UNPAID when nothing has been paid and it is not yet due', () => {
    expect(statusFor(balanceOf(total, []), future, now)).toBe('UNPAID');
  });

  it('respects a waiver over everything else', () => {
    expect(statusFor(balanceOf(total, []), past, now, { isWaived: true })).toBe('WAIVED');
  });
});

describe('aging', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');

  it('calls a future due date current rather than putting it in a bucket', () => {
    expect(agingBucket(new Date(now.getTime() + 5 * DAY), now)).toBe('CURRENT');
  });

  it('puts the boundaries in the lower bucket', () => {
    expect(agingBucket(new Date(now.getTime() - 30 * DAY), now)).toBe('0-30');
    expect(agingBucket(new Date(now.getTime() - 31 * DAY), now)).toBe('31-60');
    expect(agingBucket(new Date(now.getTime() - 60 * DAY), now)).toBe('31-60');
    expect(agingBucket(new Date(now.getTime() - 90 * DAY), now)).toBe('61-90');
    expect(agingBucket(new Date(now.getTime() - 91 * DAY), now)).toBe('90+');
  });

  it('never reports negative days overdue', () => {
    expect(daysOverdue(new Date(now.getTime() + 10 * DAY), now)).toBe(0);
  });
});

describe('voucher numbers', () => {
  it('pads the sequence so the numbers sort as text', () => {
    expect(voucherNumber('LGS', 2026, 42)).toBe('LGS-2026-000042');
    const numbers = [1, 2, 10, 100].map((n) => voucherNumber('LGS', 2026, n));
    expect([...numbers].sort()).toEqual(numbers);
  });

  it('reduces to digits for a loose statement comparison', () => {
    expect(voucherDigits('LGS-2026-000042')).toBe('2026000042');
  });

  it('keeps separate digit runs apart rather than concatenating them', () => {
    expect(digitRuns('FEE TST-2026-000003 TRXREC1')).toEqual(['2026', '000003', '1']);
    expect(digitRuns('no digits here')).toEqual([]);
  });
});

describe('parseStatement', () => {
  const header = 'Date,Description,Credit,Reference';

  it('reads a plain statement', () => {
    const { lines, errors } = parseStatement(
      `${header}\n01/09/2026,"FEE LGS-2026-000042",12500,TRX9001`,
    );
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.amountPaisa).toBe(rupeesToPaisa(12_500));
    expect(lines[0]?.date).toBe('2026-09-01');
    expect(lines[0]?.reference).toBe('TRX9001');
  });

  it('strips thousands separators and currency noise the bank prints', () => {
    const { lines } = parseStatement(`${header}\n01/09/2026,"FEE","PKR 1,25,000.00",X1`);
    expect(lines[0]?.amountPaisa).toBe(rupeesToPaisa(125_000));
  });

  it('ignores debits — only money coming in settles a voucher', () => {
    const { lines } = parseStatement(`${header}\n01/09/2026,"BANK CHARGES",(500),X1`);
    expect(lines).toHaveLength(0);
  });

  it('says what is missing rather than returning an empty list silently', () => {
    const { errors } = parseStatement('Date,Something\n01/09/2026,x');
    expect(errors.join(' ')).toMatch(/credit or amount/i);
  });

  it('accepts the alternative column names Pakistani banks use', () => {
    const { lines, errors } = parseStatement(
      'Value Date,Particulars,Deposit\n2026-09-01,"FEE 000042",12500',
    );
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it('does not let a Debit Amount column answer to "amount"', () => {
    const { lines } = parseStatement(
      'Date,Particulars,Debit Amount,Credit Amount\n2026-09-01,"FEE",0,12500',
    );
    expect(lines[0]?.amountPaisa).toBe(rupeesToPaisa(12_500));
  });

  it('skips a blank row rather than reporting it', () => {
    const { lines } = parseStatement(`${header}\n,,,\n01/09/2026,"FEE",100,X`);
    expect(lines).toHaveLength(1);
  });
});

describe('scoreMatch', () => {
  const invoice = {
    voucherNumber: 'LGS-2026-000042',
    outstanding: rupeesToPaisa(12_500),
    studentName: 'Ahmed Raza Khan',
    rollNumber: 'AS1-0042',
  };

  function line(narration: string, amount = rupeesToPaisa(12_500)) {
    return { rowNumber: 2, date: '2026-09-01', narration, amountPaisa: amount, reference: null };
  }

  it('is confident when the voucher number and the amount both match', () => {
    const { score, reasons } = scoreMatch(line('FEE LGS-2026-000042'), invoice);
    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(reasons).toContain('voucher number in full');
    expect(reasons).toContain('exact amount');
  });

  it('still finds it when the cashier dropped the prefix and the dashes', () => {
    const { score, reasons } = scoreMatch(line('SCHOOL FEE 2026000042'), invoice);
    expect(score).toBeGreaterThanOrEqual(0.85);
    expect(reasons).toContain('voucher sequence');
  });

  it('forgives a rupee of bank rounding', () => {
    const { reasons } = scoreMatch(line('LGS-2026-000042', rupeesToPaisa(12_500) - 50), invoice);
    expect(reasons).toContain('amount within a rupee');
  });

  it('will not match on the amount alone — half a school pays the same tuition', () => {
    const { score } = scoreMatch(line('CASH DEPOSIT'), invoice);
    expect(score).toBeLessThan(0.5);
  });

  it('uses the roll number when the narration carries it', () => {
    const { reasons } = scoreMatch(line('FEE AS1-0042'), invoice);
    expect(reasons).toContain('roll number');
  });

  it('ignores a short name that would match half the school', () => {
    const short = { ...invoice, studentName: 'Ali Ali' };
    const { reasons } = scoreMatch(line('TRANSFER FROM ALI'), short);
    expect(reasons).not.toContain('surname');
  });

  it('does not invent a voucher number across the narration and the reference', () => {
    /*
     * The regression this pins: flattening "FEE TST-2026-000003 TRXREC1" to digits yields
     * "20260000031", which contains "000031" — the sequence of a different voucher that
     * appears nowhere in the line. The matcher compares contiguous runs for that reason.
     */
    const neighbour = { ...invoice, voucherNumber: 'TST-2026-000031' };
    const statement = {
      rowNumber: 2,
      date: '2026-09-01',
      narration: 'FEE TST-2026-000003',
      amountPaisa: rupeesToPaisa(12_500),
      reference: 'TRXREC1',
    };

    const { reasons } = scoreMatch(statement, neighbour);
    expect(reasons).not.toContain('voucher sequence');
    expect(reasons).not.toContain('voucher number in full');
  });

  it('still finds the sequence inside a single run of digits', () => {
    const statement = {
      rowNumber: 2,
      date: '2026-09-01',
      narration: 'SCHOOL FEE 2026000042 SEPT',
      amountPaisa: rupeesToPaisa(12_500),
      reference: null,
    };
    expect(scoreMatch(statement, invoice).reasons).toContain('voucher sequence');
  });

  it('never exceeds one however many signals line up', () => {
    const { score } = scoreMatch(line('LGS-2026-000042 AS1-0042 KHAN'), invoice);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('defaultersToCsv', () => {
  const row = {
    studentId: 'x',
    studentName: 'Ahmed, Raza',
    rollNumber: 'AS1-0042',
    yearGroupName: 'AS Level 1',
    guardianName: 'Imran "Bhai" Khan',
    guardianPhone: '+923001234567',
    invoiceCount: 2,
    outstanding: rupeesToPaisa(25_000),
    oldestDueDate: '2026-07-10',
    daysOverdue: 75,
    bucket: '61-90' as const,
  };

  it('quotes a name containing a comma so the columns do not shift', () => {
    const csv = defaultersToCsv([row]);
    expect(csv.split('\n')[1]).toContain('"Ahmed, Raza"');
  });

  it('doubles an embedded quote rather than breaking the field', () => {
    expect(defaultersToCsv([row])).toContain('"Imran ""Bhai"" Khan"');
  });

  it('writes the outstanding amount in rupees, not paisa', () => {
    expect(defaultersToCsv([row])).toContain('25000');
  });

  it('keeps the header even when there are no defaulters', () => {
    expect(defaultersToCsv([]).split('\n')).toHaveLength(1);
  });
});

describe('subtotalOf', () => {
  it('adds line items without floating point drift', () => {
    const items = Array.from({ length: 3 }, (_, index) => ({
      feeHeadId: `h${index}`,
      label: 'Fee',
      amountPaisa: 333_33,
    }));
    expect(subtotalOf(items)).toBe(999_99);
  });
});
