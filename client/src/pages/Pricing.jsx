import { useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import PublicBar from "../components/PublicBar";

// Public prices, in paise, matching the billing API. No sign-in is needed to see them.
const PRICES = { month: 49900, year: 499000 };
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const FREE_FEATURES = [
  "3 sites",
  "Last 30 days of history",
  "Live visitors",
  "Traffic sources, pages, devices and countries",
  "Funnels",
  "Team invites and public links",
  "Cookieless analytics",
];
const INTELLIGENCE_FEATURES = ["Forecasts and alerts", "Root cause on every alert", "Conversion drivers", "Opportunities"];
const PRO_FEATURES = [
  "Everything in Free",
  "Unlimited sites",
  "Full history",
  "Hourly forecasts with spike and drop alerts",
  "“Why it changed” root cause on every alert",
  "Conversion drivers on every funnel",
  "Weekly opportunities feed",
  "Email alerts",
];
const COMPARISON = [
  ["Sites", "3", "Unlimited"],
  ["History", "Last 30 days", "Full history"],
  ["Live visitors", true, true],
  ["Traffic sources, pages, devices and countries", true, true],
  ["Funnels", true, true],
  ["Team invites and public links", true, true],
  ["Cookieless analytics", true, true],
  ["Hourly forecasts and spike / drop alerts", false, true],
  ["Root cause on every alert", false, true],
  ["Conversion drivers on every funnel", false, true],
  ["Weekly opportunities feed", false, true],
  ["Email alerts", false, true],
];

function FeatureValue({ value }) {
  if (typeof value !== "boolean") return value;
  return <span role="img" aria-label={value ? "Included" : "Not included"}><Icon name={value ? "check" : "x"} /></span>;
}

export default function Pricing() {
  const user = useSelector((state) => state.auth.user);
  const [interval, setInterval] = useState("month");

  return (
    <>
      <PublicBar>
        {user ? <Link to="/sites" className="btn primary">Dashboard</Link> : <>
          <Link to="/login" className="btn ghost">Log in</Link>
          <Link to="/register" className="btn primary">Start free</Link>
        </>}
      </PublicBar>
      <main className="page">
        <header className="page-head">
          <div className="title">
            <h1>Pricing</h1>
            <span>Analytics are free. Pay for the answers.</span>
          </div>
          <div className="segmented" role="group" aria-label="Pro payment period">
            <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")}>Monthly</button>
            <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")}>Yearly <span className="muted">· 2 months free</span></button>
          </div>
        </header>

        <div className="plans">
          <section className="plan" aria-labelledby="free-plan-title">
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="free-plan-title">Free</h2>
              <p className="muted small">For personal sites.</p>
            </div>
            <p className="price num">₹0 <span>forever</span></p>
            <Link to={user ? "/sites" : "/register"} className="btn block">{user ? "Go to dashboard" : "Start free"}</Link>
            <ul className="checks">
              {FREE_FEATURES.map((feature) => <li key={feature}><Icon name="check" /><span>{feature}</span></li>)}
              {INTELLIGENCE_FEATURES.map((feature) => <li key={feature} className="off"><Icon name="x" /><span>{feature}</span></li>)}
            </ul>
          </section>
          <section className="plan featured" aria-labelledby="pro-plan-title">
            <div className="stack" style={{ gap: 4 }}>
              <div className="row spread">
                <h2 id="pro-plan-title">Pro</h2>
                <span className="badge pro">14-day free trial</span>
              </div>
              <p className="muted small">Footfall Intelligence. See what changed and why.</p>
            </div>
            <p className="price num" aria-live="polite">{rupees.format(PRICES[interval] / 100)}<span> / {interval === "year" ? "year" : "month"}</span></p>
            <Link to={user ? "/billing" : "/register"} className="btn primary block">{user ? "Choose Pro" : "Start 14-day Pro trial"}</Link>
            <ul className="checks">
              {PRO_FEATURES.map((feature) => <li key={feature}><Icon name="check" /><span>{feature}</span></li>)}
            </ul>
            <p className="muted small">Every new account gets 14 days of Pro. No card needed.</p>
          </section>
        </div>

        <section className="card" aria-labelledby="compare-plans-title">
          <div className="card-head"><h2 id="compare-plans-title">Compare plans</h2></div>
          <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Plan comparison">
            <table className="data">
              <thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
              <tbody>
                {COMPARISON.map(([feature, free, pro]) => (
                  <tr key={feature}>
                    <th scope="row">{feature}</th>
                    <td><FeatureValue value={free} /></td>
                    <td><FeatureValue value={pro} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="pricing-faq-title">
          <div className="card-head"><h2 id="pricing-faq-title">Questions about pricing</h2></div>
          {[
            ["Is the free plan really free?", "Yes. No card, no time limit. Track up to 3 sites and see the last 30 days of history."],
            ["What happens after the trial?", "Your account moves to Free. Nothing is deleted. Footfall Intelligence pauses, and your dashboard shows the last 30 days. Pay for Pro whenever you want to resume Intelligence and access full history."],
            ["How does billing work?", "A payment buys 30 or 365 days of Pro. There is no auto-renewal; pay again to extend your time. In test mode, use Razorpay test card 4100 2800 0000 1007 with any future date and any CVV, or choose Netbanking and then Success."],
            ["Do you use cookies?", "No. Each visitor becomes an anonymous daily code, so we can count visits without cookies."],
          ].map(([question, answer]) => (
            <details className="table-view" key={question}>
              <summary style={{ fontSize: "inherit" }}>{question}</summary>
              <p className="small ink-2" style={{ marginTop: 8, maxWidth: "70ch" }}>{answer}</p>
            </details>
          ))}
        </section>
      </main>
    </>
  );
}
