import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

const DAY = 24 * 60 * 60 * 1000;
const fmt = (date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(date));

// Where the account stands, always one glance away in the sidebar.
export default function PlanCard() {
  const plan = useSelector((state) => state.auth.user?.plan);
  if (!plan) return null;

  if (plan.tier === "pro") {
    return (
      <div className="plan-card">
        <div className="row spread"><strong>Footfall Pro</strong><span className="badge pro">Pro</span></div>
        <span>Active until {fmt(plan.until)}</span>
        <Link to="/billing" className="btn small">Billing</Link>
      </div>
    );
  }

  if (plan.tier === "trial") {
    const left = Math.max(0, Math.ceil((new Date(plan.until) - Date.now()) / DAY));
    return (
      <div className="plan-card">
        <div className="row spread"><strong>Pro trial</strong><span>{left} {left === 1 ? "day" : "days"} left</span></div>
        <div className="meter" role="img" aria-label={`${left} of 14 trial days left`}><div style={{ width: `${(left / 14) * 100}%` }} /></div>
        <Link to="/billing" className="btn accent small">Upgrade to Pro</Link>
      </div>
    );
  }

  return (
    <div className="plan-card">
      <strong>Free plan</strong>
      <span>Forecasts, alerts and insights come with Pro.</span>
      <Link to="/billing" className="btn accent small">Upgrade to Pro</Link>
    </div>
  );
}
