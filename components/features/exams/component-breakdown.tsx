import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils/cn';

/**
 * Which paper is costing the most.
 *
 * "'You are an A on P1 and a D on P4' is actionable in a way a single grade is not."
 *
 * Form: emphasis, not categorical. The weakest paper carries the accent and the rest are
 * de-emphasised, because the story is one paper rather than four identities. Bars are
 * capped thin with a rounded data-end, the value rides the tip, and the text stays in text
 * tokens — the coloured bar beside it carries the identity.
 */
export type BreakdownComponent = {
  componentCode: string;
  componentName: string;
  percent: number;
  lostPoints: number;
};

export async function ComponentBreakdown({
  subjectName,
  weakest,
}: {
  subjectName: string;
  weakest: BreakdownComponent[];
}) {
  const t = await getTranslations('exams');
  if (weakest.length === 0) return null;

  const worst = weakest[0]!;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="text-h3 text-[var(--text-primary)]">{subjectName}</span>
        <span className="text-small text-[var(--text-secondary)]">
          {t('costingMost')}: {worst.componentCode} {worst.componentName}
        </span>
      </figcaption>

      <ul className="flex flex-col gap-2">
        {weakest.map((component) => {
          const isWorst = component.componentCode === worst.componentCode;
          return (
            <li key={component.componentCode} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body text-[var(--text-primary)]">
                  {component.componentCode} {component.componentName}
                </span>
                {/* Value at the tip, in a text token — never in the data colour. */}
                <span data-numeric className="shrink-0 text-body text-[var(--text-secondary)]">
                  {component.percent.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-pill bg-[var(--surface)]">
                <div
                  className={cn(
                    'h-full rounded-e-pill',
                    isWorst ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
                  )}
                  style={{ width: `${Math.max(2, Math.min(100, component.percent))}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {/* Clipping wrapper: a table ignores width:1px and would widen the document. */}
      <div className="sr-only">
        <table>
          <caption>{subjectName} paper breakdown</caption>
          <thead>
            <tr>
              <th scope="col">Paper</th>
              <th scope="col">Percentage</th>
              <th scope="col">Grade points lost</th>
            </tr>
          </thead>
          <tbody>
            {weakest.map((component) => (
              <tr key={component.componentCode}>
                <th scope="row">
                  {component.componentCode} {component.componentName}
                </th>
                <td>{component.percent.toFixed(1)}%</td>
                <td>{component.lostPoints.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
