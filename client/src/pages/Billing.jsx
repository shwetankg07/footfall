import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { fetchMe } from "../store/authSlice";
import { fetchSites } from "../store/sitesSlice";
import { addToast } from "../store/toastSlice";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let checkoutScript;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScript) return checkoutScript;
  checkoutScript = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CHECKOUT_URL}"]`);
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
    };
    const failed = () => {
      cleanup();
      script.remove();
      reject(new Error("Couldn't load Razorpay checkout. Check your connection or allow checkout.razorpay.com, then try again."));
    };
    const loaded = () => {
      if (!window.Razorpay) return failed();
      cleanup();
      resolve();
    };
    const timeout = setTimeout(failed, 20000);
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    if (!existing) {
      script.src = CHECKOUT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    checkoutScript = null;
    throw error;
  });
  return checkoutScript;
}

function planTitle(plan) {
  if (plan.tier === "trial") {
    const days = Math.max(0, Math.ceil((new Date(plan.until).getTime() - Date.now()) / 86400000));
    return `You're on the Pro trial, ${days} ${days === 1 ? "day" : "days"} left`;
  }
  if (plan.tier === "pro") return `Footfall Pro${plan.until ? `, active until ${date.format(new Date(plan.until))}` : ""}`;
  return "Free plan";
}

export default function Billing() {
  const dispatch = useDispatch();
  const billing = useApi("/api/billing");
  const [interval, setInterval] = useState("month");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pendingPayment, setPendingPayment] = useState(null);
  const mounted = useRef(false);
  const paying = useRef(false);
  const verifying = useRef(false);
  const checkout = useRef(null);
  const data = billing.data;
  const price = data?.prices[interval];
  const isPro = data?.plan.tier === "pro";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      checkout.current?.close();
    };
  }, []);

  const reset = () => {
    paying.current = false;
    if (mounted.current) setBusy("");
  };

  const verifyPayment = async (payment) => {
    if (verifying.current) return;
    verifying.current = true;
    paying.current = true;
    if (mounted.current) {
      setBusy("Verifying payment…");
      setError("");
      setPendingPayment(payment);
    }
    try {
      const response = await api.post("/api/billing/verify", payment);
      if (mounted.current) {
        setPendingPayment(null);
        setBusy("Updating your plan…");
        billing.reload();
      }
      dispatch(addToast(response.message));
      const [userResult, sitesResult] = await Promise.all([dispatch(fetchMe()), dispatch(fetchSites())]);
      if (fetchMe.rejected.match(userResult) || fetchSites.rejected.match(sitesResult)) {
        dispatch(addToast("Payment verified, but your account couldn't refresh. Reload the page to see your updated plan.", "error"));
      }
    } catch (err) {
      const message = `Couldn't verify this payment. ${err.message} Retry verification to apply it to your plan.`;
      if (mounted.current) setError(message);
      dispatch(addToast(message, "error"));
    } finally {
      verifying.current = false;
      reset();
    }
  };

  const pay = async () => {
    if (paying.current || pendingPayment || !data?.paymentsEnabled || billing.loading || billing.error) return;
    paying.current = true;
    setBusy("Loading checkout…");
    setError("");
    try {
      await loadCheckout();
      if (!mounted.current) return reset();
      const order = await api.post("/api/billing/checkout", { interval });
      if (!mounted.current) return reset();
      const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2a78d6";
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Footfall",
        description: order.label,
        prefill: { name: order.name, email: order.email },
        theme: { color },
        handler: (response) => verifyPayment({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
        modal: { ondismiss: () => { if (!verifying.current) reset(); } },
      });
      rzp.on("payment.failed", (response) => {
        const reason = response.error?.description || response.error?.reason || "Razorpay couldn't complete the payment.";
        const message = `Payment failed. ${reason} Try again in checkout or close it to choose another period.`;
        if (mounted.current) setError(message);
        dispatch(addToast(message, "error"));
      });
      checkout.current = rzp;
      setBusy("Checkout is open…");
      rzp.open();
    } catch (err) {
      const message = `${err.message} ${err.status === 503 ? "Try again when payments are available." : "Please try again."}`;
      if (mounted.current) {
        setError(message);
        if (err.status === 503) billing.reload();
      }
      dispatch(addToast(message, "error"));
      reset();
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <div className="title">
          <h1>Plan and billing</h1>
          <span>Your plan, Pro payments and receipts.</span>
        </div>
        <Link to="/pricing" className="btn ghost small">Compare plans</Link>
      </header>

      {billing.error && (
        <div className="notice" role="alert">
          <p>Couldn't load billing. {billing.error.message}</p>
          <div className="row"><button type="button" className="btn small" disabled={billing.loading} onClick={billing.reload}>{billing.loading ? "Loading…" : "Retry loading billing"}</button></div>
        </div>
      )}
      {!data && billing.loading && (
        <section className="card" aria-busy="true" aria-label="Loading billing">
          <p className="muted small" role="status">Loading your plan and payments…</p>
          <div className="skeleton" style={{ height: 28, width: "70%" }} />
          <div className="skeleton" style={{ height: 120 }} />
        </section>
      )}
      {data && <>
        <section className="card" aria-labelledby="current-plan-title">
          <div className="card-head">
            <h2 id="current-plan-title">{planTitle(data.plan)}</h2>
            <span className={`badge${data.plan.tier === "free" ? "" : " pro"}`}>{data.plan.tier === "trial" ? "Pro trial" : data.plan.tier === "pro" ? "Pro" : "Free"}</span>
          </div>
          <p className="ink-2 small">{data.plan.tier === "free"
            ? `Analytics for ${data.freeLimits.sites} sites, the last ${data.freeLimits.historyDays} days of history, live visitors, traffic breakdowns and funnels. Team invites and public links are included.`
            : "Unlimited sites, full history and Footfall Intelligence: hourly forecasts, spike and drop alerts with root cause, conversion drivers, weekly opportunities and email alerts."}</p>
          {data.plan.tier === "trial" && <p className="muted small">After your {data.trialDays}-day trial, you'll move to Free unless you pay for Pro. Nothing is deleted; Intelligence pauses.</p>}
        </section>

        <section className="card" aria-labelledby="pro-payment-title" aria-busy={Boolean(busy)}>
          <div className="card-head">
            <h2 id="pro-payment-title">{isPro ? "Extend Pro" : "Get Footfall Pro"}</h2>
            {billing.loading && <span className="muted small" role="status">Updating billing…</span>}
          </div>
          <div className="row">
            <div className="segmented" role="group" aria-label="Pro payment period">
              <button type="button" aria-pressed={interval === "month"} disabled={Boolean(busy) || Boolean(pendingPayment)} onClick={() => setInterval("month")}>Monthly</button>
              <button type="button" aria-pressed={interval === "year"} disabled={Boolean(busy) || Boolean(pendingPayment)} onClick={() => setInterval("year")}>Yearly <span className="muted">· 2 months free</span></button>
            </div>
          </div>
          <p className="num" style={{ fontSize: "1.5rem", fontWeight: 600 }} aria-live="polite">
            {rupees.format(price.amount / 100)} <span className="muted small" style={{ fontWeight: 400 }}>for {price.days} days of Pro</span>
          </p>
          <p className="ink-2 small">{isPro
            ? "Time stacks on your current Pro end date. Pay again whenever you want to extend it."
            : "One payment buys this period of Pro. Pay again whenever you want to extend it."} No auto-renewal.</p>
          {!data.paymentsEnabled && <div className="notice"><p>Payments aren't switched on for this server yet. You can pay for Pro here once they're available.</p></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="row">
            {pendingPayment ? (
              <button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => verifyPayment(pendingPayment)}>{busy || "Retry payment verification"}</button>
            ) : (
              <button type="button" className="btn primary" disabled={Boolean(busy) || !data.paymentsEnabled || billing.loading || Boolean(billing.error)} onClick={pay}>
                <Icon name="card" />{busy || (isPro ? `Add 1 ${interval === "year" ? "year" : "month"}` : `Pay ${rupees.format(price.amount / 100)} with Razorpay`)}
              </button>
            )}
          </div>
          {busy && <p className="muted small" role="status">{busy}</p>}
          <p className="muted small">Test mode: use card <span className="num">4100 2800 0000 1007</span>, any future date, any CVV, or Netbanking and choose Success.</p>
        </section>

        <section className="card" aria-labelledby="payment-history-title">
          <div className="card-head"><h2 id="payment-history-title">Payment history</h2></div>
          {data.payments.length === 0 ? <p className="muted small">No payments yet. Your Pro payments will appear here.</p> : (
            <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Payment history">
              <table className="data">
                <thead><tr><th scope="col">Date</th><th scope="col">Plan</th><th scope="col" className="num">Amount</th><th scope="col">Razorpay payment id</th></tr></thead>
                <tbody>{data.payments.map((payment) => (
                  <tr key={payment._id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}><time dateTime={payment.paidAt}>{date.format(new Date(payment.paidAt))}</time></td>
                    <td>Pro · {payment.interval === "year" ? "Yearly" : "Monthly"}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{rupees.format(payment.amount / 100)}</td>
                    <td className="mono" style={{ overflowWrap: "anywhere" }}>{payment.razorpayPaymentId}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </main>
  );
}
