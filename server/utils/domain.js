// "https://www.Example.com:443/pricing" -> "example.com". Returns null for anything that isn't a hostname.
export const normalizeDomain = (input) => {
  if (typeof input !== "string") return null;
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .split(":")[0]
    .replace(/^www\./, "");
  return /^(localhost|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})$/.test(host) ? host : null;
};

export const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
