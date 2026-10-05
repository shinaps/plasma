import type { GraphRow } from '../../../shared/git-graph.ts';

const palette = ['main', 'branch', 'merge', 'other'];
const colour = (lane: number): string => `var(--color-git-graph-${palette[lane % palette.length]})`;
const laneX = (lane: number): number => 10 + lane * 20;

export function CommitGraph({
  row,
  lanes,
  merge,
}: {
  row: GraphRow;
  lanes: number;
  merge: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      width={lanes * 20}
      viewBox={`0 0 ${lanes * 20} 32`}
      className="h-git-log-row shrink-0 overflow-visible"
    >
      {row.edges.map((edge) => {
        const start = edge.half === 'top' ? 0 : 16;
        const end = start + 16;
        const middle = (start + end) / 2;
        const from = laneX(edge.from);
        const to = laneX(edge.to);
        return (
          <path
            key={`${edge.half}:${edge.from}:${edge.to}`}
            d={
              from === to
                ? `M ${from} ${start} V ${end}`
                : `M ${from} ${start} C ${from} ${middle}, ${to} ${middle}, ${to} ${end}`
            }
            fill="none"
            stroke={colour(edge.colorLane)}
            strokeWidth={2}
          />
        );
      })}
      <circle
        cx={laneX(row.lane)}
        cy={16}
        r={merge ? 4 : 3}
        fill={merge ? 'var(--color-background)' : colour(row.lane)}
        stroke={colour(row.lane)}
        strokeWidth={merge ? 2 : 0}
      />
    </svg>
  );
}
