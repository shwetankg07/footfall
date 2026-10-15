import { useEffect, useMemo, useRef, useState } from "react";
import { formatCount, formatTick, formatTime, formatDateTime } from "../utils/format";

const M = { top: 14, right: 14, bottom: 28, left: 44 };

// Clean ticks for counts: steps of 1, 2 or 5 x 10^k, never fractional.
const niceScale = (max) => {
  const raw = Math.max(max, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
};

const pathThrough = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

const useWidth = () => {
  const ref = useRef(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

/**
 * points:    [{ t, value }]           the measured series, one per bucket
 * band:      [{ t, lo, hi, expected }] optional predicted normal range (may run past the last point)
 * anomalies: [{ t, actual, kind }]     optional, drawn as red dots
 */
export default function TimeChart({ points, band = [], anomalies = [], unit, timezone, label, height = 240, refetching = false, tickFormat }) {
  const [wrapRef, width] = useWidth();
  const [active, setActive] = useState(null);

  const timeline = useMemo(() => {
    const byTime = new Map();
    for (const p of points) byTime.set(new Date(p.t).getTime(), { t: new Date(p.t), value: p.value });
    for (const b of band) {
      const key = new Date(b.t).getTime();
      byTime.set(key, { ...(byTime.get(key) ?? { t: new Date(b.t) }), band: b });
    }
    for (const a of anomalies) {
      const key = new Date(a.t).getTime();
      if (byTime.has(key)) byTime.get(key).anomaly = a;
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }, [points, band, anomalies]);

  // Same root element in both branches, so the size observer stays attached when data arrives.
  if (timeline.length === 0) {
    return (
      <div className="chart" ref={wrapRef}>
        <div className="empty small">No data in this range yet.</div>
      </div>
    );
  }

  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const t0 = timeline[0].t.getTime();
  const t1 = timeline[timeline.length - 1].t.getTime();
  const x = (t) => M.left + (t1 === t0 ? innerW / 2 : ((new Date(t).getTime() - t0) / (t1 - t0)) * innerW);

  const maxValue = Math.max(...timeline.map((d) => Math.max(d.value ?? 0, d.band?.hi ?? 0)));
  const { top, ticks } = niceScale(maxValue);
  const y = (v) => M.top + innerH - (v / top) * innerH;

  const measured = timeline.filter((d) => d.value !== undefined);
  const linePts = measured.map((d) => [x(d.t), y(d.value)]);
  const banded = timeline.filter((d) => d.band);
  const bandPath = banded.length
    ? `${pathThrough(banded.map((d) => [x(d.t), y(d.band.hi)]))} ${pathThrough(banded.slice().reverse().map((d) => [x(d.t), y(d.band.lo)])).replace("M", "L")} Z`
    : null;
  const lastMeasured = measured[measured.length - 1];
  const runsIntoFuture = lastMeasured && banded.some((d) => d.t > lastMeasured.t);

  const tickCount = timeline.length <= (width < 500 ? 4 : 8) ? timeline.length : width < 500 ? 4 : 7;
  const xTicks = Array.from({ length: tickCount }, (_, i) => timeline[Math.round((i * (timeline.length - 1)) / Math.max(1, tickCount - 1))]);
  const fmtTick = tickFormat ?? ((t) => formatTime(t, unit, timezone));

  const pick = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    timeline.forEach((d, i) => {
      if (Math.abs(x(d.t) - px) < Math.abs(x(timeline[best].t) - px)) best = i;
    });
    setActive(best);
  };

  const onKey = (event) => {
    if (event.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? timeline.length) - 1));
    else if (event.key === "ArrowRight") setActive((i) => Math.min(timeline.length - 1, (i ?? -1) + 1));
    else return;
    event.preventDefault();
  };

  const current = active === null ? null : timeline[active];
  const tipLeft = current ? Math.min(Math.max(x(current.t), 80), width - 80) : 0;

  return (
    <div className={`chart${refetching ? " refetching" : ""}`} ref={wrapRef}>
      <svg
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} over time. Use the arrow keys to read values.`}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(timeline.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? "axis" : "grid"} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end">{formatTick(v)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={d.t.getTime()} x={x(d.t)} y={height - 8} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>
            {fmtTick(d.t)}
          </text>
        ))}

        {bandPath && <path className="band" d={bandPath} />}
        {linePts.length > 1 && (
          <>
            <path className="area" d={`${pathThrough(linePts)} L${linePts.at(-1)[0]},${y(0)} L${linePts[0][0]},${y(0)} Z`} />
            <path className="line" d={pathThrough(linePts)} />
          </>
        )}
        {runsIntoFuture && (
          <g>
            <line className="now" x1={x(lastMeasured.t)} x2={x(lastMeasured.t)} y1={M.top} y2={y(0)} />
            <text x={x(lastMeasured.t) + 4} y={M.top + 10}>now</text>
          </g>
        )}
        {linePts.length > 0 && <circle className="dot" cx={linePts.at(-1)[0]} cy={linePts.at(-1)[1]} r={4} />}
        {timeline.filter((d) => d.anomaly).map((d) => (
          <circle key={d.t.getTime()} className="anomaly" cx={x(d.t)} cy={y(d.anomaly.actual)} r={5} />
        ))}

        {current && (
          <g>
            <line className="crosshair" x1={x(current.t)} x2={x(current.t)} y1={M.top} y2={y(0)} />
            {current.value !== undefined && <circle className="dot" cx={x(current.t)} cy={y(current.value)} r={4.5} />}
          </g>
        )}
      </svg>

      {current && (
        <div className="tooltip" style={{ left: tipLeft, top: 0, transform: "translateX(-50%)" }}>
          {current.value !== undefined && <strong>{formatCount(current.value)}</strong>}
          <span className="ink-2">{current.value !== undefined ? label : "Forecast"}</span>
          {current.band && (
            <span className="muted">
              Normal {Math.round(current.band.lo)} to {Math.round(current.band.hi)}
            </span>
          )}
          {current.anomaly && <span style={{ color: "var(--critical-ink)" }}>! Unusual {current.anomaly.kind}</span>}
          <span className="muted">{formatDateTime(current.t, timezone, unit)}</span>
        </div>
      )}

      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th className="num">{label}</th>
                {banded.length > 0 && <th className="num">Normal range</th>}
              </tr>
            </thead>
            <tbody>
              {timeline.map((d) => (
                <tr key={d.t.getTime()}>
                  <td>{formatDateTime(d.t, timezone, unit)}</td>
                  <td className="num">{d.value === undefined ? "–" : formatCount(d.value)}</td>
                  {banded.length > 0 && <td className="num">{d.band ? `${Math.round(d.band.lo)}–${Math.round(d.band.hi)}` : "–"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
