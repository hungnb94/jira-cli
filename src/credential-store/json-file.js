import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  // writeFile's mode only applies to new files, so write a fresh file and rename it over the old one.
  // The rename is atomic, so a failed write never leaves the old token deleted and no new one stored.
  const temp = `${path}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  try {
    await writeFile(temp, `${JSON.stringify(data)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function removeFile(path) {
  await rm(path, { force: true });
}
