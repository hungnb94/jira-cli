import { StoreUnavailableError } from '../../src/credential-store/errors.js';
import type { CredentialStore, CredentialStores } from '../../src/credential-store/types.js';

export interface FakeStore extends CredentialStore {
  tokens: Map<string, string>;
}

interface FakeStoreOptions {
  failStore?: boolean;
  unavailable?: boolean;
  silent?: boolean;
}

export function fakeStore(id: string, { failStore = false, unavailable = false, silent = false }: FakeStoreOptions = {}): FakeStore {
  const tokens = new Map<string, string>();
  return {
    id,
    label: `Fake ${id}`,
    tokens,
    silentRead: ({ promptOnRead }) => silent || !promptOnRead,
    async read(account) {
      const token = tokens.get(account);
      if (token === undefined) throw new Error(`No token in ${id}`);
      return token;
    },
    async has(account) {
      return tokens.has(account);
    },
    async store(account, token) {
      if (unavailable) throw new StoreUnavailableError(`${id} is not available`);
      if (failStore) throw new Error(`${id} rejected the token`);
      tokens.set(account, token);
    },
    async delete(account) {
      return tokens.delete(account);
    },
  };
}

export function fakeStores(stores: CredentialStore[]): CredentialStores {
  const byId = new Map(stores.map((s) => [s.id, s]));
  return {
    byId(id) {
      const store = byId.get(id);
      if (!store) throw new Error(`Unknown credential store: ${id}`);
      return store;
    },
    candidates: () => stores,
  };
}
