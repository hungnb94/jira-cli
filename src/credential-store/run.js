import { spawn } from 'node:child_process';

export function runTool(command, args, { input, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: signal ? null : code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
