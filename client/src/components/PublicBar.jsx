import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

// Top bar for pages people see before (or without) logging in.
export default function PublicBar({ children }) {
  const user = useSelector((state) => state.auth.user);
  return (
    <header className="public-bar">
      <div className="public-bar-inner">
        <Link to="/" className="wordmark"><Logo />Footfall</Link>
        {children ?? (
          <>
            <Link to="/pricing" className="btn ghost">Pricing</Link>
            {user ? (
              <Link to="/sites" className="btn primary">Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn ghost">Log in</Link>
                <Link to="/register" className="btn primary">Start free</Link>
              </>
            )}
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
