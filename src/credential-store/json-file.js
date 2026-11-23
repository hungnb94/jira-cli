import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

export async function replacePrivateJsonFile(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // writeFile's mode only applies to new files, so replace instead of overwriting in place.
  await rm(path, { force: true });
  await writeFile(path, `${JSON.stringify(data)}\n`, { mode: 0o600, flag: 'wx' });
}

export async function removeFile(path) {
  await rm(path, { force: true });
}
