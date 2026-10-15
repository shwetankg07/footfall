import { useMemo } from "react";
import { useDispatch } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { markAlertRead } from "../store/alertsSlice";
import TimeChart from "../components/TimeChart";
import { formatDateTime, formatTime } from "../utils/format";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function Insights() {
  const { site } = useOutletContext();
  const dispatch = useDispatch();
  const base = `/api/sites/${site._id}`;
  const query = useMemo(() => {
    const to = new Date(Math.ceil(Date.now() / 60000) * 60000);
    return `from=${new Date(to - 7 * DAY_MS).toISOString()}&to=${to.toISOString()}`;
  }, []);

  const stats = useApi(`${base}/stats?${query}&unit=hour`);
  const forecast = useApi(`${base}/forecast?${query}`);
  const alerts = useApi(`/api/alerts?site=${site._id}`);

  const points = forecast.data?.points ?? [];
  const band = points.map((p) => ({ t: p.hour, lo: p.lo, hi: p.hi, expected: p.expected }));
  const anomalies = (alerts.data?.alerts ?? []).map((a) => ({ t: a.hour, actual: a.actual, kind: a.kind }));
  const list = alerts.data?.alerts ?? [];

  const open = (alert) => {
    if (!alert.read) dispatch(markAlertRead(alert._id)).then(alerts.reload);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card">
        <div className="card-head">
          <h2>Page views per hour, last 7 days</h2>
          <div className="legend">
            <span className="key"><span className="key-line" />Page views</span>
            <span className="key"><span className="key-band" />Normal range (forecast)</span>
            <span className="key"><span className="key-dot" />Alert</span>
          </div>
        </div>
        {stats.error && <p className="form-error">{stats.error.message}</p>}
        {stats.data && (
          <TimeChart
            points={stats.data.series.map((p) => ({ t: p.t, value: p.pageviews }))}
            band={band}
            anomalies={anomalies}
            unit="hour"
            timezone={site.timezone}
            label="Page views"
            height={280}
            tickFormat={(t) => formatTime(t, "day", site.timezone)}
          />
        )}
        {forecast.data && points.length === 0 && (
          <p className="notice small">
            No forecast yet. The model needs about a week of traffic before it can say what normal looks like for {site.domain}. It runs every hour, so the band
            appears here on its own.
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Alerts</h2>
          {list.length === 0 && <p className="muted small">No unusual hours so far. When traffic jumps far above or falls far below the band, it shows up here and everyone on the site gets notified.</p>}
          <div className="stack" style={{ gap: 4 }}>
            {list.map((alert) => (
              <button
                type="button"
                key={alert._id}
                className={`alert-item${alert.read ? "" : " unread"}`}
                style={{ border: 0, font: "inherit", color: "inherit", textAlign: "left", cursor: alert.read ? "default" : "pointer", background: undefined }}
                onClick={() => open(alert)}
              >
                <span className={`alert-icon ${alert.kind}`} aria-hidden="true">{alert.kind === "spike" ? "↑" : "↓"}</span>
                <span className="stack" style={{ gap: 2 }}>
                  <strong className="small">{alert.kind === "spike" ? "Traffic spike" : "Traffic drop"}: {alert.actual} page views</strong>
                  <span className="small ink-2">Normal for that hour is {Math.round(alert.lo)} to {Math.round(alert.hi)}.</span>
                </span>
                <span className="muted small">{formatDateTime(alert.hour, site.timezone)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>How the forecast works</h2>
          <div className="stack small ink-2">
            <p>Every hour, a Python job reads this site's page views, learns its weekly rhythm (quiet nights, busy evenings, slower weekends) and predicts a normal range for each of the next 24 hours.</p>
            <p>Small sites get a handful of visits an hour, and at those numbers random wobble looks big. So the model treats visits as counts, not as a bell curve, and ignores tiny jumps. An alert fires only when an hour lands far outside the range.</p>
            <p>The band is what the model predicted before each hour happened, so you can see how well it did.</p>
            {points[0]?.model && <p className="muted">Model in use: <span className="mono">{points[0].model}</span></p>}
          </div>
        </section>
      </div>
    </div>
  );
}
