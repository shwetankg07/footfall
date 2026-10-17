import { useState } from "react";
import Icon from "./Icon";
import { THEMES, getTheme, setTheme } from "../utils/theme";

const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
const ICON = { system: "monitor", light: "sun", dark: "moon" };

export default function ThemeToggle() {
  const [theme, setState] = useState(getTheme);
  const next = () => {
    const value = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(value);
    setState(value);
  };
  return (
    <button type="button" className="btn ghost small" onClick={next} aria-label={`${LABEL[theme]}. Switch theme`} title={LABEL[theme]}>
      <Icon name={ICON[theme]} />
    </button>
  );
}
