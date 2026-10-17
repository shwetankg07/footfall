import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    interval: { type: String, enum: ["month", "year"], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    status: { type: String, enum: ["created", "paid"], default: "created" },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);
