import Funnel from "../models/funnel.model.js";
import Event from "../models/event.model.js";
import { filled } from "../utils/validate.js";
import { parseRange } from "../utils/range.js";
import { funnelResult } from "../utils/funnel.js";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cleanSteps = (steps) => {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) {
    return { error: "A funnel needs 2 to 6 steps" };
  }

  const clean = [];
  for (const step of steps) {
    if (!["page", "event"].includes(step?.kind) || !filled(step?.value) || step.value.length > 200) {
      return { error: "Each step needs a type (page or event) and a value" };
    }
    const value = step.value.trim();
    if (step.kind === "page" && !value.startsWith("/")) {
      return { error: `Page steps are paths starting with "/", like /pricing` };
    }
    clean.push({ kind: step.kind, value });
  }
  return { steps: clean };
};

// Only the events that could match a step leave the database.
const stepFilter = (step) => {
  if (step.kind === "event") return { name: step.value };
  if (step.value.endsWith("*")) return { name: "pageview", path: { $regex: `^${escapeRegex(step.value.slice(0, -1))}` } };
  return { name: "pageview", path: step.value };
};

export const listFunnels = async (req, res) => {
  const funnels = await Funnel.find({ site: req.site._id }).sort({ createdAt: 1 });
  res.json({ funnels });
};

export const createFunnel = async (req, res) => {
  const { name, steps } = req.body ?? {};

  if (!filled(name)) {
    return res.status(400).json({ message: "Give the funnel a name" });
  }

  const checked = cleanSteps(steps);
  if (checked.error) return res.status(400).json({ message: checked.error });

  const funnel = await Funnel.create({ site: req.site._id, name: name.trim().slice(0, 80), steps: checked.steps });
  res.status(201).json({ funnel });
};

export const deleteFunnel = async (req, res) => {
  const deleted = await Funnel.findOneAndDelete({ _id: req.params.funnelId, site: req.site._id });
  if (!deleted) return res.status(404).json({ message: "Funnel not found" });
  res.json({ message: "Funnel deleted" });
};

export const getFunnelResult = async (req, res) => {
  const funnel = await Funnel.findOne({ _id: req.params.funnelId, site: req.site._id }).lean();
  if (!funnel) return res.status(404).json({ message: "Funnel not found" });

  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ message: range.error });

  // ponytail: ordering is checked in Node per visitor; fine for thousands of visitors a range,
  // move the walk into $setWindowFields if a site ever has millions.
  const visitors = await Event.aggregate([
    { $match: { site: req.site._id, ts: { $gte: range.from, $lt: range.to }, $or: funnel.steps.map(stepFilter) } },
    { $sort: { ts: 1, _id: 1 } },
    { $group: { _id: "$visitor", events: { $push: { name: "$name", path: "$path" } } } },
  ]).allowDiskUse(true);

  res.json({
    funnel: { _id: funnel._id, name: funnel.name },
    range,
    steps: funnelResult(funnel.steps, visitors.map((visitor) => visitor.events)),
  });
};
