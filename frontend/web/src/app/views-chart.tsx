// Views over time as a line with dots; dots are colored by where the
// count came from (creator's screenshot, the team, or the platform).
export interface ChartPoint {
  at: number;
  views: number;
  kind?: "CREATOR" | "STAFF" | "API";
}

const W = 560;
const H = 200;
const PAD = { left: 48, right: 12, top: 12, bottom: 26 };

function niceMax(v: number) {
  if (v <= 10) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

const SHORT = new Intl.NumberFormat("fr-FR", { notation: "compact" });

export function ViewsChart({
  points,
  label,
  formatX,
}: {
  points: ChartPoint[];
  label: string;
  formatX: (at: number) => string;
}) {
  if (points.length === 0) return <p className="hint">Aucun relevé pour l’instant.</p>;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const x0 = sorted[0].at;
  const x1 = Math.max(sorted.at(-1)!.at, x0 + 1);
  const max = niceMax(Math.max(...sorted.map((p) => p.views)));
  const x = (t: number) =>
    PAD.left + ((t - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);
  const line = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.at)} ${y(p.views)}`).join(" ");
  const ticks = [0, max / 2, max];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
            {SHORT.format(t)}
          </text>
        </g>
      ))}
      {sorted.length > 1 && (
        <path
          className="area"
          d={`${line} L${x(sorted.at(-1)!.at)} ${y(0)} L${x(x0)} ${y(0)} Z`}
        />
      )}
      <path className="line" d={line} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          cx={x(p.at)}
          cy={y(p.views)}
          r={4}
          className={p.kind === "API" ? "api" : p.kind === "STAFF" ? "staff" : undefined}
          fill={p.kind ? undefined : "var(--accent)"}
          style={p.kind === "CREATOR" ? { fill: "var(--accent)" } : undefined}
        >
          <title>
            {p.views.toLocaleString("fr-FR")} vues · {formatX(p.at)}
          </title>
        </circle>
      ))}
      <text x={PAD.left} y={H - 6}>
        {formatX(x0)}
      </text>
      <text x={W - PAD.right} y={H - 6} textAnchor="end">
        {formatX(x1)}
      </text>
    </svg>
  );
}
