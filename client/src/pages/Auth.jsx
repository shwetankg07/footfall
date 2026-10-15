import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, register } from "../store/authSlice";
import Logo from "../components/Logo";

export default function Auth({ mode }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector((state) => state.auth.user);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";
  const next = location.state?.from ?? "/sites";

  if (user) return <Navigate to={next} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const action = isLogin ? login({ email: form.email, password: form.password }) : register(form);
    const result = await dispatch(action);
    setBusy(false);
    if (result.error) setError(result.payload ?? result.error.message);
    else navigate(next, { replace: true });
  };

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <Link to="/" className="wordmark"><Logo />Footfall</Link>
        <div className="stack" style={{ gap: 4 }}>
          <h1>{isLogin ? "Log in" : "Create your account"}</h1>
          <p className="ink-2">{isLogin ? "Welcome back." : "Free, and it takes a minute. Then add your first site."}</p>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!isLogin && (
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" autoComplete="name" value={form.name} onChange={set("name")} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} value={form.password} onChange={set("password")} required minLength={8} />
          {!isLogin && <span className="hint">At least 8 characters.</span>}
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Please wait…" : isLogin ? "Log in" : "Create account"}</button>
        <p className="small ink-2">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link to={isLogin ? "/register" : "/login"} state={location.state}>{isLogin ? "Create an account" : "Log in"}</Link>
        </p>
      </form>
    </main>
  );
}
