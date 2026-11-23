import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { main } from '../src/cli.js';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

async function run(argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    stores: { byId: () => assert.fail('no store expected'), candidates: () => [] },
  });
  return { code, out, err };
}

test('--version prints the package version', async () => {
  assert.deepEqual(await run(['--version']), { code: 0, out: `${version}\n`, err: '' });
});

test('-V is the short form of --version', async () => {
  assert.deepEqual(await run(['-V']), { code: 0, out: `${version}\n`, err: '' });
});

test('--version wins over a command', async () => {
  assert.deepEqual(await run(['list', 'PROJ-1', '--version']), { code: 0, out: `${version}\n`, err: '' });
});

test('help lists the version flag', async () => {
  assert.match((await run(['--help'])).out, /jat --version/);
});
