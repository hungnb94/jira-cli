import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { errorCode } from './error-info.js';
import { HttpError, type UploadFile } from './jira-client.js';

export const MAX_FILES_PER_REQUEST = 60;

const UPLOAD_ERROR_CAUSES: Record<number, (key: string, detail?: string) => string> = {
  401: (key, detail) =>
    /scope/i.test(detail ?? '')
      ? `the API token lacks the write:jira-work scope needed to attach files to ${key}. ` +
        'Create a token with it and run jat auth login.'
      : 'the API token was rejected (expired, revoked, or missing write:jira-work). ' +
        'Create a new token and run jat auth login.',
  403: (key) =>
    `no permission to attach files to ${key}. The account needs the Browse Projects and Create attachments ` +
    'permissions, and a scoped API token needs write:jira-work (or write:attachment:jira).',
  404: (key) => `${key} was not found, or this account cannot see it.`,
  413: (key) =>
    `a file is larger than the site's attachment size limit, or ${key} has reached its attachment limit.`,
};

export async function openUploadFiles(paths: string[]): Promise<UploadFile[]> {
  if (paths.length === 0) throw new Error('No files to upload');
  if (paths.length > MAX_FILES_PER_REQUEST) {
    throw new Error(`Too many files: ${paths.length}. Jira accepts at most ${MAX_FILES_PER_REQUEST} per upload.`);
  }
  for (const path of paths) {
    const info = await stat(path).catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return undefined;
      throw new Error(`Cannot read ${path}: ${errorCode(error) ?? String(error)}`);
    });
    if (!info) throw new Error(`File not found: ${path}`);
    if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  }
  return Promise.all(paths.map(async (path) => ({ name: basename(path), blob: await openAsBlob(path) })));
}

export function explainUploadError(error: unknown, key: string): unknown {
  if (!(error instanceof HttpError)) return error;
  const cause = UPLOAD_ERROR_CAUSES[error.status];
  return cause ? new Error(`Upload failed: ${cause(key, error.detail)} (${error.message})`) : error;
}
