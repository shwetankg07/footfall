import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { RANGES, rangeQuery } from "../utils/range";
import StatTiles from "./StatTiles";
import TimeChart from "./TimeChart";
import Breakdown from "./Breakdown";
import Icon from "./Icon";

const countryName = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return (code) => {
    if (!code) return "Unknown";
    try {
      return names.of(code);
    } catch {
      return code;
    }
  };
})();

const METRIC_LABEL = { visitors: "Unique visitors", pageviews: "Page views" };

// The traffic dashboard body, shared by the signed-in overview and public share links.
// apiBase is "/api/sites/:id" or "/api/share/:token".
export default function TrafficView({ apiBase, timezone, forecastPath, before, limitedHistory = false }) {
  const [params, setParams] = useSearchParams();
  const asked = params.get("range") ?? "7d";
  const rangeKey = limitedHistory && asked === "90d" ? "30d" : asked;
  const [metric, setMetric] = useState("visitors");
  const query = useMemo(() => rangeQuery(rangeKey), [rangeKey]);
  const stats = useApi(`${apiBase}/stats?${query}`);
  const hourly = rangeKey === "24h";
  const forecast = useApi(forecastPath && hourly && metric === "pageviews" ? `${forecastPath}?${query}` : null);

  const data = stats.data;
  const band = forecast.data?.points?.map((p) => ({ t: p.hour, lo: p.lo, hi: p.hi, expected: p.expected })) ?? [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" role="group" aria-label="Date range">
        <div className="segmented">
          {RANGES.map((range) => {
            // Free sites see 30 days; longer ranges stay visible so people know they exist.
            const locked = limitedHistory && range.hours > 30 * 24;
            return (
              <button
                key={range.key}
                type="button"
                aria-pressed={range.key === rangeKey}
                disabled={locked}
                title={locked ? "Full history comes with Footfall Pro" : undefined}
                onClick={() => setParams({ range: range.key }, { replace: true })}
              >
                {locked && <Icon name="lock" size={11} />}
                {range.label}
              </button>
            );
          })}
        </div>
        {stats.loading && data && <span className="muted small">Updating…</span>}
      </div>

      {before}

      {stats.error && <p className="form-error" role="alert">{stats.error.message}</p>}
      {!data && stats.loading && <p className="muted">Loading traffic…</p>}

      {data && (
        <>
          <StatTiles summary={data.summary} previous={data.previous} metric={metric} onMetric={setMetric} />
          <section className="card">
            <div className="card-head">
              <h2>{METRIC_LABEL[metric]}</h2>
              {band.length > 0 ? (
                <div className="legend">
                  <span className="key"><span className="key-line" />Page views</span>
                  <span className="key"><span className="key-band" />Normal range (forecast)</span>
                </div>
              ) : (
                <span className="muted small">{hourly ? "Per hour" : "Per day"}, {timezone} time</span>
              )}
            </div>
            <TimeChart
              points={data.series.map((p) => ({ t: p.t, value: p[metric] }))}
              band={band}
              unit={data.range.unit}
              timezone={timezone}
              label={METRIC_LABEL[metric]}
              refetching={stats.loading}
            />
            {hourly && metric === "visitors" && forecastPath && (
              <p className="muted small">Pick Page views above to see the forecast band from the ML model.</p>
            )}
          </section>
          <div className="grid-2">
            <Breakdown title="Top pages" itemLabel="Page" rows={data.pages} labelKey="path" />
            <Breakdown title="Sources" itemLabel="Source" rows={data.referrers} labelKey="referrer" format={(v) => v ?? "Direct or unknown"} />
            <Breakdown title="Devices" itemLabel="Device" rows={data.devices} labelKey="device" format={(v) => v[0].toUpperCase() + v.slice(1)} />
            <Breakdown title="Browsers" itemLabel="Browser" rows={data.browsers} labelKey="browser" />
            <Breakdown title="Countries" itemLabel="Country" rows={data.countries} labelKey="country" format={countryName} emptyLabel="No country data yet" />
            <Breakdown
              title="Custom events" itemLabel="Event"
              rows={data.events}
              labelKey="name"
              valueKey="count"
              valueLabel="Times"
              emptyLabel='None yet. Send one with window.footfall("signup").'
            />
          </div>
        </>
      )}
    </div>
  );
}
