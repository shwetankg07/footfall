import { useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { fetchSites } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";

function InviteLink({ token }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const base = `/api/invites/${encodeURIComponent(token)}`;
  const { data, error, loading } = useApi(base);
  const [busy, setBusy] = useState(null);
  const [answerError, setAnswerError] = useState(null);
  const invite = data?.invite;
  const failure = error ?? answerError;

  const answer = async (choice) => {
    if (busy !== null) return;
    setBusy(choice);
    setAnswerError(null);
    try {
      const result = await api.post(`${base}/${choice}`);
      dispatch(addToast(result.message));
      if (choice === "accept") {
        dispatch(fetchSites());
        navigate(`/sites/${result.site._id}`);
      } else {
        navigate("/sites");
      }
    } catch (err) {
      setAnswerError(err);
      dispatch(addToast(err.message, "error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page">
      <h1>Invite link</h1>
      {loading ? (
        <div className="empty" role="status">Loading invite…</div>
      ) : failure && (!invite || failure.status === 404) ? (
        <section className="card stack">
          <p className="form-error" role="alert">{failure.message}</p>
          <div className="row"><Link className="btn" to="/sites">Back to sites</Link></div>
        </section>
      ) : invite ? (
        <section className="card stack">
          <p>
            <strong>{invite.invitedBy.name}</strong> invited you to <strong>{invite.site.name}</strong>{" "}
            <span className="ink-2">({invite.site.domain})</span> as <span className="badge">{invite.role}</span>
          </p>
          <p className="muted">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
          {failure && <p className="form-error" role="alert">{failure.message}</p>}
          {invite.alreadyMember ? (
            <>
              <p className="ink-2">You already have access to this site.</p>
              <div className="row"><Link className="btn primary" to={`/sites/${invite.site._id}`}>Open site</Link></div>
            </>
          ) : (
            <div className="row">
              <button type="button" className="btn primary" disabled={busy !== null} onClick={() => answer("accept")}>{busy === "accept" ? "Joining…" : "Accept"}</button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => answer("decline")}>{busy === "decline" ? "Declining…" : "Decline"}</button>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

export default function Invite() {
  const { token } = useParams();
  return <InviteLink key={token} token={token} />;
}
