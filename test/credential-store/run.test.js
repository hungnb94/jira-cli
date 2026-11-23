import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTool } from '../../src/credential-store/run.js';

const NODE = process.execPath;

test('passes input on stdin and returns stdout, stderr and the exit code', async () => {
  const script = 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(d.toUpperCase());process.stderr.write("warn");process.exit(3)})';
  assert.deepEqual(await runTool(NODE, ['-e', script], { input: 'secret' }), { code: 3, stdout: 'SECRET', stderr: 'warn' });
});

test('a timed-out process has no exit code', async () => {
  const result = await runTool(NODE, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 100 });
  assert.equal(result.code, null);
});

test('a missing binary rejects with ENOENT', async () => {
  await assert.rejects(runTool('jat-no-such-binary', []), { code: 'ENOENT' });
});
