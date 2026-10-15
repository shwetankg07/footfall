import mongoose from "mongoose";

const inviteSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ["admin", "viewer"], required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  },
  { timestamps: true }
);

// One open invite per person per site; answered invites stay as history.
inviteSchema.index({ site: 1, email: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
inviteSchema.index({ email: 1, status: 1 });

export default mongoose.model("Invite", inviteSchema);
