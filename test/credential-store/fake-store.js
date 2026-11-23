import { StoreUnavailableError } from '../../src/credential-store/errors.js';

export function fakeStore(id, { failStore = false, unavailable = false, silent = false } = {}) {
  const tokens = new Map();
  return {
    id,
    label: `Fake ${id}`,
    tokens,
    silentRead: ({ promptOnRead }) => silent || !promptOnRead,
    async read(account) {
      if (!tokens.has(account)) throw new Error(`No token in ${id}`);
      return tokens.get(account);
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

export function fakeStores(stores) {
  const byId = Object.fromEntries(stores.map((s) => [s.id, s]));
  return {
    byId(id) {
      if (!byId[id]) throw new Error(`Unknown credential store: ${id}`);
      return byId[id];
    },
    candidates: () => stores,
  };
}
