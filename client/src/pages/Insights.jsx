import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useOutletContext } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { markAlertRead } from "../store/alertsSlice";
import TimeChart from "../components/TimeChart";
import Upsell from "../components/Upsell";
import Icon from "../components/Icon";
import { formatDateTime, formatTime, formatCount, timeAgo } from "../utils/format";
import { segmentName } from "../utils/segments";

const DAY_MS = 24 * 60 * 60 * 1000;
const ICONS = { leaky_page: "door", strong_source: "trendUp", weak_device: "phone", peak_hours: "clock", next_week: "overview" };

function Opportunities({ insight }) {
  if (!insight) {
    return (
      <p className="muted small">
        Opportunities are worked out once a day from the last four weeks of traffic. They show up after the first daily run, once the site has a few weeks of
        visits.
      </p>
    );
  }
  if (insight.items.length === 0) {
    return <p className="muted small">Nothing stands out yet. Every page, source and device performs close to the site average.</p>;
  }
  return (
    <div>
      {insight.items.map((item, i) => (
        <article className="insight" key={`${item.type}-${i}`}>
          <span className="insight-icon"><Icon name={ICONS[item.type] ?? "spark"} /></span>
          <div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </div>
          {item.impact > 0 ? <span className="impact">+{formatCount(Math.round(item.impact))} engaged / week</span> : <span />}
        </article>
      ))}
    </div>
  );
}

function Why({ alert }) {
  if (alert.broad) {
    return (
      <p className="small ink-2" style={{ marginTop: 4 }}>
        {alert.kind === "spike" ? "Traffic rose across every source and device at once." : "Every source and device dropped together, which usually means the site itself had a problem (an outage or a broken deploy)."}
      </p>
    );
  }
  if (!alert.drivers.length) return null;
  return (
    <div className="drivers" aria-label="What changed">
      {alert.drivers.map((d) => (
        <div className="driver" key={`${d.dimension}-${d.value}`}>
          <span className="share" aria-hidden="true"><div style={{ width: `${Math.min(1, Math.max(0, d.share)) * 100}%` }} /></span>
          <span>
            <strong>{Math.round(Math.min(1, d.share) * 100)}%</strong> {alert.kind === "spike" ? "came from" : "was missing from"} <span className="ink-2">{segmentName(d.dimension, d.value)}</span>
            <span className="muted"> · {d.actual} vs about {Math.round(d.expected)} usually</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Insights() {
  const { site } = useOutletContext();
  const dispatch = useDispatch();
  const [showAll, setShowAll] = useState(false);
  const base = `/api/sites/${site._id}`;
  const locked = site.plan === "free";
  const query = useMemo(() => {
    const to = new Date(Math.ceil(Date.now() / 60000) * 60000);
    return `from=${new Date(to - 7 * DAY_MS).toISOString()}&to=${to.toISOString()}`;
  }, []);

  const stats = useApi(locked ? null : `${base}/stats?${query}&unit=hour`);
  const forecast = useApi(locked ? null : `${base}/forecast?${query}`);
  const insights = useApi(locked ? null : `${base}/insights`);
  const alerts = useApi(locked ? null : `/api/alerts?site=${site._id}`);

  if (locked) return <Upsell canUpgrade={site.role === "owner"} />;

  const points = forecast.data?.points ?? [];
  const band = points.map((p) => ({ t: p.hour, lo: p.lo, hi: p.hi, expected: p.expected }));
  const list = alerts.data?.alerts ?? [];
  const anomalies = list.map((a) => ({ t: a.hour, actual: a.actual, kind: a.kind }));
  const opportunities = insights.data?.opportunities;

  const open = (alert) => {
    if (!alert.read) dispatch(markAlertRead(alert._id)).then(alerts.reload);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="card-head">
          <h2>Opportunities</h2>
          {opportunities && <p>Updated {timeAgo(opportunities.computedAt)} · last 4 weeks</p>}
        </div>
        {insights.error ? <p className="form-error">{insights.error.message}</p> : insights.data ? <Opportunities insight={opportunities} /> : <div className="skeleton" style={{ height: 120 }} />}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Page views per hour, last 7 days</h2>
          <div className="legend">
            <span className="key"><span className="key-line" />Page views</span>
            {band.length > 0 && <span className="key"><span className="key-band" />Normal range</span>}
            {anomalies.length > 0 && <span className="key"><span className="key-dot" />Alert</span>}
          </div>
        </div>
        {stats.error && <p className="form-error">{stats.error.message}</p>}
        {stats.data ? (
          <TimeChart
            points={stats.data.series.map((p) => ({ t: p.t, value: p.pageviews }))}
            band={band}
            anomalies={anomalies}
            unit="hour"
            timezone={site.timezone}
            label="Page views"
            height={260}
            tickFormat={(t) => formatTime(t, "day", site.timezone)}
          />
        ) : (
          <div className="skeleton" style={{ height: 260 }} />
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
          <div className="card-head"><h2>Alerts</h2></div>
          {list.length === 0 && (
            <p className="muted small">No unusual hours so far. When traffic lands far outside the normal range, it shows up here with what caused it, and everyone on the site gets notified.</p>
          )}
          <div className="stack" style={{ gap: 2 }}>
            {(showAll ? list : list.slice(0, 6)).map((alert) => (
              <div
                key={alert._id}
                className={`alert-item${alert.read ? "" : " unread"}`}
                role={alert.read ? undefined : "button"}
                tabIndex={alert.read ? undefined : 0}
                onClick={() => open(alert)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(alert)}
                style={{ cursor: alert.read ? "default" : "pointer" }}
              >
                <span className={`alert-icon ${alert.kind}`} aria-hidden="true">{alert.kind === "spike" ? "↑" : "↓"}</span>
                <div>
                  <strong className="small">{alert.kind === "spike" ? "Spike" : "Drop"}: {alert.actual} page views</strong>
                  <p className="small muted">Normal for that hour is {Math.round(alert.lo)} to {Math.round(alert.hi)}</p>
                  <Why alert={alert} />
                </div>
                <span className="muted small">{formatDateTime(alert.hour, site.timezone)}</span>
              </div>
            ))}
          </div>
          {list.length > 6 && (
            <button type="button" className="btn ghost small" style={{ width: "fit-content" }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show ${list.length - 6} more`}
            </button>
          )}
        </section>
        <section className="card" style={{ alignSelf: "start" }}>
          <div className="card-head"><h2>How this works</h2></div>
          <div className="stack small ink-2">
            <p>Every hour, a Python job reads this site's page views, learns its weekly rhythm and predicts a normal range for each of the next 24 hours. The band above is what it predicted before each hour happened.</p>
            <p>Small sites get a handful of visits an hour, so the model treats visits as counts rather than a bell curve and ignores small jumps. When an hour lands far outside the range, it compares every source, page, device and country with the same hour in past weeks to say what moved.</p>
            <p>Once a day it looks at the last four weeks for things worth fixing, and only lists a finding when the numbers are big enough to trust.</p>
            {points[0]?.model && <p className="muted">Model: <span className="mono">{points[0].model}</span></p>}
          </div>
        </section>
      </div>
    </div>
  );
}
