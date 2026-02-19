import { loadConfig, saveConfig } from "../config/config.ts";
import type { ExternalSource } from "../store/types.ts";

export async function connectIntegration(
  provider: ExternalSource,
  options: Record<string, string>,
): Promise<void> {
  const config = await loadConfig();

  switch (provider) {
    case "todoist":
      config.integrations.todoist = {
        apiKey: options.apiKey ?? options["api-key"] ?? "",
        projectFilter: options.project ?? undefined,
        autoSync: true,
        syncIntervalMinutes: 5,
      };
      break;
    case "linear":
      config.integrations.linear = {
        apiKey: options.apiKey ?? options["api-key"] ?? "",
        teamId: options.team ?? undefined,
        autoSync: true,
      };
      break;
    case "asana":
      config.integrations.asana = {
        token: options.token ?? "",
        workspaceId: options.workspace ?? undefined,
        projectId: options.project ?? undefined,
        autoSync: true,
      };
      break;
    case "github-issues":
      config.integrations.github = {
        repo: options.repo ?? "",
        useGhCli: options.useGhCli === "true",
      };
      break;
    case "claude-code":
    case "codex":
      config.integrations.agent = {
        enabled: true,
        pollIntervalMs: 2000,
      };
      break;
  }

  await saveConfig(config);
}

export async function disconnectIntegration(provider: ExternalSource): Promise<void> {
  const config = await loadConfig();

  switch (provider) {
    case "todoist":
      delete config.integrations.todoist;
      break;
    case "linear":
      delete config.integrations.linear;
      break;
    case "asana":
      delete config.integrations.asana;
      break;
    case "github-issues":
      delete config.integrations.github;
      break;
    case "claude-code":
    case "codex":
      if (config.integrations.agent) {
        config.integrations.agent.enabled = false;
      }
      break;
  }

  await saveConfig(config);
}

export async function getIntegrationStatus(): Promise<Array<{ name: string; connected: boolean }>> {
  const config = await loadConfig();
  return [
    { name: "todoist", connected: !!config.integrations.todoist?.apiKey },
    { name: "linear", connected: !!config.integrations.linear?.apiKey },
    { name: "asana", connected: !!config.integrations.asana?.token },
    { name: "github", connected: !!config.integrations.github?.repo },
    { name: "agent", connected: !!config.integrations.agent?.enabled },
  ];
}
