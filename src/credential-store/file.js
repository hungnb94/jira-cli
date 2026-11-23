import { join } from 'node:path';
import { assertSafe } from './account.js';
import { readJsonFile, removeFile, replacePrivateJsonFile } from './json-file.js';

export function createFileStore({ dir }) {
  const path = join(dir, 'token.json');

  async function tokenFor(account) {
    assertSafe('account', account);
    const data = await readJsonFile(path);
    return data?.account === account && typeof data.token === 'string' ? data.token : null;
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
      await replacePrivateJsonFile(path, { account, token });
    },

    async delete(account) {
      if (!(await tokenFor(account))) return false;
      await removeFile(path);
      return true;
    },
  };
}
