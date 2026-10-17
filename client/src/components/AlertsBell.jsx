import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { markAlertRead, markAllAlertsRead } from "../store/alertsSlice";
import { timeAgo } from "../utils/format";
import { usePopover } from "./usePopover";
import Icon from "./Icon";

export default function AlertsBell() {
  const dispatch = useDispatch();
  const { items, unread } = useSelector((state) => state.alerts);
  const { open, setOpen, ref } = usePopover();

  return (
    <div className="switcher" ref={ref}>
      <div className="nav">
        <button type="button" className="nav-item" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Icon name="bell" />
          Alerts
          {unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
        </button>
      </div>
      {open && (
        <div className="popover up" role="dialog" aria-label="Alerts" style={{ width: "min(360px, calc(100vw - 24px))", right: "auto" }}>
          <div className="row spread" style={{ padding: "6px 8px" }}>
            <h3>Alerts</h3>
            {unread > 0 && <button type="button" className="btn ghost small" onClick={() => dispatch(markAllAlertsRead())}>Mark all read</button>}
          </div>
          {items.length === 0 && <p className="muted small" style={{ padding: "4px 8px 10px" }}>No alerts yet. Footfall tells you here when traffic looks unusual.</p>}
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
