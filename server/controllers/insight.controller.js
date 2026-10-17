import Insight from "../models/insight.model.js";

const strip = ({ _id, site, ...rest }) => rest;

// Everything the Intelligence page needs that the ML job computes daily.
export const getInsights = async (req, res) => {
  const docs = await Insight.find({ site: req.site._id }).lean();
  const opportunities = docs.find((doc) => doc.kind === "opportunities");
  res.json({
    opportunities: opportunities ? strip(opportunities) : null,
    funnelDrivers: docs.filter((doc) => doc.kind === "funnel_drivers").map(strip),
  });
};

export const getFunnelDrivers = async (req, res) => {
  const doc = await Insight.findOne({ site: req.site._id, kind: "funnel_drivers", key: String(req.params.funnelId) }).lean();
  res.json({ drivers: doc ? strip(doc) : null });
};
