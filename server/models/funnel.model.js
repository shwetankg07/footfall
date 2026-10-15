import mongoose from "mongoose";

const stepSchema = new mongoose.Schema(
  {
    // "page" matches page views by path ("/product/*" matches any product); "event" matches a custom event name.
    kind: { type: String, enum: ["page", "event"], required: true },
    value: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const funnelSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    name: { type: String, required: true, trim: true },
    steps: { type: [stepSchema], required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Funnel", funnelSchema);
