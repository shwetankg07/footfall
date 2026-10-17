const KEY = "footfall-theme";
export const THEMES = ["system", "light", "dark"];

export const getTheme = () => {
  try {
    return localStorage.getItem(KEY) ?? "system";
  } catch {
    return "system";
  }
};

export const setTheme = (theme) => {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private windows can refuse storage; the theme still applies for this visit.
  }
};
