import { assertSafe } from './account.js';

const SECRET_TOOL = 'secret-tool';
const SERVICE = 'jat-jira-token';
const LABEL = 'jat Jira API token';
const UNLOCK_PROMPT_TIMEOUT_MS = 120_000;

export function createSecretServiceStore({ run }) {
  async function secretTool(args, options) {
    try {
      return await run(SECRET_TOOL, args, options);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('secret-tool is not installed (package libsecret-tools)');
      throw error;
    }
  }

  async function lookup(account) {
    assertSafe('account', account);
    const { code, stdout } = await secretTool(['lookup', 'service', SERVICE, 'account', account], {
      timeout: UNLOCK_PROMPT_TIMEOUT_MS,
    });
    return code === 0 ? stdout.trim() : '';
  }

  return {
    id: 'secret-service',
    label: 'Secret Service keyring',
    silentRead: () => true,

    async read(account) {
      const token = await lookup(account);
      if (!token) throw new Error('No token in the Secret Service keyring, or the keyring is locked or not running. Run: jat auth login');
      return token;
    },

    async has(account) {
      return Boolean(await lookup(account));
    },

    async store(account, token) {
      assertSafe('account', account);
      assertSafe('token', token);
      const { code } = await secretTool(['store', `--label=${LABEL}`, 'service', SERVICE, 'account', account], {
        input: token,
        timeout: UNLOCK_PROMPT_TIMEOUT_MS,
      });
      if (code !== 0) throw new Error(`secret-tool store failed (exit ${code}); is a keyring daemon running?`);
      if ((await lookup(account)) !== token) throw new Error('the keyring did not store the token');
    },

    async delete(account) {
      if (!(await lookup(account))) return false;
      const { code } = await secretTool(['clear', 'service', SERVICE, 'account', account]);
      if (code !== 0) throw new Error(`secret-tool clear failed (exit ${code})`);
      return true;
    },
  };
}
