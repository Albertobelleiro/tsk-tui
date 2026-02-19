import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExternalSource } from "../store/types.ts";

export interface SyncState {
  lastSyncAt: Partial<Record<ExternalSource, string>>;
  idMap: Record<string, string>;
  reverseIdMap: Record<string, string>;
  deletedLocally: string[];
  deletedRemotely: string[];
  lastPullHashes: Record<string, string>;
}

const DATA_DIR = join(homedir(), ".tsk");
const SYNC_STATE_FILE = join(DATA_DIR, "sync-state.json");

function defaults(): SyncState {
  return {
    lastSyncAt: {},
    idMap: {},
    reverseIdMap: {},
    deletedLocally: [],
    deletedRemotely: [],
    lastPullHashes: {},
  };
}

export class SyncStateManager {
  static defaults(): SyncState {
    return defaults();
  }

  static async load(): Promise<SyncState> {
    await mkdir(DATA_DIR, { recursive: true });
    const file = Bun.file(SYNC_STATE_FILE);
    if (!(await file.exists())) {
      return defaults();
    }

    try {
      const text = await file.text();
      const parsed = text.trim() ? JSON.parse(text) as Partial<SyncState> : {};
      return {
        ...defaults(),
        ...parsed,
        lastSyncAt: { ...defaults().lastSyncAt, ...(parsed.lastSyncAt ?? {}) },
        idMap: { ...defaults().idMap, ...(parsed.idMap ?? {}) },
        reverseIdMap: { ...defaults().reverseIdMap, ...(parsed.reverseIdMap ?? {}) },
        deletedLocally: Array.isArray(parsed.deletedLocally) ? parsed.deletedLocally : [],
        deletedRemotely: Array.isArray(parsed.deletedRemotely) ? parsed.deletedRemotely : [],
        lastPullHashes: { ...defaults().lastPullHashes, ...(parsed.lastPullHashes ?? {}) },
      };
    } catch {
      return defaults();
    }
  }

  static async save(state: SyncState): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tmpPath = `${SYNC_STATE_FILE}.tmp-${suffix}`;
    await Bun.write(tmpPath, JSON.stringify(state, null, 2));

    try {
      await chmod(tmpPath, 0o600);
      await rename(tmpPath, SYNC_STATE_FILE);
      await chmod(SYNC_STATE_FILE, 0o600);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  static addMapping(state: SyncState, localId: string, externalId: string): void {
    state.idMap[localId] = externalId;
    state.reverseIdMap[externalId] = localId;
  }

  static removeMapping(state: SyncState, localId: string): void {
    const externalId = state.idMap[localId];
    if (externalId) {
      delete state.reverseIdMap[externalId];
      delete state.lastPullHashes[externalId];
    }
    delete state.idMap[localId];
  }

  static getLocalId(state: SyncState, externalId: string): string | undefined {
    return state.reverseIdMap[externalId];
  }

  static getExternalId(state: SyncState, localId: string): string | undefined {
    return state.idMap[localId];
  }
}

export function getSyncStatePath(): string {
  return SYNC_STATE_FILE;
}
