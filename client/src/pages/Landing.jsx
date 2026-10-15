import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";
import { API_URL } from "../services/api";

const DEMO = import.meta.env.VITE_DEMO_SHARE_PATH;

export default function Landing() {
  const user = useSelector((state) => state.auth.user);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="wordmark"><Logo />Footfall</Link>
          <nav>
            {user ? (
              <Link to="/sites" className="btn primary">Open dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn ghost">Log in</Link>
                <Link to="/register" className="btn primary">Create account</Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="page" style={{ gap: 48 }}>
        <section className="stack" style={{ gap: 18, maxWidth: 720, paddingTop: 24 }}>
          <span className="eyebrow">Web analytics without cookies</span>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1.1 }}>See who walks into your website, live.</h1>
          <p className="ink-2" style={{ fontSize: "1.1rem" }}>
            Add one line to your site. Footfall shows visitors, pages and sources, counts people through your funnels, and learns your normal traffic so it can
            tell you when something unusual happens.
          </p>
          <div className="row">
            <Link to={user ? "/sites" : "/register"} className="btn primary">{user ? "Open dashboard" : "Start free"}</Link>
            {DEMO && <Link to={DEMO} className="btn">See a live demo</Link>}
          </div>
        </section>

        <section className="card" style={{ maxWidth: 720 }}>
          <span className="eyebrow">The whole install</span>
          <pre className="snippet">{`<script defer src="${API_URL}/t.js" data-site="example.com"></script>`}</pre>
        </section>

        <section className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div className="card">
            <h2>Private by design</h2>
            <p className="ink-2">No cookies and no stored IP addresses. Each visitor becomes an anonymous code that resets every day, so nobody is tracked across days.</p>
          </div>
          <div className="card">
            <h2>Funnels</h2>
            <p className="ink-2">Pick the steps that matter, like home, product, cart, paid. See how many people make it through each one and where they give up.</p>
          </div>
          <div className="card">
            <h2>Alerts that learn</h2>
            <p className="ink-2">A forecasting model learns each site's weekly rhythm and flags hours that fall far outside it, by email and right in the dashboard.</p>
          </div>
          <div className="card">
            <h2>Built for teams</h2>
            <p className="ink-2">Invite teammates as admins or viewers, or share a read-only public dashboard with a link you can turn off any time.</p>
          </div>
        </section>
      </main>
    </>
  );
}
