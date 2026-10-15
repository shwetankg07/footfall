import { formatCount, percentChange } from "../utils/format";

const TILES = [
  { key: "visitors", label: "Unique visitors", format: formatCount, upIsGood: true, chartable: true },
  { key: "pageviews", label: "Page views", format: formatCount, upIsGood: true, chartable: true },
  { key: "viewsPerVisitor", label: "Views per visitor", format: (n) => n.toFixed(1), upIsGood: true },
  { key: "bounceRate", label: "Bounce rate", format: (n) => `${n}%`, upIsGood: false },
];

function Delta({ change, upIsGood }) {
  if (change === null) return <span className="delta flat">No earlier data</span>;
  if (change === 0) return <span className="delta flat">No change</span>;
  const good = change > 0 === upIsGood;
  return (
    <span className={`delta ${good ? "good" : "bad"}`}>
      <span aria-hidden="true">{change > 0 ? "▲" : "▼"}</span>
      {Math.abs(change)}% vs previous period
    </span>
  );
}

// Clicking a count tile picks what the main chart plots.
export default function StatTiles({ summary, previous, metric, onMetric }) {
  return (
    <div className="tiles">
      {TILES.map((tile) => {
        const selectable = tile.chartable && onMetric;
        return (
          <button
            key={tile.key}
            type="button"
            className={`tile${selectable ? " selectable" : ""}`}
            aria-pressed={selectable ? metric === tile.key : undefined}
            onClick={selectable ? () => onMetric(tile.key) : undefined}
            tabIndex={selectable ? 0 : -1}
          >
            <span className="tile-label">{tile.label}</span>
            <span className="tile-value">{tile.format(summary[tile.key])}</span>
            <Delta change={percentChange(summary[tile.key], previous[tile.key])} upIsGood={tile.upIsGood} />
          </button>
        );
      })}
    </div>
  );
}
