import mongoose from "mongoose";

// Written by the hourly ML job (ml/footfall_ml/score.py); the API only reads it.
const forecastSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    hour: { type: Date, required: true },
    metric: { type: String, default: "pageviews" },
    expected: Number,
    lo: Number,
    hi: Number,
    model: String,
    updatedAt: Date,
  },
  { versionKey: false }
);

forecastSchema.index({ site: 1, hour: 1, metric: 1 }, { unique: true });

export default mongoose.model("Forecast", forecastSchema);
