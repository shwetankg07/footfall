export const filled = (...values) =>
  values.every((value) => typeof value === "string" && value.trim() !== "");

export const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
