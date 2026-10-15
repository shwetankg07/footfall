import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { markAlertRead, markAllAlertsRead } from "../store/alertsSlice";
import { timeAgo } from "../utils/format";

export default function AlertsBell() {
  const dispatch = useDispatch();
  const { items, unread } = useSelector((state) => state.alerts);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !ref.current.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="btn ghost" aria-expanded={open} aria-label={`Alerts, ${unread} unread`} onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        Alerts
      </button>
      {unread > 0 && <span className="bell-count" aria-hidden="true">{unread}</span>}
      {open && (
        <div className="popover" role="dialog" aria-label="Alerts">
          <div className="row spread" style={{ padding: "4px 6px" }}>
            <h3>Alerts</h3>
            {unread > 0 && <button type="button" className="btn ghost small" onClick={() => dispatch(markAllAlertsRead())}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="muted small" style={{ padding: "8px 6px" }}>No alerts yet. Footfall tells you here when traffic looks unusual.</p>}
          {items.slice(0, 8).map((alert) => (
            <Link
              key={alert._id}
              to={`/sites/${alert.site._id}/insights`}
              className={`alert-item${alert.read ? "" : " unread"}`}
              style={{ textDecoration: "none", color: "inherit" }}
              onClick={() => {
                if (!alert.read) dispatch(markAlertRead(alert._id));
                setOpen(false);
              }}
            >
              <span className={`alert-icon ${alert.kind}`} aria-hidden="true">{alert.kind === "spike" ? "↑" : "↓"}</span>
              <span className="small">{alert.message}</span>
              <span className="muted small">{timeAgo(alert.hour)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
