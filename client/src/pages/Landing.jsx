import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import PublicBar from "../components/PublicBar";
import Icon from "../components/Icon";
import { API_URL } from "../services/api";

const DEMO = import.meta.env.VITE_DEMO_SHARE_PATH;

const FREE = [
  ["Live visitors", "See who is on the site right now, updated the moment a page loads."],
  ["Traffic that makes sense", "Visitors, pages, sources, devices and countries on one screen, compared with the period before."],
  ["Funnels", "Count how many people make it from your home page to the thing you want them to do."],
  ["Private by design", "No cookies and no stored IP addresses, so no consent banner."],
];

const PRO = [
  ["trendUp", "Alerts that know your normal", "A model learns your weekly rhythm and flags the hours that break it."],
  ["target", "Why it changed", "Each alert names the source, page or device behind the jump."],
  ["funnel", "Conversion drivers", "Which visitors finish your funnels more often, with the evidence."],
  ["spark", "Opportunities", "A ranked list of fixes worth making this week."],
];

export default function Landing() {
  const user = useSelector((state) => state.auth.user);

  return (
    <>
      <PublicBar />
      <main className="page" style={{ gap: 72, paddingTop: 72 }}>
        <section className="stack" style={{ gap: 20, maxWidth: 760 }}>
          <h1 style={{ fontSize: "clamp(2.1rem, 5vw, 3.25rem)", lineHeight: 1.08, letterSpacing: "-0.03em" }}>
            Analytics for your website, and answers when the numbers move.
          </h1>
          <p className="ink-2" style={{ fontSize: "1.0625rem", maxWidth: "60ch" }}>
            Add one line to your site and see visitors, pages and sources live, with no cookies. Upgrade when you want Footfall's models to tell you what changed,
            why, and what to fix.
          </p>
          <div className="row">
            <Link to={user ? "/sites" : "/register"} className="btn primary" style={{ height: 38, padding: "0 16px" }}>
              {user ? "Open dashboard" : "Start free"}
            </Link>
            {DEMO && <Link to={DEMO} className="btn" style={{ height: 38, padding: "0 16px" }}>See a live demo</Link>}
            <span className="muted small">Free for 3 sites. Every account starts with 14 days of Pro.</span>
          </div>
        </section>

        <section className="card" style={{ maxWidth: 760, padding: 0, overflow: "hidden" }} aria-label="Install">
          <div className="card-head" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", minHeight: 0 }}>
            <span className="small ink-2">The whole install</span>
            <span className="badge">under 2 KB</span>
          </div>
          <pre className="snippet" style={{ border: 0, borderRadius: 0 }}>{`<script defer src="${API_URL}/t.js" data-site="example.com"></script>`}</pre>
        </section>

        <section className="grid-2" style={{ gap: 48, alignItems: "start" }}>
          <div className="stack" style={{ gap: 16 }}>
            <h2 style={{ fontSize: "1.25rem" }}>Free, and actually useful</h2>
            <ul className="checks">
              {FREE.map(([title, text]) => (
                <li key={title}><Icon name="check" /><span><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{title}.</strong> {text}</span></li>
              ))}
            </ul>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <div className="row"><h2 style={{ fontSize: "1.25rem" }}>Pro adds Intelligence</h2><span className="badge pro">₹499 / month</span></div>
            <ul className="checks">
              {PRO.map(([icon, title, text]) => (
                <li key={title}><Icon name={icon} /><span><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{title}.</strong> {text}</span></li>
              ))}
            </ul>
            <Link to="/pricing" className="btn" style={{ width: "fit-content" }}>Compare plans</Link>
          </div>
        </section>

        <footer className="row spread muted small" style={{ borderTop: "1px solid var(--border)", paddingTop: 20 }}>
          <span>Footfall</span>
          <span className="row"><Link to="/pricing">Pricing</Link><a href="https://github.com/shwetankg07/footfall">Source</a></span>
        </footer>
      </main>
    </>
  );
}
