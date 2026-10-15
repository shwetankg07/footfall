import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { socket } from "../services/socket";
import Logo from "../components/Logo";
import LiveCount from "../components/LiveCount";
import TrafficView from "../components/TrafficView";

// Public, read-only dashboard behind an unguessable link. No login.
export default function Share() {
  const { token } = useParams();
  const { data, error } = useApi(`/api/share/${token}`);
  const [live, setLive] = useState(null);
  const site = data?.site;

  useEffect(() => {
    if (!socket.connected) socket.connect();
    const watch = () => socket.emit("watch", { shareToken: token }, (res) => res?.ok && setLive(res.live));
    const onLive = (msg) => setLive(msg.count);
    if (socket.connected) watch();
    socket.on("connect", watch);
    socket.on("live", onLive);
    return () => {
      socket.off("connect", watch);
      socket.off("live", onLive);
    };
  }, [token]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark"><Logo />Footfall</Link>
          <nav><Link to="/register" className="btn">Get your own</Link></nav>
        </div>
      </header>
      <main className="page">
        {error && (
          <div className="empty">
            <h1>This link doesn't work</h1>
            <p>{error.message}</p>
          </div>
        )}
        {site && (
          <>
            <div className="site-head">
              <div className="stack" style={{ gap: 2 }}>
                <h1>{site.name}</h1>
                <span className="muted small">{site.domain} · public dashboard</span>
              </div>
              <LiveCount count={live ?? site.live} />
            </div>
            <TrafficView apiBase={`/api/share/${token}`} timezone={site.timezone} />
          </>
        )}
      </main>
    </>
  );
}
