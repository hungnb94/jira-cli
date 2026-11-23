import { join } from 'node:path';
import { assertSafe } from './account.js';
import { createAccountFile } from './json-file.js';

export function createFileStore({ dir }) {
  const path = join(dir, 'token.json');
  const file = createAccountFile(path);

  async function tokenFor(account) {
    assertSafe('account', account);
    return file.get(account);
  }

  return {
    id: 'file',
    label: `plaintext file ${path}`,
    silentRead: () => true,

    async read(account) {
      const token = await tokenFor(account);
      if (!token) throw new Error(`No token in ${path}. Run: jat auth login`);
      return token;
    },

    async has(account) {
      return Boolean(await tokenFor(account));
    },

    async store(account, token) {
      assertSafe('account', account);
      assertSafe('token', token);
      await file.set(account, token);
    },

    async delete(account) {
      assertSafe('account', account);
      return file.remove(account);
    },
  };
}
