import type { GradeBand } from '@/lib/services/grading/bands';

/**
 * Grade trend, one small multiple per subject.
 *
 * "A line chart of grade over every assessment this year, so a student sees
 * 'C → C → B → B' and feels it."
 *
 * Form: change over time, one series per chart. Small multiples rather than four lines on
 * one plot, which means a single hue and no legend — the title names what is plotted, and
 * there is no categorical palette to get wrong.
 *
 * The grade boundaries are drawn as recessive zones behind the line, labelled on the axis.
 * They are reference context, not data, so they are neutral: a coloured band per grade
 * would be a rainbow ramp on an ordered scale and would out-shout the line.
 *
 * Only the endpoint is direct-labelled. A number on every point is the anti-pattern; the
 * axis carries the rest, and the sr-only table carries the exact values.
 */

export type TrendPoint = {
  examSeriesName: string;
  percent: number | null;
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

export function GradeTrendChart({
  subjectName,
  subjectCode,
  points,
  bands,
}: {
  subjectName: string;
  subjectCode: string;
  points: TrendPoint[];
  bands: readonly GradeBand[];
}) {
  const plotted = points
    .map((point, index) => ({ ...point, index }))
    .filter(
      (point): point is TrendPoint & { index: number; percent: number } => point.percent !== null,
    );

  const path = plotted
    .map((point, position) => {
      const command = position === 0 ? 'M' : 'L';
      return `${command}${xFor(point.index, points.length).toFixed(1)} ${yFor(point.percent).toFixed(1)}`;
    })
    .join(' ');

  const last = plotted.at(-1);
  const titleId = `trend-${subjectCode}`;

  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-h3 text-[var(--text-primary)]">{subjectName}</span>
        {last?.grade ? (
          <span data-numeric className="text-h2 text-[var(--text-primary)]">
            {last.grade}
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
          {subjectName}: {points.map((point) => point.grade ?? '—').join(', ')}
        </title>

        {/* Grade boundary zones, alternating one step off the surface so they read as
            reference rather than as data. */}
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
              {/* Hairline, solid, recessive — never dashed. */}
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

        {/* A wash under the line rather than a saturated block. */}
        {plotted.length > 1 ? (
          <path
            d={`${path} L${xFor(plotted.at(-1)!.index, points.length).toFixed(1)} ${(PLOT.y + PLOT.height).toFixed(1)} L${xFor(plotted[0]!.index, points.length).toFixed(1)} ${(PLOT.y + PLOT.height).toFixed(1)} Z`}
            fill="var(--accent)"
            fillOpacity={0.1}
          />
        ) : null}

        {plotted.length > 1 ? (
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {plotted.map((point) => (
          <g key={point.examSeriesName}>
            {/* 2px surface ring keeps the marker legible where it crosses a boundary. */}
            <circle
              cx={xFor(point.index, points.length)}
              cy={yFor(point.percent)}
              r={5}
              fill="var(--accent)"
              stroke="var(--surface-raised)"
              strokeWidth={2}
            />
            <title>
              {point.examSeriesName}: {point.grade ?? '—'} ({point.percent.toFixed(1)}%)
            </title>
          </g>
        ))}

        {/* The endpoint is the only direct label: it is the headline, and the axis
            carries the rest. */}
        {last ? (
          <text
            x={xFor(last.index, points.length) + 10}
            y={yFor(last.percent)}
            dominantBaseline="middle"
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {last.percent.toFixed(0)}%
          </text>
        ) : null}

        {points.map((point, index) => (
          <text
            key={point.examSeriesName}
            x={xFor(index, points.length)}
            y={HEIGHT - 8}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            fontSize={9}
            fill="var(--text-tertiary)"
          >
            {point.examSeriesName.replace(/\s+\d{4}$/, '')}
          </text>
        ))}
      </svg>

      {/*
        The table view, so nothing is gated behind reading a chart.
        The clipping wrapper matters: a <table> keeps its intrinsic width whatever you set
        on it, so sr-only applied directly to the table widens the whole document and the
        page scrolls sideways on a phone.
      */}
      <div className="sr-only">
        <table>
          <caption>{subjectName} grade trend</caption>
          <thead>
            <tr>
              <th scope="col">Exam series</th>
              <th scope="col">Percentage</th>
              <th scope="col">Grade</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.examSeriesName}>
                <th scope="row">{point.examSeriesName}</th>
                <td>{point.percent === null ? 'Not sat' : `${point.percent.toFixed(1)}%`}</td>
                <td>{point.grade ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
