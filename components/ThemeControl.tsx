import React, { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../lib/theme";

const OPTIONS: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "Automatic", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

/** Appearance picker: Automatic follows the device, or pin Light / Midnight. */
export function ThemeControl() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    const sync = () => setPreference(readThemePreference());
    window.addEventListener("hyperflow:theme", sync);
    return () => window.removeEventListener("hyperflow:theme", sync);
  }, []);
  return (
    <fieldset className="hf-theme-control">
      <legend>Appearance</legend>
      <div className="hf-segmented" role="radiogroup" aria-label="Appearance">
        {OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preference === id}
            onClick={() => {
              saveThemePreference(id);
              setPreference(id);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
