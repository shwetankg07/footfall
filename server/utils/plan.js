// Free: the dashboard for up to 3 sites and the last 30 days. Pro (or the 14-day trial on sign-up):
// Intelligence (forecasts, alerts with root cause, conversion drivers, opportunities), unlimited sites and history.
export const TRIAL_DAYS = 14;
export const FREE_LIMITS = { sites: 3, historyDays: 30 };

// Prices in paise. Each payment buys a fixed period; there is no auto-renewal to cancel.
export const PRICES = {
  month: { amount: 49900, days: 30, label: "Pro, 1 month" },
  year: { amount: 499000, days: 365, label: "Pro, 1 year" },
};

export const planOf = (user, now = new Date()) => {
  if (user?.proUntil && user.proUntil > now) return { tier: "pro", until: user.proUntil };
  if (user?.trialEndsAt && user.trialEndsAt > now) return { tier: "trial", until: user.trialEndsAt };
  return { tier: "free", until: null };
};

export const hasIntelligence = (plan) => plan.tier !== "free";

// Free sites can look back 30 days (a few minutes of slack for clocks and rounding).
export const historyError = (plan, from) => {
  if (hasIntelligence(plan)) return null;
  const limit = Date.now() - FREE_LIMITS.historyDays * 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
  return from.getTime() < limit ? `The free plan shows the last ${FREE_LIMITS.historyDays} days. Upgrade to Pro for your full history.` : null;
};
