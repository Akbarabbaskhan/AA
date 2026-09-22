import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { ResultCardAggregate } from '@/lib/services/exams/publish';

/**
 * The result card PDF.
 *
 * "It must print cleanly on A4 in one page per student." Rendered server-side with no
 * browser, so the same code runs in a container on a 4-vCPU VPS as it does locally.
 *
 * The card carries what the spec lists: student details and photo, school branding,
 * per-subject component breakdown, subject grade, teacher remarks, attendance percentage
 * for the term, the class average for comparison, and signature blocks.
 *
 * Colours are literal here rather than CSS variables because a PDF has no cascade — the
 * tenant's brand colour is passed in and applied explicitly.
 */

export type ResultCardData = {
  school: { name: string; address: string | null; brandColour: string; logoUrl: string | null };
  student: {
    name: string;
    rollNumber: string;
    admissionNumber: string;
    yearGroup: string | null;
    house: string | null;
    photoUrl: string | null;
  };
  aggregate: ResultCardAggregate;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111111',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    paddingBottom: 8,
    marginBottom: 10,
  },
  schoolName: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  schoolMeta: { fontSize: 8, color: '#555555', marginTop: 2 },
  seriesName: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  seriesMeta: { fontSize: 8, color: '#555555', textAlign: 'right', marginTop: 2 },

  studentRow: { flexDirection: 'row', marginBottom: 10, gap: 12 },
  studentFields: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  field: { width: '50%', marginBottom: 3 },
  fieldLabel: { fontSize: 7, color: '#777777', textTransform: 'uppercase' },
  fieldValue: { fontSize: 10 },

  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginTop: 8,
    marginBottom: 4,
  },

  subject: {
    borderWidth: 0.5,
    borderColor: '#DDDDDD',
    borderRadius: 3,
    marginBottom: 6,
    padding: 6,
  },
  subjectHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  subjectName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  subjectGrade: { fontSize: 14, fontFamily: 'Helvetica-Bold' },

  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDDDDD',
    paddingBottom: 2,
    marginBottom: 2,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 1.5 },
  cellComponent: { width: '40%', fontSize: 8 },
  cellMarks: { width: '15%', fontSize: 8, textAlign: 'right' },
  cellPercent: { width: '15%', fontSize: 8, textAlign: 'right' },
  cellWeight: { width: '15%', fontSize: 8, textAlign: 'right' },
  cellGrade: { width: '15%', fontSize: 8, textAlign: 'right' },
  headCell: { fontSize: 7, color: '#777777', textTransform: 'uppercase' },

  subjectFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: '#EEEEEE',
  },
  footNote: { fontSize: 7, color: '#666666' },

  remark: { fontSize: 8, marginBottom: 3 },
  remarkAuthor: { fontSize: 7, color: '#777777' },

  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  signature: { width: '30%', borderTopWidth: 0.5, borderTopColor: '#999999', paddingTop: 3 },
  signatureLabel: { fontSize: 7, color: '#666666', textAlign: 'center' },

  pageFooter: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#888888',
  },
});

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

export function ResultCardDocument({ cards }: { cards: ResultCardData[] }) {
  return (
    <Document
      title={cards.length === 1 ? `Result card — ${cards[0]!.student.name}` : 'Result cards'}
      author={cards[0]?.school.name ?? 'Volt'}
    >
      {cards.map((card, index) => {
        const brand = card.school.brandColour;
        return (
          // One page per student, exactly as the spec requires for the print shop.
          <Page key={`${card.student.rollNumber}-${index}`} size="A4" style={styles.page} wrap={false}>
            <View style={[styles.header, { borderBottomColor: brand }]}>
              <View>
                <Text style={[styles.schoolName, { color: brand }]}>{card.school.name}</Text>
                {card.school.address ? (
                  <Text style={styles.schoolMeta}>{card.school.address}</Text>
                ) : null}
              </View>
              <View>
                <Text style={styles.seriesName}>{card.aggregate.examSeriesName}</Text>
                <Text style={styles.seriesMeta}>
                  {card.aggregate.startDate} to {card.aggregate.endDate}
                </Text>
                <Text style={styles.seriesMeta}>{card.aggregate.gradingScaleName}</Text>
              </View>
            </View>

            <View style={styles.studentRow}>
              <View style={styles.studentFields}>
                <Field label="Student" value={card.student.name} />
                <Field label="Roll number" value={card.student.rollNumber} />
                <Field label="Admission number" value={card.student.admissionNumber} />
                <Field label="Year group" value={card.student.yearGroup ?? '—'} />
                <Field label="House" value={card.student.house ?? '—'} />
                <Field
                  label="Attendance this term"
                  value={formatPercent(card.aggregate.attendancePercent)}
                />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Subjects</Text>

            {card.aggregate.subjects.map((subject) => (
              <View key={subject.subjectCode} style={styles.subject} wrap={false}>
                <View style={styles.subjectHeader}>
                  <View>
                    <Text style={styles.subjectName}>
                      {subject.subjectName} ({subject.subjectCode})
                    </Text>
                    <Text style={styles.footNote}>
                      {subject.sectionName}
                      {subject.teacherName ? ` · ${subject.teacherName}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.subjectGrade, { color: brand }]}>
                    {subject.grade ?? '—'}
                  </Text>
                </View>

                <View style={styles.tableHead}>
                  <Text style={[styles.cellComponent, styles.headCell]}>Paper</Text>
                  <Text style={[styles.cellMarks, styles.headCell]}>Marks</Text>
                  <Text style={[styles.cellPercent, styles.headCell]}>Percent</Text>
                  <Text style={[styles.cellWeight, styles.headCell]}>Weight</Text>
                  <Text style={[styles.cellGrade, styles.headCell]}>Grade</Text>
                </View>

                {subject.components.map((component) => (
                  <View key={component.code} style={styles.tableRow}>
                    <Text style={styles.cellComponent}>
                      {component.code} {component.name}
                    </Text>
                    <Text style={styles.cellMarks}>
                      {/* An absence prints as "Absent", never as a zero. */}
                      {component.isAbsent || component.marksObtained === null
                        ? 'Absent'
                        : `${component.marksObtained} / ${component.totalMarks}`}
                    </Text>
                    <Text style={styles.cellPercent}>{formatPercent(component.percent)}</Text>
                    <Text style={styles.cellWeight}>{component.weightPercent}%</Text>
                    <Text style={styles.cellGrade}>{component.grade ?? '—'}</Text>
                  </View>
                ))}

                <View style={styles.subjectFooter}>
                  <Text style={styles.footNote}>
                    Subject percentage {formatPercent(subject.percent)} · class average{' '}
                    {formatPercent(subject.classAveragePercent)}
                    {subject.percentileBand ? ` · ${subject.percentileBand} of the year group` : ''}
                  </Text>
                  {subject.missingComponents.length > 0 ? (
                    <Text style={styles.footNote}>
                      Not sat: {subject.missingComponents.join(', ')}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}

            {card.aggregate.remarks.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Remarks</Text>
                {card.aggregate.remarks.slice(0, 4).map((remark, remarkIndex) => (
                  <View key={remarkIndex}>
                    <Text style={styles.remark}>{remark.body}</Text>
                    <Text style={styles.remarkAuthor}>{remark.staffName}</Text>
                  </View>
                ))}
              </>
            ) : null}

            <View style={styles.signatures}>
              {['Class teacher', 'Head of school', 'Parent or guardian'].map((label) => (
                <View key={label} style={styles.signature}>
                  <Text style={styles.signatureLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.pageFooter} fixed>
              <Text>
                {card.student.name} · {card.student.rollNumber}
              </Text>
              <Text>
                Generated {card.aggregate.generatedAt.slice(0, 10)} · percentile shown to the
                student only
              </Text>
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

/**
 * Renders cards to a PDF buffer.
 *
 * One card or two hundred: "bulk generation for a whole year group runs as a background job
 * and produces a single merged PDF for the print shop plus individual PDFs for the portal",
 * and both come from this same call with a different list.
 */
export async function renderResultCards(cards: ResultCardData[]): Promise<Buffer> {
  if (cards.length === 0) {
    throw new Error('No result cards to render');
  }
  return renderToBuffer(<ResultCardDocument cards={cards} />);
}
