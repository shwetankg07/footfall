const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export { escapeHtml };

// Resend's REST API; without a key, alerts still reach people in the dashboard.
export const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.RESEND_API_KEY || to.length === 0) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL || "Footfall <onboarding@resend.dev>", to, subject, html }),
    });
    if (!res.ok) console.error("Alert email failed:", res.status, await res.text());
    return res.ok;
  } catch (error) {
    console.error("Alert email failed:", error.message);
    return false;
  }
};
