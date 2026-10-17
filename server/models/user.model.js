import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    // Plan state; see utils/plan.js. The ML job reads these two fields too.
    trialEndsAt: { type: Date, default: null },
    proUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
