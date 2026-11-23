import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafe } from './account.js';

export function createFileStore({ dir }) {
  const path = join(dir, 'token.json');

  async function load() {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Could not read ${path}: ${error.message}`);
    }
  }

  async function tokenFor(account) {
    assertSafe('account', account);
    const data = await load();
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
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // writeFile's mode only applies to new files, so replace instead of overwriting in place.
      await rm(path, { force: true });
      await writeFile(path, `${JSON.stringify({ account, token })}\n`, { mode: 0o600, flag: 'wx' });
    },

    async delete(account) {
      if (!(await tokenFor(account))) return false;
      await rm(path, { force: true });
      return true;
    },
  };
}
