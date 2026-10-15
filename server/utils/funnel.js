// A step matches a page view by path ("/product/*" = any path under /product/) or a custom event by name.
export const stepMatches = (step, event) => {
  if (step.kind === "event") return event.name === step.value;
  if (event.name !== "pageview") return false;
  if (step.value.endsWith("*")) return event.path.startsWith(step.value.slice(0, -1));
  return event.path === step.value;
};

// events: one visitor's events sorted by time. Returns how many steps they completed, in order.
export const stepsReached = (steps, events) => {
  let reached = 0;
  for (const event of events) {
    if (reached < steps.length && stepMatches(steps[reached], event)) reached += 1;
  }
  return reached;
};

// visitors: arrays of sorted events, one per visitor. Returns per-step counts and drop-off.
export const funnelResult = (steps, visitors) => {
  const counts = new Array(steps.length).fill(0);
  for (const events of visitors) {
    const reached = stepsReached(steps, events);
    for (let i = 0; i < reached; i += 1) counts[i] += 1;
  }

  return steps.map((step, i) => ({
    kind: step.kind,
    value: step.value,
    visitors: counts[i],
    // Share of the previous step that carried on; the first step is the baseline.
    kept: i === 0 ? null : counts[i - 1] ? Math.round((counts[i] / counts[i - 1]) * 100) : 0,
    ofStart: counts[0] ? Math.round((counts[i] / counts[0]) * 100) : 0,
  }));
};
