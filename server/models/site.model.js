import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "viewer"], required: true },
  },
  { _id: false }
);

const siteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    domain: { type: String, required: true, unique: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [memberSchema],
    timezone: { type: String, default: "Asia/Kolkata" },
    shareToken: { type: String, default: null },
    firstEventAt: { type: Date, default: null },
  },
  { timestamps: true }
);

siteSchema.index({ "members.user": 1 });
siteSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: "string" } } });

export default mongoose.model("Site", siteSchema);
