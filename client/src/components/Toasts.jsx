import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { removeToast } from "../store/toastSlice";

function Toast({ toast }) {
  const dispatch = useDispatch();
  useEffect(() => {
    const timer = setTimeout(() => dispatch(removeToast(toast.id)), toast.tone === "error" ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [dispatch, toast]);

  return (
    <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => dispatch(removeToast(toast.id))}>✕</button>
    </div>
  );
}

export default function Toasts() {
  const toasts = useSelector((state) => state.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} />)}
    </div>
  );
}
