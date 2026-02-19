import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentConfig,
  AsanaConfig,
  GitHubConfig,
  LinearConfig,
  ThemeName,
  TodoistConfig,
  TskConfig,
} from "./types.ts";

const CONFIG_DIR = join(homedir(), ".tsk");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

type PartialConfig = Omit<Partial<TskConfig>, "sync" | "display" | "integrations"> & {
  sync?: Partial<TskConfig["sync"]>;
  display?: Partial<TskConfig["display"]>;
  integrations?: Partial<TskConfig["integrations"]>;
};

function parseLegacyConfig(parsed: unknown): PartialConfig {
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;

  const integrations = (obj.integrations && typeof obj.integrations === "object"
    ? obj.integrations as Record<string, unknown>
    : {}) as Record<string, unknown>;

  const todoistRaw = integrations.todoist as Record<string, unknown> | undefined;
  const linearRaw = integrations.linear as Record<string, unknown> | undefined;
  const asanaRaw = integrations.asana as Record<string, unknown> | undefined;
  const githubRaw = integrations.github as Record<string, unknown> | undefined;
  const agentRaw = integrations.agent as Record<string, unknown> | undefined;

  const todoist: TodoistConfig | undefined = todoistRaw
    ? {
      accessToken: String(todoistRaw.accessToken ?? todoistRaw.apiKey ?? ""),
      refreshToken: typeof todoistRaw.refreshToken === "string" ? todoistRaw.refreshToken : undefined,
      projectFilter: typeof todoistRaw.projectFilter === "string" ? todoistRaw.projectFilter : undefined,
      projectId: typeof todoistRaw.projectId === "string" ? todoistRaw.projectId : undefined,
    }
    : undefined;

  const linear: LinearConfig | undefined = linearRaw
    ? {
      accessToken: String(linearRaw.accessToken ?? linearRaw.apiKey ?? ""),
      teamId: typeof linearRaw.teamId === "string" ? linearRaw.teamId : undefined,
      teamName: typeof linearRaw.teamName === "string" ? linearRaw.teamName : undefined,
      projectId: typeof linearRaw.projectId === "string" ? linearRaw.projectId : undefined,
      stateMapping: linearRaw.stateMapping && typeof linearRaw.stateMapping === "object"
        ? linearRaw.stateMapping as Record<string, string>
        : undefined,
    }
    : undefined;

  const asana: AsanaConfig | undefined = asanaRaw
    ? {
      accessToken: String(asanaRaw.accessToken ?? asanaRaw.token ?? ""),
      refreshToken: typeof asanaRaw.refreshToken === "string" ? asanaRaw.refreshToken : undefined,
      tokenExpiresAt: typeof asanaRaw.tokenExpiresAt === "string" ? asanaRaw.tokenExpiresAt : undefined,
      workspaceId: typeof asanaRaw.workspaceId === "string" ? asanaRaw.workspaceId : undefined,
      workspaceName: typeof asanaRaw.workspaceName === "string" ? asanaRaw.workspaceName : undefined,
      projectId: typeof asanaRaw.projectId === "string" ? asanaRaw.projectId : undefined,
      projectName: typeof asanaRaw.projectName === "string" ? asanaRaw.projectName : undefined,
    }
    : undefined;

  const github: GitHubConfig | undefined = githubRaw
    ? {
      accessToken: typeof githubRaw.accessToken === "string" ? githubRaw.accessToken : undefined,
      repo: String(githubRaw.repo ?? ""),
      useGhCli: typeof githubRaw.useGhCli === "boolean" ? githubRaw.useGhCli : undefined,
      labelFilter: Array.isArray(githubRaw.labelFilter)
        ? githubRaw.labelFilter.map(String)
        : undefined,
    }
    : undefined;

  const agent: AgentConfig | undefined = agentRaw
    ? {
      enabled: Boolean(agentRaw.enabled),
      pollIntervalMs: typeof agentRaw.pollIntervalMs === "number" ? agentRaw.pollIntervalMs : 2000,
    }
    : undefined;

  const displayRaw = (obj.display && typeof obj.display === "object"
    ? obj.display
    : {}) as Record<string, unknown>;
  const syncRaw = (obj.sync && typeof obj.sync === "object"
    ? obj.sync
    : {}) as Record<string, unknown>;

  return {
    version: obj.version === 1 ? 1 : undefined,
    theme: typeof obj.theme === "string" ? obj.theme : undefined,
    integrations: {
      ...(todoist && todoist.accessToken ? { todoist } : {}),
      ...(linear && linear.accessToken ? { linear } : {}),
      ...(asana && asana.accessToken ? { asana } : {}),
      ...(github && github.repo ? { github } : {}),
      ...(agent ? { agent } : {}),
    },
    sync: {
      autoSyncEnabled: typeof syncRaw.autoSyncEnabled === "boolean" ? syncRaw.autoSyncEnabled : undefined,
      autoSyncIntervalMinutes: typeof syncRaw.autoSyncIntervalMinutes === "number" ? syncRaw.autoSyncIntervalMinutes : undefined,
      conflictStrategy:
        syncRaw.conflictStrategy === "remote-wins" ||
        syncRaw.conflictStrategy === "local-wins" ||
        syncRaw.conflictStrategy === "newest-wins"
          ? syncRaw.conflictStrategy
          : undefined,
      syncOnStartup: typeof syncRaw.syncOnStartup === "boolean" ? syncRaw.syncOnStartup : undefined,
    } as Partial<TskConfig["sync"]>,
    display: {
      showSyncStatus: typeof displayRaw.showSyncStatus === "boolean" ? displayRaw.showSyncStatus : undefined,
      showClock: typeof displayRaw.showClock === "boolean" ? displayRaw.showClock : undefined,
      dateFormat:
        displayRaw.dateFormat === "relative" ||
        displayRaw.dateFormat === "absolute" ||
        displayRaw.dateFormat === "iso"
          ? displayRaw.dateFormat
          : undefined,
    } as Partial<TskConfig["display"]>,
  };
}

function mergeConfig(partial: PartialConfig): TskConfig {
  const defaults = ConfigManager.defaults();
  return {
    version: 1,
    theme: typeof partial.theme === "string" ? partial.theme : defaults.theme,
    integrations: {
      ...(defaults.integrations ?? {}),
      ...(partial.integrations ?? {}),
    },
    sync: {
      ...defaults.sync,
      ...(partial.sync ?? {}),
    },
    display: {
      ...defaults.display,
      ...(partial.display ?? {}),
    },
  };
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

function ensureValidConfig(config: TskConfig): void {
  if (config.version !== 1) {
    throw new Error("Invalid config version");
  }
  if (!config.sync || !config.display || !config.integrations) {
    throw new Error("Invalid config shape");
  }
  if (!["remote-wins", "local-wins", "newest-wins"].includes(config.sync.conflictStrategy)) {
    throw new Error("Invalid sync.conflictStrategy");
  }
  if (!["relative", "absolute", "iso"].includes(config.display.dateFormat)) {
    throw new Error("Invalid display.dateFormat");
  }
}

function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setPathValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".").filter(Boolean);
  if (keys.length === 0) return;
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const existing = current[k];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

export class ConfigManager {
  private static _configPath = CONFIG_FILE;
  private static _cached: TskConfig | null = null;

  static get path(): string {
    return this._configPath;
  }

  static defaults(): TskConfig {
    return {
      version: 1,
      theme: "tokyo-night",
      integrations: {},
      sync: {
        autoSyncEnabled: false,
        autoSyncIntervalMinutes: 5,
        conflictStrategy: "newest-wins",
        syncOnStartup: false,
      },
      display: {
        showSyncStatus: true,
        showClock: true,
        dateFormat: "relative",
      },
    };
  }

  static async load(): Promise<TskConfig> {
    if (this._cached) return deepClone(this._cached);

    await mkdir(CONFIG_DIR, { recursive: true });
    const file = Bun.file(this._configPath);
    if (!(await file.exists())) {
      const defaults = this.defaults();
      this._cached = defaults;
      await this.save(defaults);
      return deepClone(defaults);
    }

    try {
      const text = await file.text();
      const parsed = text.trim() ? JSON.parse(text) : {};
      const merged = mergeConfig(parseLegacyConfig(parsed));
      ensureValidConfig(merged);
      this._cached = merged;
      return deepClone(merged);
    } catch {
      const fallback = this.defaults();
      this._cached = fallback;
      return deepClone(fallback);
    }
  }

  static async save(config: TskConfig): Promise<void> {
    const merged = mergeConfig(config);
    ensureValidConfig(merged);

    await mkdir(CONFIG_DIR, { recursive: true });
    const clean = stripUndefined(merged);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tmpPath = `${this._configPath}.tmp-${suffix}`;
    await Bun.write(tmpPath, JSON.stringify(clean, null, 2));

    try {
      await chmod(tmpPath, 0o600);
      await rename(tmpPath, this._configPath);
      await chmod(this._configPath, 0o600);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this._cached = deepClone(merged);
  }

  static async get<K extends keyof TskConfig>(key: K): Promise<TskConfig[K]> {
    const config = await this.load();
    return config[key];
  }

  static async set<K extends keyof TskConfig>(key: K, value: TskConfig[K]): Promise<void> {
    const config = await this.load();
    config[key] = value;
    await this.save(config);
  }

  static async getIntegration<K extends keyof TskConfig["integrations"]>(
    name: K,
  ): Promise<TskConfig["integrations"][K]> {
    const config = await this.load();
    return config.integrations[name];
  }

  static async setIntegration<K extends keyof TskConfig["integrations"]>(
    name: K,
    value: NonNullable<TskConfig["integrations"][K]>,
  ): Promise<void> {
    const config = await this.load();
    config.integrations[name] = value;
    await this.save(config);
  }

  static async removeIntegration(name: keyof TskConfig["integrations"]): Promise<void> {
    const config = await this.load();
    delete config.integrations[name];
    await this.save(config);
  }
}

export async function loadConfig(): Promise<TskConfig> {
  return ConfigManager.load();
}

export async function saveConfig(config: TskConfig): Promise<void> {
  await ConfigManager.save(config);
}

export async function getConfigValue(key: string): Promise<unknown> {
  const config = await ConfigManager.load();
  return getPathValue(config as unknown as Record<string, unknown>, key);
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  const config = await ConfigManager.load();
  setPathValue(config as unknown as Record<string, unknown>, key, value);
  await ConfigManager.save(config);
}

export async function resetConfig(): Promise<void> {
  await ConfigManager.save(ConfigManager.defaults());
}

export function getConfigPath(): string {
  return ConfigManager.path;
}

export function parseConfigValue(val: string): unknown {
  const trimmed = val.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return val;
    }
  }
  return val;
}

function maskKeyName(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered.includes("token") || lowered.includes("apikey") || lowered.includes("api_key") || lowered.includes("secret");
}

export function maskSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSecrets(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (maskKeyName(k) && v != null) {
        out[k] = "****";
      } else {
        out[k] = maskSecrets(v);
      }
    }
    return out as T;
  }
  return value;
}

export type { ThemeName, TskConfig } from "./types.ts";
