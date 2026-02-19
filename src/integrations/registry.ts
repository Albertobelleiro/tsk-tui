/**
 * Provider registry — lazy-loads integration providers by name.
 *
 * Add new providers here; the sync CLI and sync engine look them up here
 * rather than importing each provider directly.
 */

import type { ExternalSource } from "../store/types.ts";
import type { SyncProvider } from "./types.ts";

type ProviderFactory = () => Promise<SyncProvider>;

const PROVIDER_FACTORIES: Partial<Record<ExternalSource, ProviderFactory>> = {
  todoist: () => import("./todoist.ts").then((m) => m.createTodoistProvider()),
  linear: () => import("./linear.ts").then((m) => m.createLinearProvider()),
  // asana, github-issues registered in future sessions
};

/**
 * Return a connected provider instance for `name`, or null if not configured.
 * Throws if the provider is registered but its config is missing.
 */
export async function getProvider(name: ExternalSource): Promise<SyncProvider | null> {
  const factory = PROVIDER_FACTORIES[name];
  if (!factory) return null;
  try {
    const provider = await factory();
    const connected = await provider.isConnected();
    if (!connected) return null;
    return provider;
  } catch {
    return null;
  }
}

/**
 * Return instances for all providers that are currently connected (have tokens).
 */
export async function getConnectedProviders(): Promise<SyncProvider[]> {
  const results: SyncProvider[] = [];
  for (const factory of Object.values(PROVIDER_FACTORIES)) {
    if (!factory) continue;
    try {
      const provider = await factory();
      if (await provider.isConnected()) {
        results.push(provider);
      }
    } catch {
      // Not configured — skip
    }
  }
  return results;
}

/**
 * List all registered provider names.
 */
export function registeredProviders(): ExternalSource[] {
  return Object.keys(PROVIDER_FACTORIES) as ExternalSource[];
}
