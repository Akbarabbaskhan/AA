import type { GradeBand } from '@/lib/services/grading/bands';

/**
 * Practice trend for one subject-component.
 *
 * "You have moved from a C to a B on P2 across six attempts" is the sentence this chart
 * has to make obvious, so the grade this run ended on is the headline and the grade it
 * started on is the only other label. Everything between is the line's job.
 *
 * Same form as the exam trend chart — change over time, one series, small multiples — and
 * deliberately the same visual language: a student reading both should not have to learn
 * two charts. The boundaries stay neutral because they are reference, not data, and
 * practice attempts are unevenly spaced in time, so the x axis is attempt order with the
 * dates carried in the tooltip and the table.
 */

export type PracticePoint = {
  attemptId: string;
  label: string;
  submittedAt: string;
  percent: number;
  grade: string | null;
};

const WIDTH = 480;
const HEIGHT = 200;
const PADDING = { top: 10, right: 44, bottom: 26, left: 30 };

const PLOT = {
  x: PADDING.left,
  y: PADDING.top,
  width: WIDTH - PADDING.left - PADDING.right,
  height: HEIGHT - PADDING.top - PADDING.bottom,
};

function yFor(percent: number): number {
  return PLOT.y + PLOT.height - (Math.max(0, Math.min(100, percent)) / 100) * PLOT.height;
}

function xFor(index: number, count: number): number {
  if (count <= 1) return PLOT.x + PLOT.width / 2;
  return PLOT.x + (index / (count - 1)) * PLOT.width;
}

export function PracticeTrendChart({
  subjectName,
  componentCode,
  points,
  bands,
}: {
  subjectName: string;
  componentCode: string | null;
  points: readonly PracticePoint[];
  bands: readonly GradeBand[];
}) {
  const title = componentCode ? `${subjectName} ${componentCode}` : subjectName;
  const titleId = `practice-trend-${subjectName.replace(/\s+/g, '-').toLowerCase()}-${componentCode ?? 'all'}`;
  const first = points[0];
  const last = points.at(-1);

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(index, points.length).toFixed(1)} ${yFor(point.percent).toFixed(1)}`)
    .join(' ');

  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-h3 text-[var(--text-primary)]">{title}</span>
        {last?.grade ? (
          <span data-numeric className="text-h2 text-[var(--text-primary)]">
            {first?.grade && first.grade !== last.grade ? `${first.grade} → ${last.grade}` : last.grade}
          </span>
        ) : null}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-labelledby={titleId}
        className="h-auto w-full"
      >
        <title id={titleId}>
          {title}: {points.map((point) => point.grade ?? '—').join(', ')} across {points.length} attempts
        </title>

        {bands.map((band, index) => {
          const upper = index === 0 ? 100 : bands[index - 1]!.minPercent;
          const top = yFor(upper);
          const bottom = yFor(band.minPercent);
          const height = Math.max(0, bottom - top);
          if (height < 1) return null;

          return (
            <g key={band.grade}>
              <rect
                x={PLOT.x}
                y={top}
                width={PLOT.width}
                height={height}
                fill={index % 2 === 0 ? 'var(--surface)' : 'transparent'}
              />
              <line
                x1={PLOT.x}
                x2={PLOT.x + PLOT.width}
                y1={bottom}
                y2={bottom}
                stroke="var(--border-subtle)"
                strokeWidth={1}
              />
              {height >= 14 ? (
                <text
                  x={PLOT.x - 6}
                  y={top + height / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="var(--text-tertiary)"
                >
                  {band.grade}
                </text>
              ) : null}
            </g>
          );
        })}

        {points.length > 1 ? (
          <>
            <path
              d={`${path} L${xFor(points.length - 1, points.length).toFixed(1)} ${(PLOT.y + PLOT.height).toFixed(1)} L${xFor(0, points.length).toFixed(1)} ${(PLOT.y + PLOT.height).toFixed(1)} Z`}
              fill="var(--accent)"
              fillOpacity={0.1}
            />
            <path
              d={path}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : null}

        {points.map((point, index) => (
          <g key={point.attemptId}>
            <circle
              cx={xFor(index, points.length)}
              cy={yFor(point.percent)}
              r={4}
              fill="var(--accent)"
              stroke="var(--surface-raised)"
              strokeWidth={2}
            />
            <title>
              {point.label}: {point.grade ?? '—'} ({point.percent.toFixed(0)}%)
            </title>
          </g>
        ))}

        {last ? (
          <text
            x={xFor(points.length - 1, points.length) + 10}
            y={yFor(last.percent)}
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {last.percent.toFixed(0)}%
          </text>
        ) : null}

        {/* Only the ends are labelled on the axis: with twenty attempts, every label is none. */}
        {first ? (
          <text x={PLOT.x} y={HEIGHT - 8} textAnchor="start" fontSize={9} fill="var(--text-tertiary)">
            {first.label}
          </text>
        ) : null}
        {last && points.length > 1 ? (
          <text
            x={PLOT.x + PLOT.width}
            y={HEIGHT - 8}
            textAnchor="end"
            fontSize={9}
            fill="var(--text-tertiary)"
          >
            {last.label}
          </text>
        ) : null}
      </svg>

      {/* The clipping wrapper keeps the table's intrinsic width from widening the page. */}
      <div className="sr-only">
        <table>
          <caption>{title} practice trend</caption>
          <thead>
            <tr>
              <th scope="col">Paper</th>
              <th scope="col">Percentage</th>
              <th scope="col">Grade</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.attemptId}>
                <th scope="row">{point.label}</th>
                <td>{point.percent.toFixed(0)}%</td>
                <td>{point.grade ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
