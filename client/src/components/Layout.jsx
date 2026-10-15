import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Outlet, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import AlertsBell from "./AlertsBell";
import { logout } from "../store/authSlice";
import { fetchAlerts } from "../store/alertsSlice";
import { fetchSites } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";
import { socket } from "../services/socket";

export default function Layout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((state) => state.auth.user);

  useEffect(() => {
    dispatch(fetchSites());
    dispatch(fetchAlerts());

    const onAlert = ({ message }) => {
      dispatch(addToast(message, "error"));
      dispatch(fetchAlerts());
    };
    socket.on("alert", onAlert);
    return () => {
      socket.off("alert", onAlert);
    };
  }, [dispatch]);

  const signOut = async () => {
    await dispatch(logout());
    navigate("/");
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/sites" className="wordmark"><Logo />Footfall</Link>
          <nav aria-label="Account">
            <Link to="/sites" className="btn ghost">Sites</Link>
            <AlertsBell />
            <button type="button" className="btn ghost" onClick={signOut} title={user?.email}>Log out</button>
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  );
}
