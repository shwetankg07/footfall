import mongoose from "mongoose";

// One document per page view or custom event. The ML job reads this
// collection directly, so field names are a contract: see ml/README.md.
const eventSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    ts: { type: Date, required: true },
    name: { type: String, required: true },
    path: { type: String, required: true },
    referrer: { type: String, default: null },
    utmSource: { type: String, default: null },
    device: { type: String, enum: ["desktop", "mobile", "tablet"], required: true },
    browser: { type: String, default: "Unknown" },
    os: { type: String, default: "Unknown" },
    country: { type: String, default: null },
    visitor: { type: String, required: true },
  },
  { versionKey: false }
);

eventSchema.index({ site: 1, ts: 1 });

export default mongoose.model("Event", eventSchema);
