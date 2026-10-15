import mongoose from "mongoose";

// Written by the hourly ML job. The API notifies people (notifiedAt) and tracks who has read each one.
const alertSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    hour: { type: Date, required: true },
    metric: { type: String, default: "pageviews" },
    kind: { type: String, enum: ["spike", "drop"], required: true },
    actual: Number,
    expected: Number,
    lo: Number,
    hi: Number,
    score: Number,
    model: String,
    createdAt: { type: Date, default: Date.now },
    notifiedAt: { type: Date, default: null },
    emailedAt: { type: Date, default: null },
    emailAttempts: { type: Number, default: 0 },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { versionKey: false }
);

alertSchema.index({ site: 1, hour: 1, metric: 1 }, { unique: true });
alertSchema.index({ notifiedAt: 1 });

export default mongoose.model("Alert", alertSchema);
