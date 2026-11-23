import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function packageVersion(): string {
  return (require('../package.json') as { version: string }).version;
}
