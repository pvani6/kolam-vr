/**
 * Comfort & accessibility settings, remembered on this device.
 */

export interface Settings {
  highContrast: boolean; // black ground, bright lines, bigger white dots
  bigLines: boolean; // thicker lines and dots
  sound: boolean;
  leftHanded: boolean; // buttons on the left, notebook on the right
  height: number; // raise (+) / lower (-) the drawing ground, in steps of 5 cm
}

const KEY = 'kolam.settings.v1';
const DEFAULTS: Settings = { highContrast: false, bigLines: false, sound: true, leftHanded: false, height: 0 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
