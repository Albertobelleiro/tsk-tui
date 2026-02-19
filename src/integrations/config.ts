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
        accessToken: options.token ?? options["api-key"] ?? options.apiKey ?? "",
        projectFilter: options.project,
        projectId: options.projectId,
      };
      break;
    case "linear":
      config.integrations.linear = {
        accessToken: options.token ?? options["api-key"] ?? options.apiKey ?? "",
        teamId: options.team,
        projectId: options.projectId,
      };
      break;
    case "asana":
      config.integrations.asana = {
        accessToken: options.token ?? "",
        workspaceId: options.workspace,
        projectId: options.projectId,
      };
      break;
    case "github-issues":
      config.integrations.github = {
        accessToken: options.token,
        repo: options.repo ?? "",
        useGhCli: options.useGhCli === "true",
      };
      break;
    case "claude-code":
    case "codex":
      config.integrations.agent = {
        enabled: true,
        pollIntervalMs: Number.parseInt(options.pollIntervalMs ?? "2000", 10) || 2000,
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
      delete config.integrations.agent;
      break;
  }

  await saveConfig(config);
}

export async function getIntegrationStatus(): Promise<Array<{ name: string; connected: boolean }>> {
  const config = await loadConfig();
  return [
    { name: "todoist", connected: !!config.integrations.todoist?.accessToken },
    { name: "linear", connected: !!config.integrations.linear?.accessToken },
    { name: "asana", connected: !!config.integrations.asana?.accessToken },
    { name: "github", connected: !!config.integrations.github?.repo && (!!config.integrations.github?.accessToken || !!config.integrations.github?.useGhCli) },
    { name: "agent", connected: !!config.integrations.agent?.enabled },
  ];
}
