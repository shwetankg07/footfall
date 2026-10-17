import { useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { addToast } from "../store/toastSlice";
import { formatCount, timeAgo } from "../utils/format";
import { RANGES, rangeQuery } from "../utils/range";

const clampPercent = (value) => Math.min(100, Math.max(0, Number(value) || 0));
const percent = (value) => `${Number(clampPercent(value).toFixed(1))}%`;
const stepLabel = (step) => step.kind === "page" ? `Visited ${step.value}` : `Event: ${step.value}`;
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const count = new Intl.NumberFormat("en-IN");
const conversionRate = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
const multiplier = new Intl.NumberFormat("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function driverSubject({ dimension, value }) {
  switch (dimension) {
    case "referrer": return value ? `Visitors from ${value}` : "Visitors on direct visits";
    case "path": return value ? `Visitors who land on ${value}` : "Visitors with an unknown landing page";
    case "country": {
      const code = String(value ?? "").toUpperCase();
      return value ? `Visitors from ${/^[A-Z]{2}$/.test(code) ? countryNames.of(code) : value}` : "Visitors with an unknown country";
    }
    case "browser": return value ? `Visitors using ${value}` : "Visitors with an unknown browser";
    case "device": {
      const devices = { mobile: "Mobile visitors", desktop: "Desktop visitors", tablet: "Tablet visitors" };
      return devices[String(value).toLowerCase()] ?? (value ? `Visitors using ${value}` : "Visitors with an unknown device");
    }
    default: return "These visitors";
  }
}

function DriversLocked() {
  return (
    <div className="row spread">
      <div className="row" style={{ flex: "1 1 220px", flexWrap: "nowrap", alignItems: "flex-start" }}>
        <Icon name="lock" style={{ flex: "none", marginTop: 2 }} />
        <p className="ink-2 small">See which visitors convert better: Footfall Pro</p>
      </div>
      <Link to="/billing" className="btn small">Upgrade</Link>
    </div>
  );
}

function ProConversionDrivers({ base, funnelId }) {
  const result = useApi(`${base}/funnels/${funnelId}/drivers`);
  const computed = result.data?.drivers;

  if (result.error?.status === 402) return <DriversLocked />;
  if (result.error) return (
    <div className="stack">
      <p className="form-error" role="alert">Couldn't load conversion drivers. {result.error.message} Try loading them again.</p>
      <div className="row"><button type="button" className="btn small" disabled={result.loading} onClick={result.reload}>{result.loading ? "Loading…" : "Retry loading drivers"}</button></div>
    </div>
  );
  if (!result.data) return (
    <div className="stack" aria-busy="true">
      <p className="muted small" role="status">Loading conversion drivers…</p>
      <div className="skeleton" style={{ height: 44 }} />
    </div>
  );
  if (!computed) return <p className="muted small">Conversion drivers are worked out once a day from the last 30 days. Check back tomorrow.</p>;

  return (
    <div className="stack" aria-busy={result.loading}>
      {computed.drivers.length === 0 ? (
        <p className="muted small">No visitor group converts noticeably better or worse than the rest yet (based on {count.format(computed.entered)} visitors who started this funnel).</p>
      ) : (
        <div className="drivers">
          {computed.drivers.map((driver) => (
            <div className="driver" key={`${driver.dimension}:${driver.value}`} style={{ alignItems: "flex-start", padding: "10px 0" }}>
              <Icon name={driver.direction === "better" ? "trendUp" : "trendDown"} style={{ color: driver.direction === "better" ? "var(--good-ink)" : "var(--critical-ink)", flex: "none", marginTop: 2 }} />
              <div className="stack" style={{ gap: 4, minWidth: 0, overflowWrap: "anywhere" }}>
                <p>{driverSubject(driver)} finish this funnel <strong className="num">{multiplier.format(driver.oddsRatio)}x</strong> as often</p>
                <p className="muted small num">{conversionRate.format(driver.rate)} vs {conversionRate.format(driver.restRate)} for everyone else · {count.format(driver.entered)} visitors · 95% range {multiplier.format(driver.ciLow)}x to {multiplier.format(driver.ciHigh)}x</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted small num">Updated <time dateTime={computed.computedAt} title={new Date(computed.computedAt).toLocaleString("en-IN")}>{timeAgo(computed.computedAt)}</time> · based on {count.format(computed.entered)} visitors in the last 30 days</p>
    </div>
  );
}

function NewFunnel({ base, onCreated, onCancel }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState([
    { id: 1, kind: "page", value: "" },
    { id: 2, kind: "page", value: "" },
  ]);
  const nextStep = useRef(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const updateStep = (id, change) => setSteps((current) => current.map((step) => step.id === id ? { ...step, ...change } : step));

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim()) {
      setError("Enter a name so you can find this funnel later.");
      return;
    }
    const invalid = steps.findIndex((step) => !step.value.trim() || (step.kind === "page" && !step.value.trim().startsWith("/")));
    if (invalid !== -1) {
      setError(steps[invalid].kind === "page"
        ? `Step ${invalid + 1} needs a page path beginning with /, such as /pricing.`
        : `Enter the custom event name for step ${invalid + 1}, such as signup.`);
      return;
    }
    setBusy(true);
    try {
      const { funnel } = await api.post(`${base}/funnels`, {
        name: name.trim(),
        steps: steps.map((step) => ({ kind: step.kind, value: step.value.trim() })),
      });
      dispatch(addToast(`${funnel.name} created`));
      onCreated(funnel);
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby="new-funnel-title">
      <div className="card-head">
        <h2 id="new-funnel-title">New funnel</h2>
        <span className="ink-2 small">{steps.length} of 6 steps</span>
      </div>
      <div className="field">
        <label htmlFor="funnel-name">Name</label>
        <input id="funnel-name" value={name} placeholder="Product checkout" required disabled={busy} onChange={(event) => setName(event.target.value)} />
      </div>
      <p className="ink-2 small" id="funnel-step-help">Add 2 to 6 steps in the order visitors should take them. Page paths begin with /. A trailing * matches a prefix, such as /product/*.</p>
      <div className="stack" aria-describedby="funnel-step-help">
        {steps.map((step, index) => (
          <div className="list-row" key={step.id}>
            <div className="grid-2" style={{ flex: "1 1 400px", minWidth: 0 }}>
              <div className="field">
                <label htmlFor={`funnel-kind-${step.id}`}>Step {index + 1} type</label>
                <select id={`funnel-kind-${step.id}`} value={step.kind} disabled={busy} onChange={(event) => updateStep(step.id, { kind: event.target.value })}>
                  <option value="page">Page</option>
                  <option value="event">Custom event</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`funnel-value-${step.id}`}>Step {index + 1} {step.kind === "page" ? "page path" : "event name"}</label>
                <input
                  id={`funnel-value-${step.id}`}
                  value={step.value}
                  placeholder={step.kind === "page" ? (index === 0 ? "/pricing" : "/product/*") : "signup"}
                  required
                  disabled={busy}
                  onChange={(event) => updateStep(step.id, { value: event.target.value })}
                />
              </div>
            </div>
            <button type="button" className="btn ghost small" disabled={busy || steps.length <= 2} onClick={() => setSteps((current) => current.filter((item) => item.id !== step.id))}>Remove step {index + 1}</button>
          </div>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={busy || steps.length >= 6} onClick={() => {
          const id = nextStep.current++;
          setSteps((current) => [...current, { id, kind: "page", value: "" }]);
        }}>Add step</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create funnel"}</button>
        {onCancel && <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function FunnelResult({ base, funnel, query, plan, canManage, onDeleted }) {
  const dispatch = useDispatch();
  const result = useApi(`${base}/funnels/${funnel._id}?${query}`);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const steps = result.data?.steps ?? [];

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.del(`${base}/funnels/${funnel._id}`);
      dispatch(addToast(`${funnel.name} deleted`));
      onDeleted(funnel._id);
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="funnel-result-title">
      <div className="card-head">
        <h2 id="funnel-result-title" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{funnel.name}</h2>
        <div className="row">
          {result.loading && <span className="muted small" role="status">{result.data ? "Updating…" : "Loading results…"}</span>}
          {canManage && !confirming && <button type="button" className="btn danger small" disabled={busy} onClick={() => setConfirming(true)}>Delete funnel</button>}
        </div>
      </div>
      {confirming && (
        <div className="notice">
          <p>Delete the funnel “{funnel.name}”? Its definition will be removed. Your tracked visits and events will stay.</p>
          <div className="row">
            <button type="button" className="btn danger small" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Yes, delete funnel"}</button>
            <button type="button" className="btn ghost small" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {result.error && (
        <div className="stack">
          <p className="form-error" role="alert">Couldn't load the funnel results. {result.error.message}</p>
          <div className="row"><button type="button" className="btn small" disabled={result.loading} onClick={result.reload}>Retry loading results</button></div>
        </div>
      )}
      {result.data && !result.error && (
        <>
          {steps.length > 0 && steps[0].visitors === 0 && <p className="notice small">No visitors reached the first step in this date range. Try a longer range or check that the page path or event name matches what you track.</p>}
          <div className="funnel-steps" aria-busy={result.loading}>
            {steps.map((step, index) => (
              <div className="funnel-step" key={`${step.kind}-${step.value}-${index}`}>
                {index > 0 && <p className="drop">{steps[index - 1].visitors > 0 && step.kept !== null ? `${percent(100 - clampPercent(step.kept))} dropped off here` : "No visitors reached the previous step."}</p>}
                <div className="row spread small">
                  <strong style={{ overflowWrap: "anywhere", minWidth: 0 }}>{index + 1}. {stepLabel(step)}</strong>
                  <span className="ink-2">{formatCount(step.visitors)} visitors · {percent(step.ofStart)} of start</span>
                </div>
                <div className="funnel-track" aria-hidden="true">
                  <div className="funnel-bar" style={{ width: `${clampPercent(step.ofStart)}%`, minWidth: 0 }} />
                </div>
              </div>
            ))}
          </div>
          <details className="table-view">
            <summary>Show as table</summary>
            <div className="table-scroll">
              <table className="data">
                <caption>{funnel.name}: visitors at each step</caption>
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col" className="num">Visitors</th>
                    <th scope="col" className="num">Continued from previous step</th>
                    <th scope="col" className="num">Of first step</th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, index) => (
                    <tr key={`${step.kind}-${step.value}-${index}`}>
                      <th scope="row" style={{ overflowWrap: "anywhere" }}>{index + 1}. {stepLabel(step)}</th>
                      <td className="num">{step.visitors.toLocaleString("en-IN")}</td>
                      <td className="num">{index === 0 || steps[index - 1].visitors === 0 || step.kept === null ? "–" : percent(step.kept)}</td>
                      <td className="num">{percent(step.ofStart)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <section className="stack" aria-labelledby="conversion-drivers-title" style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <h3 id="conversion-drivers-title">What drives conversion</h3>
        {plan === "pro" || plan === "trial"
          ? <ProConversionDrivers key={`${base}:${funnel._id}`} base={base} funnelId={funnel._id} />
          : <DriversLocked />}
      </section>
    </section>
  );
}

function SiteFunnels({ site }) {
  const base = `/api/sites/${site._id}`;
  const list = useApi(`${base}/funnels`);
  const [params, setParams] = useSearchParams();
  const requestedRange = params.get("range") ?? "7d";
  const rangeKey = RANGES.some((range) => range.key === requestedRange) ? requestedRange : "7d";
  const query = useMemo(() => rangeQuery(rangeKey), [rangeKey]);
  const [selectedId, setSelectedId] = useState(null);
  const [deletedIds, setDeletedIds] = useState([]);
  const [adding, setAdding] = useState(false);
  const funnels = (list.data?.funnels ?? []).filter((funnel) => !deletedIds.includes(funnel._id));
  const selected = funnels.find((funnel) => funnel._id === selectedId) ?? funnels[0];
  const canManage = site.role === "owner" || site.role === "admin";
  const empty = list.data && !list.error && funnels.length === 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" role="group" aria-label="Date range">
        <div className="segmented">
          {RANGES.map((range) => (
            <button key={range.key} type="button" aria-pressed={range.key === rangeKey} onClick={() => setParams({ range: range.key }, { replace: true })}>{range.label}</button>
          ))}
        </div>
      </div>
      <section className="card">
        <div className="card-head">
          <h2>Funnels</h2>
          {canManage && !adding && !empty && <button type="button" className="btn primary" onClick={() => setAdding(true)}>New funnel</button>}
        </div>
        <p className="ink-2 small">See how many visitors make it through a series of pages and custom events. Visitors must complete the steps in order on the same day.</p>
        {list.loading && <p className="muted small" role="status">{list.data ? "Updating funnels…" : "Loading funnels…"}</p>}
        {list.error && (
          <div className="stack">
            <p className="form-error" role="alert">Couldn't load your funnels. {list.error.message}</p>
            <div className="row"><button type="button" className="btn small" disabled={list.loading} onClick={list.reload}>Retry loading funnels</button></div>
          </div>
        )}
        {empty && (
          <div className="empty">
            <h3>No funnels yet</h3>
            <p>A funnel shows where visitors stop on the way to a goal. For a shop, try visiting <code>/</code> → <code>/product/*</code> → <code>/cart</code> → event <code>paid</code>.</p>
            {!canManage && <p>Ask an owner or admin to create a funnel for this site.</p>}
          </div>
        )}
        {funnels.length > 0 && (
          <div aria-label="Choose a funnel">
            {funnels.map((funnel) => (
              <div className="list-row" key={funnel._id}>
                <button
                  type="button"
                  className={`btn small${selected?._id === funnel._id ? " primary" : ""}`}
                  style={{ whiteSpace: "normal", overflowWrap: "anywhere", textAlign: "left", minWidth: 0 }}
                  aria-pressed={selected?._id === funnel._id}
                  onClick={() => setSelectedId(funnel._id)}
                >{funnel.name}</button>
                <span className="ink-2 small">{funnel.steps.length} steps{selected?._id === funnel._id ? " · Selected" : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      {selected && <FunnelResult key={selected._id} base={base} funnel={selected} query={query} plan={site.plan} canManage={canManage} onDeleted={(id) => {
        setDeletedIds((current) => [...current, id]);
        setSelectedId(null);
        list.reload();
      }} />}
      {canManage && (adding || empty) && <NewFunnel base={base} onCancel={funnels.length > 0 ? () => setAdding(false) : null} onCreated={(funnel) => {
        setSelectedId(funnel._id);
        setAdding(false);
        list.reload();
      }} />}
    </div>
  );
}

export default function Funnels() {
  const { site } = useOutletContext();
  return <SiteFunnels key={`${site._id}:${site.role}`} site={site} />;
}
