import type { QuestionAnalysis } from '@/lib/services/quizzes/analysis';

/**
 * Per-question analysis.
 *
 * Form: part-to-whole across a handful of categories, one question at a time. A stacked bar
 * per question in a single chart would compress each question to a sliver; a row of bars
 * per question keeps the comparison that matters — this option against that option — at
 * full width.
 *
 * Colour carries exactly one meaning here: correct or not. Giving each option its own hue
 * would be a categorical palette on data with an inherent order (right, wrong) and would
 * make the distractor that pulled 40% no easier to find than the one that pulled 2%.
 */
export function QuestionAnalysisRow({
  analysis,
  index,
  labels,
}: {
  analysis: QuestionAnalysis;
  index: number;
  labels: { facility: string; distractors: string; reteach: string; pending: string };
}) {
  const answered = Math.max(1, analysis.answered);
  // A facility below this is the line between "some found it hard" and "reteach it".
  const needsReteach = analysis.facility !== null && analysis.facility < 50;

  return (
    <li className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-small text-[var(--text-tertiary)]">
          {index + 1}. {analysis.topicTag ?? ''}
        </span>
        <span className="flex items-baseline gap-2">
          {needsReteach ? (
            <span className="rounded-pill bg-[var(--warning-surface,var(--surface))] px-2 text-small text-[var(--warning)]">
              {labels.reteach}
            </span>
          ) : null}
          <span data-numeric className="text-h3 text-[var(--text-primary)]">
            {analysis.facility === null ? '—' : `${analysis.facility}%`}
          </span>
        </span>
      </div>

      <p className="text-body text-[var(--text-primary)]">{analysis.body}</p>

      {analysis.optionCounts.length > 0 ? (
        <div className="flex flex-col gap-1" aria-label={labels.distractors}>
          {analysis.optionCounts.map((entry) => {
            const share = (entry.count / answered) * 100;
            return (
              <div key={entry.option.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-small text-[var(--text-secondary)]">
                  {entry.option.text}
                </span>
                <span className="relative h-3 flex-1 overflow-hidden rounded-pill bg-[var(--surface-sunken,var(--surface))]">
                  <span
                    className="absolute inset-y-0 start-0 rounded-pill"
                    style={{
                      width: `${share.toFixed(1)}%`,
                      // The key is the only saturated mark; the distractors stay neutral
                      // so the eye lands on the gap between them.
                      backgroundColor: entry.isCorrect ? 'var(--accent)' : 'var(--border-strong)',
                    }}
                  />
                </span>
                <span data-numeric className="w-10 shrink-0 text-end text-small text-[var(--text-tertiary)]">
                  {Math.round(share)}%
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="text-small text-[var(--text-tertiary)]">
        {labels.facility}: {analysis.answered}
        {analysis.pendingManual > 0 ? ` · ${labels.pending}: ${analysis.pendingManual}` : ''}
      </p>

      <div className="sr-only">
        <table>
          <caption>{`Question ${index + 1}: how the class answered`}</caption>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Chose it</th>
              <th scope="col">Correct</th>
            </tr>
          </thead>
          <tbody>
            {analysis.optionCounts.map((entry) => (
              <tr key={entry.option.id}>
                <th scope="row">{entry.option.text}</th>
                <td>{entry.count}</td>
                <td>{entry.isCorrect ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}
