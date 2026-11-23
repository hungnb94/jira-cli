import { join, win32 } from 'node:path';
import { assertSafe } from './account.js';
import { readJsonFile, removeFile, replacePrivateJsonFile } from './json-file.js';

const POWERSHELL_TIMEOUT_MS = 30_000;
const BLOB = /^[0-9a-f]+$/i;

const PROTECT = [
  '$plain = [Console]::In.ReadToEnd().Trim()',
  '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
  'ConvertFrom-SecureString -SecureString $secure',
].join('; ');

const UNPROTECT = [
  '$blob = [Console]::In.ReadToEnd().Trim()',
  '$secure = ConvertTo-SecureString -String $blob',
  '[System.Net.NetworkCredential]::new("", $secure).Password',
].join('; ');

export function createDpapiStore({ run, dir, env }) {
  const path = join(dir, 'token.dpapi.json');
  const powershell = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  function runScript(script, input) {
    return run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      input,
      timeout: POWERSHELL_TIMEOUT_MS,
    });
  }

  async function blobFor(account) {
    assertSafe('account', account);
    const data = await readJsonFile(path);
    return data?.account === account && typeof data.blob === 'string' && BLOB.test(data.blob) ? data.blob : null;
  }

  return {
    id: 'dpapi',
    label: `DPAPI-encrypted file ${path}`,
    silentRead: () => true,

    async read(account) {
      const blob = await blobFor(account);
      if (!blob) throw new Error(`No token in ${path}. Run: jat auth login`);
      const { code, stdout } = await runScript(UNPROTECT, blob);
      const token = stdout.trim();
      if (code !== 0 || !token) {
        throw new Error(
          `Could not decrypt the token (PowerShell exit ${code}); it only works for the Windows user who ran jat auth login. Run: jat auth login`,
        );
      }
      return token;
    },

    async has(account) {
      return Boolean(await blobFor(account));
    },

    async store(account, token) {
      assertSafe('account', account);
      assertSafe('token', token);
      const { code, stdout } = await runScript(PROTECT, token);
      const blob = stdout.trim();
      if (code !== 0 || !BLOB.test(blob)) throw new Error(`PowerShell could not encrypt the token (exit ${code})`);
      await replacePrivateJsonFile(path, { account, blob });
    },

    async delete(account) {
      if (!(await blobFor(account))) return false;
      await removeFile(path);
      return true;
    },
  };
}
