import crypto from "node:crypto";
import Razorpay from "razorpay";
import Payment from "../models/payment.model.js";
import User from "../models/user.model.js";
import { planOf, PRICES, FREE_LIMITS, TRIAL_DAYS } from "../utils/plan.js";

// Billing is optional: without keys the app runs, and checkout says payments aren't set up.
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

export const getBilling = async (req, res) => {
  const payments = await Payment.find({ user: req.user._id, status: "paid" }).sort({ paidAt: -1 }).limit(20)
    .select("interval amount currency paidAt razorpayPaymentId");
  res.json({
    plan: planOf(req.user),
    prices: PRICES,
    freeLimits: FREE_LIMITS,
    trialDays: TRIAL_DAYS,
    paymentsEnabled: Boolean(razorpay),
    payments,
  });
};

export const createCheckout = async (req, res) => {
  const price = PRICES[req.body?.interval];
  if (!price) return res.status(400).json({ message: "Pick monthly or yearly" });
  if (!razorpay) return res.status(503).json({ message: "Payments aren't set up on this server yet." });

  let order;
  try {
    order = await razorpay.orders.create({
      amount: price.amount,
      currency: "INR",
      receipt: `ff_${Date.now()}`,
      notes: { user: String(req.user._id), interval: req.body.interval },
    });
  } catch (error) {
    console.error("Razorpay order failed:", error);
    return res.status(502).json({ message: "Couldn't start the payment. Try again in a minute." });
  }

  await Payment.create({ user: req.user._id, interval: req.body.interval, amount: price.amount, razorpayOrderId: order.id });
  res.status(201).json({
    orderId: order.id,
    amount: price.amount,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
    label: price.label,
    name: req.user.name,
    email: req.user.email,
  });
};

const signatureOk = (orderId, paymentId, signature) => {
  const expected = Buffer.from(crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex"));
  const given = Buffer.from(String(signature ?? ""));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

// The browser sends Razorpay's signed result; a valid signature proves the payment went through.
// ponytail: no webhook, so a payment whose tab closes before this call needs a manual check; add payment.captured if that happens.
export const verifyCheckout = async (req, res) => {
  const { orderId, paymentId, signature } = req.body ?? {};
  if (typeof orderId !== "string" || typeof paymentId !== "string" || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(400).json({ message: "Payment details are missing" });
  }

  const payment = await Payment.findOne({ razorpayOrderId: orderId, user: req.user._id });
  if (!payment) return res.status(404).json({ message: "Payment not found" });
  if (payment.status === "paid") return res.json({ message: "Payment already applied", plan: planOf(req.user) });

  if (!signatureOk(orderId, paymentId, signature)) {
    return res.status(400).json({ message: "The payment couldn't be verified. You weren't charged for Pro; try again." });
  }

  // Flip the payment once; a repeated call can't extend the plan twice.
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: "created" },
    { status: "paid", razorpayPaymentId: paymentId, paidAt: new Date() }
  );
  if (!claimed) return res.json({ message: "Payment already applied", plan: planOf(req.user) });

  // Extends from today, or from the end of the current Pro period if there's time left.
  const days = PRICES[payment.interval].days;
  const user = await User.findOneAndUpdate(
    { _id: req.user._id },
    [{ $set: { proUntil: { $dateAdd: { startDate: { $max: ["$$NOW", { $ifNull: ["$proUntil", "$$NOW"] }] }, unit: "day", amount: days } } } }],
    { returnDocument: "after", updatePipeline: true }
  );
  res.json({ message: "You're on Footfall Pro", plan: planOf(user) });
};
