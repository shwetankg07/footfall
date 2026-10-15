import mongoose from "mongoose";

// One random salt per UTC day. Mongo deletes it two days later, after which
// that day's visitor hashes can no longer be linked to anyone.
const saltSchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  salt: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 48 },
});

export default mongoose.model("Salt", saltSchema);
