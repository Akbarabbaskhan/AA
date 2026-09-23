import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import { amountInWords, formatPaisa, type LineItem } from '@/lib/services/fees/money';

/**
 * The fee voucher — a bank challan.
 *
 * "Ask LGS for their current voucher and replicate the fields, including the bank challan
 * copy sections. Schools will not switch to a voucher their bank rejects."
 *
 * So this is not a styled invoice. It is the layout a Pakistani bank counter already
 * accepts: three identical copies across one A4 landscape sheet, each headed with who
 * keeps it — Bank, School, Student — each carrying the full particulars, the amount in
 * figures and in words, the due date, and a signature and stamp block. A cashier processes
 * it without reading anything new.
 *
 * Deliberate choices a bank counter cares about:
 *   Every copy is complete. A copy that says "see other portion" is one the cashier
 *   detaches and then cannot file.
 *   The voucher number appears at the top of each copy in mono, because it is what gets
 *   written onto the deposit slip and later read off the statement.
 *   The amount appears in words. A figure alone invites a query, and a challan queried at
 *   the counter is a parent sent home.
 */

export type VoucherData = {
  school: {
    name: string;
    address: string | null;
    contactPhone: string | null;
    brandColour: string;
  };
  bank: {
    name: string;
    accountTitle: string;
    accountNumber: string;
    branch: string | null;
  };
  student: {
    name: string;
    rollNumber: string;
    admissionNumber: string;
    yearGroup: string | null;
    guardianName: string | null;
  };
  invoice: {
    voucherNumber: string;
    periodLabel: string;
    issueDate: string;
    dueDate: string;
    lineItems: LineItem[];
    discountPaisa: number;
    totalPaisa: number;
    /** Charged by some schools after the due date; printed only when set. */
    lateFeePaisa: number | null;
  };
};

/** Three copies across the sheet, in the order a counter separates them. */
const COPIES = ['Bank Copy', 'School Copy', 'Student Copy'] as const;

const styles = StyleSheet.create({
  page: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 14,
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: '#111111',
    flexDirection: 'row',
    gap: 8,
  },
  copy: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#111111',
    padding: 8,
    // A dashed separator is what tells a cashier this sheet is meant to be cut.
    borderStyle: 'dashed',
  },
  copyLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 4,
    paddingBottom: 3,
    borderBottomWidth: 1,
  },
  schoolName: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  schoolMeta: { fontSize: 6, color: '#555555', textAlign: 'center', marginTop: 1 },

  voucherNo: {
    fontSize: 9,
    fontFamily: 'Courier-Bold',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },

  bankBlock: {
    borderWidth: 1,
    borderColor: '#999999',
    padding: 4,
    marginBottom: 5,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1.5 },
  label: { color: '#555555' },
  value: { fontFamily: 'Helvetica-Bold', textAlign: 'right', flexShrink: 1 },
  mono: { fontFamily: 'Courier' },

  table: { marginTop: 4, marginBottom: 4 },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingBottom: 2,
    marginBottom: 2,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 1.2 },
  cellLabel: { flex: 1 },
  cellAmount: { width: 56, textAlign: 'right', fontFamily: 'Courier' },

  totalRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 3,
    marginTop: 2,
  },
  totalLabel: { flex: 1, fontFamily: 'Helvetica-Bold' },
  totalAmount: { width: 56, textAlign: 'right', fontFamily: 'Courier-Bold', fontSize: 8 },

  words: {
    marginTop: 4,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: '#999999',
    fontSize: 6.5,
  },

  dueBox: {
    marginTop: 5,
    borderWidth: 1,
    padding: 3,
    textAlign: 'center',
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
  },

  signatures: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  signature: {
    width: '46%',
    borderTopWidth: 0.5,
    borderTopColor: '#111111',
    paddingTop: 2,
    fontSize: 6,
    textAlign: 'center',
    color: '#555555',
  },
  footNote: { marginTop: 6, fontSize: 5.5, color: '#777777', textAlign: 'center' },
});

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={mono ? [styles.value, styles.mono] : styles.value}>{value}</Text>
    </View>
  );
}

function Copy({ data, title }: { data: VoucherData; title: string }) {
  const { school, bank, student, invoice } = data;

  return (
    <View style={styles.copy}>
      <Text style={[styles.copyLabel, { borderBottomColor: school.brandColour }]}>{title}</Text>

      <Text style={styles.schoolName}>{school.name}</Text>
      {school.address ? <Text style={styles.schoolMeta}>{school.address}</Text> : null}
      {school.contactPhone ? <Text style={styles.schoolMeta}>{school.contactPhone}</Text> : null}

      <Text style={[styles.voucherNo, { color: school.brandColour }]}>{invoice.voucherNumber}</Text>

      {/* The bank block sits above the particulars: it is what the cashier keys in first. */}
      <View style={styles.bankBlock}>
        <Field label="Bank" value={bank.name} />
        <Field label="Account title" value={bank.accountTitle} />
        <Field label="Account no." value={bank.accountNumber} mono />
        {bank.branch ? <Field label="Branch" value={bank.branch} /> : null}
      </View>

      <Field label="Student" value={student.name} />
      <Field label="Roll no." value={student.rollNumber} mono />
      <Field label="Admission no." value={student.admissionNumber} mono />
      {student.yearGroup ? <Field label="Class" value={student.yearGroup} /> : null}
      {student.guardianName ? <Field label="Guardian" value={student.guardianName} /> : null}
      <Field label="Period" value={invoice.periodLabel} />
      <Field label="Issued" value={invoice.issueDate} />

      <View style={styles.table}>
        <View style={styles.tableHead}>
          <Text style={styles.cellLabel}>Particulars</Text>
          <Text style={styles.cellAmount}>PKR</Text>
        </View>

        {invoice.lineItems.map((item) => (
          <View key={`${item.feeHeadId}-${item.label}`} style={styles.tableRow}>
            <Text style={styles.cellLabel}>{item.label}</Text>
            <Text style={styles.cellAmount}>{formatPaisa(item.amountPaisa)}</Text>
          </View>
        ))}

        {invoice.discountPaisa > 0 ? (
          <View style={styles.tableRow}>
            <Text style={styles.cellLabel}>Less: concession</Text>
            <Text style={styles.cellAmount}>({formatPaisa(invoice.discountPaisa)})</Text>
          </View>
        ) : null}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Payable by due date</Text>
          <Text style={styles.totalAmount}>{formatPaisa(invoice.totalPaisa)}</Text>
        </View>

        {invoice.lateFeePaisa !== null && invoice.lateFeePaisa > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Payable after due date</Text>
            <Text style={styles.totalAmount}>
              {formatPaisa(invoice.totalPaisa + invoice.lateFeePaisa)}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.words}>Rupees {amountInWords(invoice.totalPaisa)}</Text>

      <Text style={[styles.dueBox, { borderColor: school.brandColour }]}>
        Due on {invoice.dueDate}
      </Text>

      <View style={styles.signatures}>
        <Text style={styles.signature}>Depositor&apos;s signature</Text>
        <Text style={styles.signature}>Bank stamp &amp; signature</Text>
      </View>

      <Text style={styles.footNote}>
        Quote the voucher number on the deposit slip. Retain this copy as proof of payment.
      </Text>
    </View>
  );
}

/**
 * One A4 landscape sheet per voucher, three copies across it.
 *
 * `wrap={false}` because a challan that spills onto a second page is one the bank will not
 * accept, and a silent overflow is exactly the failure that only shows up in production.
 */
export function VoucherDocument({ vouchers }: { vouchers: readonly VoucherData[] }) {
  return (
    <Document>
      {vouchers.map((voucher) => (
        <Page key={voucher.invoice.voucherNumber} size="A4" orientation="landscape" style={styles.page} wrap={false}>
          {COPIES.map((title) => (
            <Copy key={title} data={voucher} title={title} />
          ))}
        </Page>
      ))}
    </Document>
  );
}

export async function renderVouchers(vouchers: readonly VoucherData[]): Promise<Buffer> {
  return renderToBuffer(<VoucherDocument vouchers={vouchers} />);
}
