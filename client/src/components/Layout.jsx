import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import Icon from "./Icon";
import AlertsBell from "./AlertsBell";
import SiteSwitcher from "./SiteSwitcher";
import PlanCard from "./PlanCard";
import ThemeToggle from "./ThemeToggle";
import { usePopover } from "./usePopover";
import { logout } from "../store/authSlice";
import { fetchAlerts } from "../store/alertsSlice";
import { fetchSites } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";
import { socket } from "../services/socket";

const initials = (name = "") => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

function Account() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((state) => state.auth.user);
  const { open, setOpen, ref } = usePopover();

  const signOut = async () => {
    await dispatch(logout());
    navigate("/");
  };

  return (
    <div className="switcher" ref={ref}>
      <button type="button" className="switcher-button" style={{ border: 0, background: "transparent" }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">{initials(user?.name)}</span>
        <span className="names">
          <span>{user?.name}</span>
          <span>{user?.email}</span>
        </span>
        <Icon name="chevrons" size={14} />
      </button>
      {open && (
        <div className="popover up" role="menu">
          <Link to="/billing" className="menu-item" onClick={() => setOpen(false)}><Icon name="card" />Plan and billing</Link>
          <Link to="/pricing" className="menu-item" onClick={() => setOpen(false)}><Icon name="spark" />Pricing</Link>
          <div className="menu-sep" />
          <button type="button" className="menu-item" onClick={signOut}><Icon name="logout" />Log out</button>
        </div>
      )}
    </div>
  );
}

function SiteNav({ siteId }) {
  const site = useSelector((state) => state.sites.list.find((s) => s._id === siteId));
  const locked = site?.plan === "free";
  return (
    <nav className="nav" aria-label="Site">
      <NavLink end to={`/sites/${siteId}`}><Icon name="overview" />Overview</NavLink>
      <NavLink to={`/sites/${siteId}/funnels`}><Icon name="funnel" />Funnels</NavLink>
      <NavLink to={`/sites/${siteId}/insights`}>
        <Icon name="spark" />Intelligence
        {locked && <span className="badge pro">Pro</span>}
      </NavLink>
      <NavLink to={`/sites/${siteId}/settings`}><Icon name="settings" />Settings</NavLink>
    </nav>
  );
}

export default function Layout() {
  const dispatch = useDispatch();
  const location = useLocation();
  const siteMatch = useMatch("/sites/:siteId/*");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchSites());
    dispatch(fetchAlerts());
    const onAlert = ({ message }) => {
      dispatch(addToast(message, "error"));
      dispatch(fetchAlerts());
    };
    socket.on("alert", onAlert);
    return () => socket.off("alert", onAlert);
  }, [dispatch]);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className={`shell${open ? " open" : ""}`}>
      <header className="mobile-bar">
        <button type="button" className="btn ghost small" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
        <Link to="/sites" className="wordmark"><Logo />Footfall</Link>
      </header>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-top">
          <Link to="/sites" className="wordmark"><Logo />Footfall</Link>
          <ThemeToggle />
        </div>
        <SiteSwitcher />
        {siteMatch && siteMatch.params.siteId !== undefined && (
          <>
            <span className="nav-label">Site</span>
            <SiteNav siteId={siteMatch.params.siteId} />
          </>
        )}
        <span className="nav-label">Workspace</span>
        <nav className="nav" aria-label="Workspace">
          <NavLink end to="/sites"><Icon name="sites" />All sites</NavLink>
          <NavLink to="/billing"><Icon name="card" />Plan and billing</NavLink>
        </nav>
        <AlertsBell />
        <div className="sidebar-bottom">
          <PlanCard />
          <Account />
        </div>
      </aside>

      <Outlet />
    </div>
  );
}
