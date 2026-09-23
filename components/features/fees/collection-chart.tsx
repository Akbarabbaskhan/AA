import { formatPaisa } from '@/lib/services/fees/money';

/**
 * Collection against expectation, month by month.
 *
 * Form: part-to-whole over time. So a bar per period showing collected against billed,
 * not two lines — the question is "how much of that month came in", and a ratio inside a
 * single bar answers it at a glance where two lines make you measure a gap.
 *
 * Colour carries one meaning: collected or not. The month that is still being collected is
 * drawn in outline rather than fill, because calling it 40% collected next to a closed
 * month at 98% invites a conclusion that is not true yet.
 */
export type PeriodRow = {
  periodLabel: string;
  billed: number;
  collected: number;
  outstanding: number;
  rate: number;
  isDue: boolean;
};

export function CollectionChart({
  periods,
  labels,
}: {
  periods: readonly PeriodRow[];
  labels: { billed: string; collected: string; notYetDue: string };
}) {
  const peak = Math.max(1, ...periods.map((period) => period.billed));

  return (
    <figure className="m-0 flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {periods.map((period) => {
          const billedWidth = (period.billed / peak) * 100;
          const collectedShare = period.billed === 0 ? 0 : (period.collected / period.billed) * 100;

          return (
            <li key={period.periodLabel} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-[var(--text-primary)]">
                  {period.periodLabel}
                  {!period.isDue ? (
                    <span className="ms-2 text-small text-[var(--text-tertiary)]">
                      {labels.notYetDue}
                    </span>
                  ) : null}
                </span>
                <span data-numeric className="tabular-nums text-small text-[var(--text-tertiary)]">
                  {formatPaisa(period.collected)} / {formatPaisa(period.billed)}
                </span>
              </span>

              <span
                className="relative block h-4 rounded-pill bg-[var(--surface)]"
                style={{ width: `${billedWidth.toFixed(1)}%` }}
                role="img"
                aria-label={`${period.periodLabel}: ${period.rate}% collected`}
              >
                <span
                  className={[
                    'absolute inset-y-0 start-0 rounded-pill',
                    period.isDue ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
                  ].join(' ')}
                  style={{ width: `${collectedShare.toFixed(1)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>

      {/* The clipping wrapper keeps the table's intrinsic width from widening the page. */}
      <div className="sr-only">
        <table>
          <caption>Collection by period</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">{labels.billed}</th>
              <th scope="col">{labels.collected}</th>
              <th scope="col">Rate</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.periodLabel}>
                <th scope="row">{period.periodLabel}</th>
                <td>{formatPaisa(period.billed)}</td>
                <td>{formatPaisa(period.collected)}</td>
                <td>{period.rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
