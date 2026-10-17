import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
import { siteChanged } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";
import LiveCount from "../components/LiveCount";
import Icon from "../components/Icon";
import { SiteMark } from "../components/SiteSwitcher";
import { formatCount } from "../utils/format";

function AddSite({ onDone }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", domain: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { site } = await api.post("/api/sites", form);
      dispatch(siteChanged({ ...site, live: 0, last24h: { visitors: 0, pageviews: 0 } }));
      dispatch(addToast(`${site.domain} added`));
      navigate(`/sites/${site._id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>Add a website</h2>
        {onDone && <button className="btn ghost small" type="button" onClick={onDone}>Cancel</button>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error.message} {error.status === 402 && <Link to="/billing">See plans</Link>}
        </p>
      )}
      <div className="grid-2">
        <div className="field">
          <label htmlFor="site-name">Name</label>
          <input id="site-name" placeholder="My portfolio" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="site-domain">Domain</label>
          <input id="site-domain" placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <span className="hint">Subdomains are counted too.</span>
        </div>
      </div>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add website"}</button>
      </div>
    </form>
  );
}

export default function Sites() {
  const { list, status, error } = useSelector((state) => state.sites);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("add") === "1");
  const firstLoad = status !== "ready" && list.length === 0 && !error;

  useEffect(() => {
    if (params.get("add") === "1") {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <main className="page">
      <header className="page-head">
        <div className="title">
          <h1>Sites</h1>
          <span>Every website you own or were invited to.</span>
        </div>
        {list.length > 0 && !adding && (
          <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add website</button>
        )}
      </header>

      {error && <p className="form-error">{error}</p>}
      {(adding || (status === "ready" && list.length === 0)) && <AddSite onDone={list.length ? () => setAdding(false) : null} />}

      {firstLoad && (
        <div className="site-list" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="site-row"><div className="skeleton" style={{ height: 32, gridColumn: "1 / -1" }} /></div>)}
        </div>
      )}

      {list.length > 0 && (
        <div className="site-list">
          <div className="site-list-head" aria-hidden="true">
            <span>Website</span>
            <span className="hide-sm">Visitors, 24h</span>
            <span className="hide-sm">Page views, 24h</span>
            <span>Now</span>
            <span />
          </div>
          {list.map((site) => (
            <Link key={site._id} to={`/sites/${site._id}`} className="site-row">
              <span className="who">
                <SiteMark name={site.name} />
                <div>
                  <strong>{site.name}</strong>
                  <span>{site.domain}{site.role !== "owner" ? ` · ${site.role}` : ""}</span>
                </div>
              </span>
              {site.installed ? (
                <>
                  <span className="stat hide-sm">{formatCount(site.last24h.visitors)}</span>
                  <span className="stat hide-sm">{formatCount(site.last24h.pageviews)}</span>
                  <LiveCount count={site.live} compact />
                </>
              ) : (
                <>
                  <span className="hide-sm muted">–</span>
                  <span className="hide-sm muted">–</span>
                  <span className="badge warn">Not installed</span>
                </>
              )}
              <Icon name="chevronRight" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
