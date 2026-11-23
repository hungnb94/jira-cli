import { parseArgs, type ParseArgsConfig } from 'node:util';

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

export function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

// Derived from the same parse() call main() uses, so the command handlers' type cannot drift from it.
export type Values = ReturnType<typeof parse>['values'];

export interface Io {
  out(line: string): void;
  err(line: string): void;
}
