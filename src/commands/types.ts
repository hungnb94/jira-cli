import type { ParseArgsConfig, parseArgs } from 'node:util';

export const OPTIONS = {
  site: { type: 'string' },
  email: { type: 'string' },
  'allow-silent-read': { type: 'boolean', default: false },
  out: { type: 'string' },
  filter: { type: 'string' },
  'max-size': { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'V', default: false },
} as const satisfies ParseArgsConfig['options'];

export type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

export interface Io {
  out(line: string): void;
  err(line: string): void;
}
