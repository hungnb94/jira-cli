import { spawn } from 'node:child_process';

export function runTool(command, args, { input, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], timeout, windowsHide: true });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code: signal ? null : code, stdout }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
