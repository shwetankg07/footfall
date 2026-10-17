const countries = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

// "referrer: null" -> "direct visits", "country: IN" -> "India", "device: mobile" -> "Mobile".
export const segmentName = (dimension, value) => {
  if (dimension === "referrer") return value ?? "direct visits";
  if (dimension === "country") {
    if (!value) return "unknown countries";
    try {
      return countries?.of(value) ?? value;
    } catch {
      return value;
    }
  }
  if (dimension === "device") return value ? value[0].toUpperCase() + value.slice(1) : "unknown devices";
  return value ?? "unknown";
};

export const DIMENSION_LABEL = { referrer: "Source", path: "Page", device: "Device", country: "Country", browser: "Browser" };
