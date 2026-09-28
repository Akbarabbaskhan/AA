import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { Report } from '@/lib/services/reports';

/**
 * A report as a PDF, for the version that gets printed and taken into a meeting.
 *
 * Portrait A4 where the table is narrow, landscape where it is wide — an at-risk list with ten
 * columns squeezed onto portrait is the sort of PDF nobody opens twice. Rows repeat their
 * header on every page, because a printed table whose headings are on page one only is a table
 * somebody has to hold two sheets up to read.
 */

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: '#111827', fontFamily: 'Helvetica' },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    paddingBottom: 8,
  },
  school: { fontSize: 10, color: '#6B7280' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  subtitle: { fontSize: 10, color: '#4B5563', marginTop: 2 },
  headline: { flexDirection: 'row', gap: 18, marginTop: 8, marginBottom: 4 },
  headlineItem: { flexDirection: 'column' },
  headlineLabel: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase' },
  headlineValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  tableTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
  headRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  headCell: { paddingVertical: 4, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 7,
    color: '#9CA3AF',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  empty: { fontSize: 9, color: '#6B7280', fontStyle: 'italic', marginTop: 4 },
});

function widthsFor(columns: { header: string; width?: number }[]): string[] {
  const total = columns.reduce((sum, column) => sum + (column.width ?? 14), 0);
  return columns.map((column) => `${(((column.width ?? 14) / total) * 100).toFixed(2)}%`);
}

function cellText(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value;
}

export type ReportPdfOptions = { schoolName: string; generatedBy: string };

export function ReportDocument({ report, options }: { report: Report; options: ReportPdfOptions }) {
  // More than six columns anywhere and the whole report goes landscape: a mixed orientation
  // document is worse to read than a wide one.
  const widest = Math.max(...report.tables.map((table) => table.columns.length), 1);
  const orientation = widest > 6 ? 'landscape' : 'portrait';

  return (
    <Document title={report.title} author={options.schoolName}>
      <Page size="A4" orientation={orientation} style={styles.page} wrap>
        <View style={styles.header} fixed>
          <Text style={styles.school}>{options.schoolName}</Text>
          <Text style={styles.title}>{report.title}</Text>
          <Text style={styles.subtitle}>{report.subtitle}</Text>
          <View style={styles.headline}>
            {report.headline.map((entry) => (
              <View key={entry.label} style={styles.headlineItem}>
                <Text style={styles.headlineLabel}>{entry.label}</Text>
                <Text style={styles.headlineValue}>{entry.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {report.tables.map((table) => {
          const widths = widthsFor(table.columns);
          return (
            <View key={table.name}>
              <Text style={styles.tableTitle}>{table.name}</Text>

              {table.rows.length === 0 ? (
                <Text style={styles.empty}>Nothing to report.</Text>
              ) : (
                <>
                  {/* Repeated on every page the table runs onto. */}
                  <View style={styles.headRow} fixed>
                    {table.columns.map((column, index) => (
                      <Text key={column.header} style={[styles.headCell, { width: widths[index] }]}>
                        {column.header}
                      </Text>
                    ))}
                  </View>

                  {table.rows.map((row, rowIndex) => (
                    <View key={`${table.name}-${rowIndex}`} style={styles.row} wrap={false}>
                      {row.map((value, index) => (
                        <Text
                          key={`${table.name}-${rowIndex}-${index}`}
                          style={[
                            styles.cell,
                            {
                              width: widths[index],
                              textAlign:
                                typeof value === 'number' || table.columns[index]?.align === 'end'
                                  ? 'right'
                                  : 'left',
                            },
                          ]}
                        >
                          {cellText(value)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </>
              )}
            </View>
          );
        })}

        <View style={styles.footer} fixed>
          <Text>
            {options.schoolName} · {report.title} · generated{' '}
            {report.generatedAt.slice(0, 16).replace('T', ' ')} UTC
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(report: Report, options: ReportPdfOptions): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} options={options} />);
}
