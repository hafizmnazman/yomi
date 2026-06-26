import { useState } from "react";
import type { Settings } from "../lib/types";
import { CloseIcon } from "./icons";

interface Props {
  settings: Settings;
  onClose: () => void;
  onSave: (s: Settings) => void;
}

function accelFromEvent(e: React.KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  if (e.metaKey) mods.push("Super");
  if (mods.length === 0) return null; // require at least one modifier
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...mods, key].join("+");
}

export default function SettingsModal({ settings, onClose, onSave }: Props) {
  const [hotkey, setHotkey] = useState(settings.hotkey);
  const [saveFailedScans, setSaveFailed] = useState(settings.saveFailedScans);
  const [capturing, setCapturing] = useState(false);

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="result-head">
          <h3>Settings</h3>
          <button className="btn-icon" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="field-row">
          <label>Snip hotkey</label>
          <input
            className="input"
            value={capturing ? "Press a shortcut..." : hotkey}
            readOnly
            onFocus={() => setCapturing(true)}
            onBlur={() => setCapturing(false)}
            onKeyDown={(e) => {
              e.preventDefault();
              const accel = accelFromEvent(e);
              if (accel) {
                setHotkey(accel);
                setCapturing(false);
                e.currentTarget.blur();
              }
            }}
          />
          <span className="meta">Click and press your combination (needs at least one modifier).</span>
        </div>

        <div className="field-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={saveFailedScans}
              onChange={(e) => setSaveFailed(e.target.checked)}
            />
            Record scans that find nothing
          </label>
        </div>

        <div className="result-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ hotkey, saveFailedScans })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
