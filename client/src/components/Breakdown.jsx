import { formatCount } from "../utils/format";

// A ranked list where each row's wash is its share of the top row.
export default function Breakdown({ title, rows, labelKey, emptyLabel = "Nothing yet", format = (v) => v ?? "Unknown", valueKey = "visitors", valueLabel = "Visitors" }) {
  const max = Math.max(1, ...rows.map((row) => row[valueKey]));
  return (
    <section className="card">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted small">{emptyLabel}</p>
      ) : (
        <div className="breakdown">
          <div className="breakdown-head">
            <span>{title}</span>
            <span>{valueLabel}</span>
          </div>
          {rows.map((row, i) => (
            <div className="bar-row" key={`${row[labelKey]}-${i}`}>
              <div className="fill" style={{ width: `${(row[valueKey] / max) * 100}%` }} />
              <span>{format(row[labelKey])}</span>
              <span className="num">{formatCount(row[valueKey])}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
