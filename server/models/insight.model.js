import mongoose from "mongoose";

// Written once a day by the ML job (ml/footfall_ml/insights.py): conversion drivers per funnel
// ("funnel_drivers", key = funnel id) and the ranked opportunities feed ("opportunities", key = "site").
const insightSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    kind: { type: String, required: true },
    key: { type: String, required: true },
    computedAt: Date,
  },
  { strict: false, versionKey: false }
);

insightSchema.index({ site: 1, kind: 1, key: 1 }, { unique: true });

export default mongoose.model("Insight", insightSchema);
