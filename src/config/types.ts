export type ThemeName = "tokyo-night" | "catppuccin" | "gruvbox" | "nord" | "dracula" | "solarized-dark";

export interface TodoistConfig {
  accessToken: string;
  refreshToken?: string;
  projectFilter?: string;
  projectId?: string;
}

export interface LinearConfig {
  accessToken: string;
  refreshToken?: string;
  teamId?: string;
  teamName?: string;
  projectId?: string;
  stateMapping?: Record<string, string>;
}

export interface AsanaConfig {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  workspaceId?: string;
  workspaceName?: string;
  projectId?: string;
  projectName?: string;
}

export interface GitHubConfig {
  accessToken?: string;
  repo: string;
  useGhCli?: boolean;
  labelFilter?: string[];
}

export interface AgentConfig {
  enabled: boolean;
  pollIntervalMs: number;
}

export interface TskConfig {
  version: 1;
  theme: string;
  integrations: {
    todoist?: TodoistConfig;
    linear?: LinearConfig;
    asana?: AsanaConfig;
    github?: GitHubConfig;
    agent?: AgentConfig;
  };
  sync: {
    autoSyncEnabled: boolean;
    autoSyncIntervalMinutes: number;
    conflictStrategy: "remote-wins" | "local-wins" | "newest-wins";
    syncOnStartup: boolean;
  };
  display: {
    showSyncStatus: boolean;
    showClock: boolean;
    dateFormat: "relative" | "absolute" | "iso";
  };
}
