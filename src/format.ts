import type { Io } from './commands/types.js';
import type { DownloadResult } from './download.js';
import { printable } from './safe-name.js';

export function printResults(key: string, results: DownloadResult[], io: Io): void {
  if (results.length === 0) io.out(`${key}: no matching attachments.`);
  for (const r of results) {
    const name = printable(r.filename);
    if (r.status === 'downloaded') io.out(`downloaded  ${r.path}`);
    else if (r.status === 'exists') io.out(`exists      ${r.path}`);
    else io.err(`${r.status.padEnd(11)} ${name}: ${printable(r.reason)}`);
  }
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
