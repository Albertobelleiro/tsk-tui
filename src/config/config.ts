import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".tsk");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ── Theme names ──────────────────────────────────────

export type ThemeName = "tokyo-night" | "catppuccin" | "gruvbox" | "nord" | "dracula" | "solarized-dark";

// ── Config interface ─────────────────────────────────

export interface TskConfig {
  theme: ThemeName;
  dataDir: string;
  autoSaveDebounceMs: number;
  undoHistorySize: number;

  keybindings: Record<string, string>;

  integrations: {
    todoist?: { apiKey: string; projectFilter?: string; autoSync?: boolean; syncIntervalMinutes?: number };
    linear?: { apiKey: string; teamId?: string; autoSync?: boolean };
    asana?: { token: string; workspaceId?: string; projectId?: string; autoSync?: boolean };
    github?: { repo: string; useGhCli?: boolean };
    agent?: { enabled: boolean; pollIntervalMs?: number };
  };

  display: {
    showClock: boolean;
    showSubtaskProgress: boolean;
    compactMode: boolean;
    dateFormat: "relative" | "absolute" | "iso";
  };
}

// ── Defaults ─────────────────────────────────────────

export const DEFAULT_CONFIG: TskConfig = {
  theme: "tokyo-night",
  dataDir: CONFIG_DIR,
  autoSaveDebounceMs: 300,
  undoHistorySize: 50,
  keybindings: {},
  integrations: {},
  display: {
    showClock: true,
    showSubtaskProgress: true,
    compactMode: false,
    dateFormat: "relative",
  },
};

// ── Config manager ───────────────────────────────────

let _cached: TskConfig | null = null;

export async function loadConfig(): Promise<TskConfig> {
  if (_cached) return _cached;
  await mkdir(CONFIG_DIR, { recursive: true });
  const file = Bun.file(CONFIG_FILE);
  if (!(await file.exists())) {
    _cached = { ...DEFAULT_CONFIG };
    return _cached;
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<TskConfig>;
    _cached = mergeConfig(parsed);
    return _cached;
  } catch {
    _cached = { ...DEFAULT_CONFIG };
    return _cached;
  }
}

export async function saveConfig(config: TskConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
  _cached = config;
}

export async function getConfigValue(key: string): Promise<unknown> {
  const config = await loadConfig();
  return getNestedValue(config as unknown as Record<string, unknown>, key);
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  const config = await loadConfig();
  setNestedValue(config as unknown as Record<string, unknown>, key, parseValue(value));
  await saveConfig(config);
}

export async function resetConfig(): Promise<void> {
  await saveConfig({ ...DEFAULT_CONFIG });
}

// ── Helpers ──────────────────────────────────────────

function mergeConfig(partial: Partial<TskConfig>): TskConfig {
  return {
    theme: partial.theme ?? DEFAULT_CONFIG.theme,
    dataDir: partial.dataDir ?? DEFAULT_CONFIG.dataDir,
    autoSaveDebounceMs: partial.autoSaveDebounceMs ?? DEFAULT_CONFIG.autoSaveDebounceMs,
    undoHistorySize: partial.undoHistorySize ?? DEFAULT_CONFIG.undoHistorySize,
    keybindings: { ...DEFAULT_CONFIG.keybindings, ...partial.keybindings },
    integrations: { ...DEFAULT_CONFIG.integrations, ...partial.integrations },
    display: { ...DEFAULT_CONFIG.display, ...partial.display },
  };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

function parseValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== "") return num;
  return val;
}
