import { dirname } from 'node:path';
import { configPath } from '../config.js';
import { createDpapiStore } from './dpapi.js';
import { StoreUnavailableError } from './errors.js';
import { createFileStore } from './file.js';
import { createKeychainStore } from './keychain.js';
import { runTool } from './run.js';
import { createSecretServiceStore } from './secret-service.js';

const BACKENDS = {
  keychain: createKeychainStore,
  'secret-service': createSecretServiceStore,
  file: createFileStore,
  dpapi: createDpapiStore,
};

const CANDIDATES_BY_PLATFORM = {
  darwin: ['keychain'],
  linux: ['secret-service', 'file'],
  win32: ['dpapi'],
};

export function createStores({ platform = process.platform, run = runTool, dir = dirname(configPath()), env = process.env } = {}) {
  const deps = { run, dir, env };

  function byId(id) {
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

export async function storeWithFallback(candidates, account, token, options) {
  const skipped = [];
  for (const store of candidates) {
    try {
      await store.store(account, token, options);
      return { store, skipped };
    } catch (error) {
      if (!(error instanceof StoreUnavailableError)) throw new Error(`Could not store the token in ${store.label}: ${error.message}`);
      skipped.push({ store, reason: error.message });
    }
  }
  const reasons = skipped.map(({ store, reason }) => `${store.label}: ${reason}`).join('; ');
  throw new Error(`Could not store the token (${reasons})`);
}
