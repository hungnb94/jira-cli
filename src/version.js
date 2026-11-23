import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function packageVersion() {
  return require('../package.json').version;
}
