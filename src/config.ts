import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { errorCode } from './error-info.js';

export interface Config {
  site: string;
  email: string;
  apiBase: string;
  store?: string;
  silentRead?: boolean;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'jat');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.JAT_CONFIG || join(configDir(env), 'config.json');
}

export async function loadConfig(path: string): Promise<Config | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Config;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export async function saveConfig(path: string, config: Config): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
