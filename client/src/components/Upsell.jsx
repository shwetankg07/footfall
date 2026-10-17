import { Link } from "react-router-dom";
import Icon from "./Icon";

const FEATURES = [
  { icon: "trendUp", title: "Forecasts and alerts", text: "A model learns each site's weekly rhythm and tells you within the hour when traffic jumps or drops." },
  { icon: "target", title: "Why it changed", text: "Every alert names the source, page, device or country behind it." },
  { icon: "funnel", title: "Conversion drivers", text: "See which visitors finish your funnels more often, backed by significance tests." },
  { icon: "spark", title: "Opportunities", text: "A ranked weekly list of fixes: leaky pages, strong sources, the hours your audience shows up." },
];

// What a free site sees where a Pro feature would be.
export default function Upsell({ canUpgrade = true }) {
  return (
    <section className="upsell" aria-labelledby="upsell-title">
      <div className="stack" style={{ gap: 14 }}>
        <span className="badge pro" style={{ width: "fit-content" }}><Icon name="lock" size={12} />Footfall Pro</span>
        <h2 id="upsell-title" style={{ fontSize: "1.25rem" }}>Know what changed, and what to do about it.</h2>
        <p className="ink-2">
          Your traffic is already being recorded. Pro runs our models over it every hour and turns it into alerts that explain themselves and a short list of
          things worth fixing.
        </p>
        <div className="row">
          {canUpgrade ? <Link to="/billing" className="btn accent">Upgrade to Pro</Link> : <span className="muted small">Ask the site owner to upgrade.</span>}
          <Link to="/pricing" className="btn ghost">Compare plans</Link>
        </div>
      </div>
      <ul>
        {FEATURES.map((feature) => (
          <li key={feature.title}>
            <Icon name={feature.icon} />
            <span><strong>{feature.title}</strong>{feature.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
