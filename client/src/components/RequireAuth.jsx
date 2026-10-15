import { useSelector } from "react-redux";
import { Navigate, useLocation } from "react-router-dom";

export default function RequireAuth({ children }) {
  const { user, status } = useSelector((state) => state.auth);
  const location = useLocation();

  if (status === "loading") return <div className="empty">Loading…</div>;
  if (status === "offline") {
    return <div className="empty">Can't reach the Footfall server. It may be waking up; refresh in a minute.</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
