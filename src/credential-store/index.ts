import { configDir } from '../config.js';
import { createDpapiStore } from './dpapi.js';
import { StoreUnavailableError } from './errors.js';
import { createFileStore } from './file.js';
import { createKeychainStore } from './keychain.js';
import { runTool } from './run.js';
import { createSecretServiceStore } from './secret-service.js';
import { errorMessage } from '../error-info.js';
import type { CredentialStore, CredentialStores, ReadPolicy, StoreDeps } from './types.js';

export type { CredentialStore, CredentialStores } from './types.js';

const BACKENDS: Record<string, (deps: StoreDeps) => CredentialStore> = {
  keychain: createKeychainStore,
  'secret-service': createSecretServiceStore,
  file: createFileStore,
  dpapi: createDpapiStore,
};

const CANDIDATES_BY_PLATFORM: Record<string, string[]> = {
  darwin: ['keychain'],
  linux: ['secret-service', 'file'],
  win32: ['dpapi'],
};

interface StoresOptions extends Partial<StoreDeps> {
  platform?: string;
}

export function createStores({
  env = process.env,
  platform = process.platform,
  run = runTool,
  dir = configDir(env),
}: StoresOptions = {}): CredentialStores {
  const deps: StoreDeps = { run, dir, env };

  function byId(id: string): CredentialStore {
    const create = Object.hasOwn(BACKENDS, id) ? BACKENDS[id] : null;
    if (!create) throw new Error(`Unknown credential store: ${id}`);
    return create(deps);
  }

  return {
    byId,
    candidates() {
      const ids = Object.hasOwn(CANDIDATES_BY_PLATFORM, platform) ? CANDIDATES_BY_PLATFORM[platform] : null;
      if (!ids) throw new Error(`Unsupported platform: ${platform}`);
      return ids.map(byId);
    },
  };
}

export const LEGACY_STORE = 'keychain';

export interface SkippedStore {
  store: CredentialStore;
  reason: string;
}

export async function storeWithFallback(
  candidates: CredentialStore[],
  account: string,
  token: string,
  options: Partial<ReadPolicy>,
): Promise<{ store: CredentialStore; skipped: SkippedStore[] }> {
  const skipped: SkippedStore[] = [];
  for (const store of candidates) {
    try {
      await store.store(account, token, options);
      return { store, skipped };
    } catch (error) {
      if (!(error instanceof StoreUnavailableError)) throw new Error(`Could not store the token in ${store.label}: ${errorMessage(error)}`);
      skipped.push({ store, reason: errorMessage(error) });
    }
  }
  const reasons = skipped.map(({ store, reason }) => `${store.label}: ${reason}`).join('; ');
  throw new Error(`Could not store the token (${reasons})`);
}
