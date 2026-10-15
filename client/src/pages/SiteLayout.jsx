import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { socket } from "../services/socket";
import LiveCount from "../components/LiveCount";

export default function SiteLayout() {
  const { siteId } = useParams();
  const { data, error, reload } = useApi(`/api/sites/${siteId}`);
  const [live, setLive] = useState(null);
  const [installed, setInstalled] = useState(null);
  const site = data?.site;

  useEffect(() => {
    setLive(null);
    setInstalled(null);
    const watch = () => socket.emit("watch", { siteId }, (res) => res?.ok && setLive(res.live));
    const onLive = (msg) => msg.siteId === siteId && setLive(msg.count);
    const onInstalled = (msg) => msg.siteId === siteId && setInstalled(true);

    if (socket.connected) watch();
    socket.on("connect", watch);
    // Sent when access to the site changes; prove access again.
    socket.on("rewatch", watch);
    socket.on("live", onLive);
    socket.on("installed", onInstalled);
    return () => {
      socket.off("connect", watch);
      socket.off("rewatch", watch);
      socket.off("live", onLive);
      socket.off("installed", onInstalled);
    };
  }, [siteId]);

  if (error) {
    return (
      <main className="page">
        <div className="empty">
          <h1>{error.status === 404 ? "Site not found" : "Couldn't load this site"}</h1>
          <p>{error.status === 404 ? "It doesn't exist, or you don't have access to it." : error.message}</p>
          <NavLink className="btn" to="/sites">Back to your sites</NavLink>
        </div>
      </main>
    );
  }

  if (!site) return <main className="page"><p className="muted">Loading…</p></main>;

  const context = { site: { ...site, installed: installed ?? site.installed }, live: live ?? site.live ?? 0, reloadSite: reload };

  return (
    <main className="page">
      <div className="site-head">
        <div className="stack" style={{ gap: 2 }}>
          <div className="row">
            <h1>{site.name}</h1>
            <span className="badge">{site.role}</span>
          </div>
          <a className="muted small" href={`https://${site.domain}`} target="_blank" rel="noreferrer">{site.domain}</a>
        </div>
        <LiveCount count={context.live} />
      </div>
      <nav className="tabs" aria-label="Site sections">
        <NavLink end to={`/sites/${siteId}`}>Overview</NavLink>
        <NavLink to={`/sites/${siteId}/funnels`}>Funnels</NavLink>
        <NavLink to={`/sites/${siteId}/insights`}>Forecast &amp; alerts</NavLink>
        <NavLink to={`/sites/${siteId}/settings`}>Settings</NavLink>
      </nav>
      <Outlet context={context} />
    </main>
  );
}
