import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useOutletContext } from "react-router-dom";
import InstallSnippet from "../components/InstallSnippet";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { siteChanged, siteRemoved } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";

const TIMEZONES = ["UTC", ...(Intl.supportedValuesOf?.("timeZone") ?? [])];

function Team({ site, reloadSite }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const userId = useSelector((state) => state.auth.user._id);
  const base = `/api/sites/${site._id}`;
  const team = useApi(`${base}/members`);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const canManage = site.role === "owner" || site.role === "admin";
  const disabled = busy !== null || team.loading;
  const members = team.data?.members ?? [];
  const invites = team.data?.invites ?? [];

  const mutate = async (key, request, message, after) => {
    if (busy !== null) return;
    setBusy(key);
    setError("");
    try {
      await request();
      dispatch(addToast(message));
      setConfirmation(null);
      team.reload();
      after?.();
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(null);
    }
  };

  const leave = () => mutate("leave", () => api.del(`${base}/members/${userId}`), `You left ${site.name}`, () => {
    dispatch(siteRemoved(site._id));
    navigate("/sites");
  });

  const invite = (event) => {
    event.preventDefault();
    const address = email.trim();
    mutate("invite", () => api.post(`${base}/invites`, { email: address, role }), `Invite added for ${address}`, () => setEmail(""));
  };

  return (
    <section className="card" aria-labelledby="team-title">
      <div className="card-head">
        <h2 id="team-title">Team</h2>
        {team.loading && <span className="muted small" role="status">{team.data ? "Updating team…" : "Loading team…"}</span>}
      </div>
      <p className="ink-2 small">Owners and admins can change site settings and manage the team. Viewers can read the site's reports.</p>
      {team.error && (
        <div className="stack">
          <p className="form-error" role="alert">Couldn't load the team. {team.error.message}</p>
          <div className="row"><button type="button" className="btn small" disabled={disabled} onClick={team.reload}>Retry loading team</button></div>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div>
        {members.map((member) => (
          <div className="list-row" key={member.user._id}>
            <div className="stack" style={{ gap: 2, minWidth: 0, overflowWrap: "anywhere" }}>
              <div className="row">
                <strong>{member.user.name}{member.user._id === userId ? " (you)" : ""}</strong>
                <span className="badge">{member.role}</span>
              </div>
              <span className="ink-2 small">{member.user.email}</span>
            </div>
            {canManage && member.role !== "owner" && (
              <div className="row">
                <div className="field">
                  <label htmlFor={`member-role-${member.user._id}`}>Role for {member.user.email}</label>
                  <select
                    id={`member-role-${member.user._id}`}
                    value={member.role}
                    disabled={disabled}
                    onChange={(event) => {
                      const nextRole = event.target.value;
                      mutate(`role-${member.user._id}`, () => api.patch(`${base}/members/${member.user._id}`, { role: nextRole }), `${member.user.name}'s role changed to ${nextRole}`, reloadSite);
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                {member.user._id !== userId && (confirmation === member.user._id ? (
                  <div className="stack" style={{ gap: 6 }}>
                    <p className="small">Remove {member.user.email} from this site?</p>
                    <div className="row">
                      <button type="button" className="btn danger small" disabled={disabled} onClick={() => mutate(`remove-${member.user._id}`, () => api.del(`${base}/members/${member.user._id}`), `${member.user.name} removed from the site`)}>{busy === `remove-${member.user._id}` ? "Removing…" : "Yes, remove member"}</button>
                      <button type="button" className="btn ghost small" disabled={disabled} onClick={() => setConfirmation(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn danger small" disabled={disabled} aria-label={`Remove ${member.user.email}`} onClick={() => setConfirmation(member.user._id)}>Remove</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <>
          <div className="stack" style={{ gap: 6 }}>
            <h3>Pending invites</h3>
            {team.data && invites.length === 0 && <p className="muted small">No pending invites.</p>}
            {invites.map((pending) => (
              <div className="list-row" key={pending._id}>
                <div className="row" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <span>{pending.email}</span>
                  <span className="badge">{pending.role}</span>
                  <span className="ink-2 small">Pending</span>
                </div>
                <button type="button" className="btn small" disabled={disabled} aria-label={`Cancel invite for ${pending.email}`} onClick={() => mutate(`invite-${pending._id}`, () => api.del(`${base}/invites/${pending._id}`), `Invite for ${pending.email} canceled`)}>{busy === `invite-${pending._id}` ? "Canceling…" : "Cancel invite"}</button>
              </div>
            ))}
          </div>
          <form className="stack" onSubmit={invite} aria-labelledby="invite-title">
            <h3 id="invite-title">Invite a teammate</h3>
            <p className="ink-2 small" id="invite-help">No email is sent. Your teammate can see and accept the invite after logging in to Footfall with this email address.</p>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="invite-email">Email address</label>
                <input id="invite-email" type="email" autoComplete="email" placeholder="teammate@example.com" value={email} required disabled={disabled} aria-describedby="invite-help" onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="invite-role">Role</label>
                <select id="invite-role" value={role} disabled={disabled} onChange={(event) => setRole(event.target.value)}>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="row"><button type="submit" className="btn primary" disabled={disabled}>{busy === "invite" ? "Adding invite…" : "Add invite"}</button></div>
          </form>
        </>
      )}
      {site.role !== "owner" && (
        <div className="notice">
          {confirmation === "leave" ? (
            <>
              <p>Leave {site.domain}? You'll lose access to its reports and will need a new invite to return.</p>
              <div className="row">
                <button type="button" className="btn danger" disabled={busy !== null} onClick={leave}>{busy === "leave" ? "Leaving…" : "Yes, leave site"}</button>
                <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setConfirmation(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <div className="row"><button type="button" className="btn danger" disabled={busy !== null} onClick={() => setConfirmation("leave")}>Leave site</button></div>
          )}
        </div>
      )}
    </section>
  );
}

function PublicLink({ site, reloadSite }) {
  const dispatch = useDispatch();
  const [token, setToken] = useState(site.shareToken ?? null);
  const [busy, setBusy] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState("");
  const url = token ? `${window.location.origin}/share/${token}` : "";
  const base = `/api/sites/${site._id}/share`;

  const changeLink = async (turnOff = false) => {
    if (busy !== null) return;
    setBusy(turnOff ? "off" : "create");
    setError("");
    try {
      if (turnOff) {
        await api.del(base);
        setToken(null);
      } else {
        const { shareToken } = await api.post(base);
        setToken(shareToken);
      }
      dispatch(addToast(turnOff ? "Public link turned off" : token ? "New public link created. The old link no longer works." : "Public link created"));
      setConfirmation(null);
      reloadSite();
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (busy !== null) return;
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(url);
      dispatch(addToast("Public link copied"));
    } catch {
      dispatch(addToast("Couldn't copy the public link. Select it and copy it yourself.", "error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="public-link-title">
      <div className="card-head">
        <h2 id="public-link-title">Public link</h2>
        <span className="badge">{token ? "On" : "Off"}</span>
      </div>
      <p className="ink-2 small">Anyone with this link can view the site's traffic dashboard without logging in.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {token ? (
        <>
          <div className="field">
            <label htmlFor="public-link">Share URL</label>
            <input id="public-link" value={url} readOnly onFocus={(event) => event.target.select()} />
          </div>
          <div className="row">
            <button type="button" className="btn" disabled={busy !== null} onClick={copy}>{busy === "copy" ? "Copying…" : "Copy"}</button>
            <a className="btn" href={url} target="_blank" rel="noreferrer">Open link</a>
            {!confirmation && <>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirmation("replace")}>Make a new link</button>
              <button type="button" className="btn danger" disabled={busy !== null} onClick={() => setConfirmation("off")}>Turn off</button>
            </>}
          </div>
          <p className="ink-2 small">Making a new link breaks the old one. Turning it off stops public access.</p>
          {confirmation && (
            <div className="notice">
              <p>{confirmation === "off" ? "Turn off public access? The current link will stop working." : "Make a new public link? The current link will stop working, so you'll need to share the new one."}</p>
              <div className="row">
                <button type="button" className={`btn${confirmation === "off" ? " danger" : " primary"}`} disabled={busy !== null} onClick={() => changeLink(confirmation === "off")}>{busy ? "Updating link…" : confirmation === "off" ? "Yes, turn off" : "Yes, make a new link"}</button>
                <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setConfirmation(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="row"><button type="button" className="btn primary" disabled={busy !== null} onClick={() => changeLink()}>{busy ? "Creating link…" : "Create public link"}</button></div>
      )}
    </section>
  );
}

function SiteDetails({ site, reloadSite }) {
  const dispatch = useDispatch();
  const [name, setName] = useState(site.name);
  const [timezone, setTimezone] = useState(site.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timezones = TIMEZONES.includes(site.timezone) ? TIMEZONES : [site.timezone, ...TIMEZONES];

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!name.trim()) {
      setError("Enter a name for this site before saving.");
      return;
    }
    setBusy(true);
    try {
      const { site: updated } = await api.patch(`/api/sites/${site._id}`, { name: name.trim(), timezone });
      setName(updated.name);
      setTimezone(updated.timezone);
      dispatch(siteChanged({ _id: site._id, name: updated.name, timezone: updated.timezone }));
      dispatch(addToast("Site details saved"));
      reloadSite();
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={save} noValidate aria-labelledby="site-details-title">
      <div className="card-head"><h2 id="site-details-title">Site details</h2></div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="settings-site-name">Name</label>
          <input id="settings-site-name" value={name} required disabled={busy} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="settings-site-timezone">Timezone</label>
          <select id="settings-site-timezone" value={timezone} disabled={busy} aria-describedby="timezone-help" onChange={(event) => setTimezone(event.target.value)}>
            {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <span className="hint" id="timezone-help">Reports use this timezone to group visits into days.</span>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row"><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}

function DangerZone({ site }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.del(`/api/sites/${site._id}`);
      dispatch(siteRemoved(site._id));
      dispatch(addToast(`${site.domain} deleted`));
      navigate("/sites");
    } catch (err) {
      setError(err.message);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="danger-zone-title">
      <div className="card-head"><h2 id="danger-zone-title">Danger zone</h2></div>
      <p className="ink-2 small">Deleting this site permanently removes its reports, funnels, and team access.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {confirming ? (
        <div className="notice">
          <p>Delete <strong>{site.domain}</strong> and all of its tracked data? Everyone on the team will lose access. This can't be undone.</p>
          <div className="row">
            <button type="button" className="btn danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Yes, delete site"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row"><button type="button" className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>Delete site</button></div>
      )}
    </section>
  );
}

function SiteSettings({ site, reloadSite }) {
  const canManage = site.role === "owner" || site.role === "admin";
  return (
    <div className="stack" style={{ gap: 20 }}>
      <InstallSnippet site={site} waiting={!site.installed} />
      <Team site={site} reloadSite={reloadSite} />
      {canManage && <PublicLink key={site.shareToken ?? "off"} site={site} reloadSite={reloadSite} />}
      {canManage && <SiteDetails site={site} reloadSite={reloadSite} />}
      {site.role === "owner" && <DangerZone site={site} />}
    </div>
  );
}

export default function Settings() {
  const { site, reloadSite } = useOutletContext();
  return <SiteSettings key={`${site._id}:${site.role}`} site={site} reloadSite={reloadSite} />;
}
