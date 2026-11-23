import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorCode, errorMessage } from '../error-info.js';

type Accounts = Record<string, string>;

export interface AccountFile {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  remove(account: string): Promise<boolean>;
}

async function replacePrivateJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // writeFile's mode only applies to new files, so write a fresh file and rename it over the old one.
  // The rename is atomic, so a failed write never leaves the old token deleted and no new one stored.
  const temp = `${path}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  try {
    await writeFile(temp, `${JSON.stringify(data)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function createAccountFile(path: string): AccountFile {
  function load(): Promise<Accounts>;
  function load(options: { tolerateCorrupt: true }): Promise<Accounts | null>;
  async function load({ tolerateCorrupt = false } = {}): Promise<Accounts | null> {
    let data: { accounts?: Record<string, unknown> } | null;
    try {
      data = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return Object.create(null) as Accounts;
      if (tolerateCorrupt) return null;
      throw new Error(`Could not read ${path} (${errorMessage(error)}). Run: jat auth logout, then jat auth login`);
    }
    const accounts: Accounts = Object.create(null);
    for (const [account, value] of Object.entries(data?.accounts ?? {})) {
      if (typeof value === 'string') accounts[account] = value;
    }
    return accounts;
  }

  async function save(accounts: Accounts): Promise<void> {
    if (Object.keys(accounts).length === 0) await rm(path, { force: true });
    else await replacePrivateJsonFile(path, { accounts });
  }

  return {
    async get(account) {
      const accounts = await load();
      return Object.hasOwn(accounts, account) ? accounts[account] : null;
    },

    async set(account, value) {
      const accounts = (await load({ tolerateCorrupt: true })) ?? (Object.create(null) as Accounts);
      accounts[account] = value;
      await save(accounts);
    },

    async remove(account) {
      const accounts = await load({ tolerateCorrupt: true });
      if (accounts === null) {
        await rm(path, { force: true });
        return true;
      }
      if (!Object.hasOwn(accounts, account)) return false;
      delete accounts[account];
      await save(accounts);
      return true;
    },
  };
}
