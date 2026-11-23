import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { errorCode, errorMessage } from './error-info.js';
import type { Attachment, JiraClient } from './jira-client.js';
import { safeFileName } from './safe-name.js';

export type DownloadStatus = 'downloaded' | 'exists' | 'skipped' | 'failed';

export interface DownloadResult extends Attachment {
  status: DownloadStatus;
  path?: string;
  reason?: string;
}

export interface DownloadOptions {
  outDir: string;
  filter?: string;
  maxBytes: number;
}

type AttachmentSource = Pick<JiraClient, 'listAttachments' | 'openAttachment'>;

export function selectAttachments(attachments: Attachment[], filter?: string): Attachment[] {
  if (!filter) return attachments;
  const needle = filter.toLowerCase();
  return attachments.filter((a) => String(a.filename).toLowerCase().includes(needle));
}

export async function downloadAttachments(
  client: AttachmentSource,
  key: string,
  { outDir, filter, maxBytes }: DownloadOptions,
): Promise<DownloadResult[]> {
  const selected = selectAttachments(await client.listAttachments(key), filter);
  if (selected.length > 0) await mkdir(outDir, { recursive: true, mode: 0o700 });
  const results: DownloadResult[] = [];
  for (const attachment of selected) {
    results.push(await downloadOne(client, attachment, outDir, maxBytes));
  }
  return results;
}

async function downloadOne(
  client: AttachmentSource,
  attachment: Attachment,
  outDir: string,
  maxBytes: number,
): Promise<DownloadResult> {
  if (attachment.size > maxBytes) {
    return { ...attachment, status: 'skipped', reason: `size ${attachment.size} exceeds limit ${maxBytes}` };
  }
  const path = join(outDir, safeFileName(attachment.id, attachment.filename));
  // Download into a `.part` file and only link it to the final name when complete, so an
  // interrupted run never leaves a truncated file that a later run reports as `exists`.
  const partPath = `${path}.part`;
  let file: FileHandle;
  try {
    if (await pathExists(path)) return { ...attachment, status: 'exists', path };
    await unlink(partPath).catch(() => {});
    file = await open(partPath, 'wx', 0o600);
  } catch (error) {
    return { ...attachment, status: 'failed', reason: errorMessage(error) };
  }
  try {
    const response = await client.openAttachment(attachment.id);
    if (!response.body) throw new Error('empty response body');
    await pipeline(Readable.fromWeb(response.body), byteLimit(maxBytes), file.createWriteStream());
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(partPath).catch(() => {});
    return { ...attachment, status: 'failed', reason: errorMessage(error) };
  }
  try {
    await link(partPath, path);
    return { ...attachment, status: 'downloaded', path };
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return { ...attachment, status: 'exists', path };
    return { ...attachment, status: 'failed', reason: errorMessage(error) };
  } finally {
    await unlink(partPath).catch(() => {});
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

function byteLimit(maxBytes: number): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`download exceeds limit ${maxBytes} bytes`));
      else callback(null, chunk);
    },
  });
}
