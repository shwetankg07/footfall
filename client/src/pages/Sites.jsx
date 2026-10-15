import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useApi } from "../hooks/useApi";
import { fetchSites, siteChanged } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";
import LiveCount from "../components/LiveCount";
import { formatCount } from "../utils/format";

function Invites() {
  const dispatch = useDispatch();
  const { data, reload } = useApi("/api/invites");
  const [busy, setBusy] = useState(null);
  const invites = data?.invites ?? [];
  if (invites.length === 0) return null;

  const answer = async (invite, choice) => {
    setBusy(invite._id);
    try {
      const result = await api.post(`/api/invites/${invite._id}/${choice}`);
      dispatch(addToast(result.message));
      if (choice === "accept") dispatch(fetchSites());
    } catch (error) {
      dispatch(addToast(error.message, "error"));
    }
    setBusy(null);
    reload();
  };

  return (
    <section className="notice">
      <h2>Invites</h2>
      {invites.map((invite) => (
        <div className="list-row" key={invite._id}>
          <span>
            <strong>{invite.invitedBy?.name ?? "Someone"}</strong> invited you to <strong>{invite.site.name}</strong>{" "}
            <span className="muted">({invite.site.domain})</span> as <span className="badge">{invite.role}</span>
          </span>
          <span className="row">
            <button type="button" className="btn primary small" disabled={busy === invite._id} onClick={() => answer(invite, "accept")}>Accept</button>
            <button type="button" className="btn small" disabled={busy === invite._id} onClick={() => answer(invite, "decline")}>Decline</button>
          </span>
        </div>
      ))}
    </section>
  );
}

function AddSite({ onDone }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", domain: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { site } = await api.post("/api/sites", form);
      dispatch(siteChanged({ ...site, live: 0, last24h: { visitors: 0, pageviews: 0 } }));
      dispatch(addToast(`${site.domain} added`));
      navigate(`/sites/${site._id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} noValidate>
      <h2>Add a website</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
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
        {onDone && <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Sites() {
  const { list, status, error } = useSelector((state) => state.sites);
  const [adding, setAdding] = useState(false);
  const firstLoad = status === "loading" && list.length === 0;

  return (
    <main className="page">
      <div className="row spread">
        <h1>Your websites</h1>
        {list.length > 0 && !adding && <button type="button" className="btn primary" onClick={() => setAdding(true)}>Add website</button>}
      </div>
      <Invites />
      {error && <p className="form-error">{error}</p>}
      {firstLoad && <p className="muted">Loading your sites…</p>}
      {(adding || (status === "ready" && list.length === 0)) && <AddSite onDone={list.length ? () => setAdding(false) : null} />}
      <div className="site-cards">
        {list.map((site) => (
          <Link key={site._id} to={`/sites/${site._id}`} className="card site-card">
            <div className="row spread">
              <div>
                <h2>{site.name}</h2>
                <span className="muted small">{site.domain}</span>
              </div>
              <span className="badge">{site.role}</span>
            </div>
            {site.installed ? (
              <>
                <div className="row" style={{ gap: 24 }}>
                  <div><div className="big">{formatCount(site.last24h.visitors)}</div><div className="muted small">visitors, 24h</div></div>
                  <div><div className="big">{formatCount(site.last24h.pageviews)}</div><div className="muted small">page views, 24h</div></div>
                </div>
                <LiveCount count={site.live} />
              </>
            ) : (
              <span className="ink-2 small">Not installed yet. Open it to get the snippet.</span>
            )}
          </Link>
        ))}
      </div>
    </main>
  );
}
