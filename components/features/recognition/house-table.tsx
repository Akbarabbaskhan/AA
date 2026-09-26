import type { HouseStanding } from '@/lib/services/recognition';

/**
 * Inter-house standings.
 *
 * Form: ranking, so bars ordered largest first. A single hue at one length per house —
 * giving each house its own colour would be a categorical palette on data that is already
 * ordered, and the school's house colours are not a thing this component can know anyway.
 *
 * The leader is not emphasised beyond being longest. A house competition where the app
 * crowns a winner mid-term is one the losing houses stop looking at.
 */
export function HouseTable({ standings }: { standings: readonly HouseStanding[] }) {
  const peak = Math.max(1, ...standings.map((standing) => standing.points));

  return (
    <figure className="m-0 flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {standings.map((standing) => (
          <li key={standing.house} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-body text-[var(--text-primary)]">
              {standing.house}
            </span>

            <span
              className="relative h-4 flex-1 overflow-hidden rounded-pill bg-[var(--surface)]"
              role="img"
              aria-label={`${standing.house}: ${standing.points} points`}
            >
              <span
                className="absolute inset-y-0 start-0 rounded-pill bg-[var(--accent)]"
                style={{ width: `${((standing.points / peak) * 100).toFixed(1)}%` }}
              />
            </span>

            <span data-numeric className="w-16 shrink-0 text-end tabular-nums text-body">
              {standing.points}
            </span>
          </li>
        ))}
      </ul>

      <div className="sr-only">
        <table>
          <caption>House standings</caption>
          <thead>
            <tr>
              <th scope="col">House</th>
              <th scope="col">Points</th>
              <th scope="col">Awards</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing) => (
              <tr key={standing.house}>
                <th scope="row">{standing.house}</th>
                <td>{standing.points}</td>
                <td>{standing.contributors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
