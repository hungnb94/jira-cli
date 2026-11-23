import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeFileName } from './safe-name.js';

export function selectAttachments(attachments, filter) {
  if (!filter) return attachments;
  const needle = filter.toLowerCase();
  return attachments.filter((a) => String(a.filename).toLowerCase().includes(needle));
}

export async function downloadAttachments(client, key, { outDir, filter, maxBytes }) {
  const selected = selectAttachments(await client.listAttachments(key), filter);
  if (selected.length > 0) await mkdir(outDir, { recursive: true, mode: 0o700 });
  const results = [];
  for (const attachment of selected) {
    results.push(await downloadOne(client, attachment, outDir, maxBytes));
  }
  return results;
}

async function downloadOne(client, attachment, outDir, maxBytes) {
  if (attachment.size > maxBytes) {
    return { ...attachment, status: 'skipped', reason: `size ${attachment.size} exceeds limit ${maxBytes}` };
  }
  const path = join(outDir, safeFileName(attachment.id, attachment.filename));
  // Download into a `.part` file and only link it to the final name when complete, so an
  // interrupted run never leaves a truncated file that a later run reports as `exists`.
  const partPath = `${path}.part`;
  let file;
  try {
    if (await pathExists(path)) return { ...attachment, status: 'exists', path };
    await unlink(partPath).catch(() => {});
    file = await open(partPath, 'wx', 0o600);
  } catch (error) {
    return { ...attachment, status: 'failed', reason: error.message };
  }
  try {
    const response = await client.openAttachment(attachment.id);
    await pipeline(Readable.fromWeb(response.body), byteLimit(maxBytes), file.createWriteStream());
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(partPath).catch(() => {});
    return { ...attachment, status: 'failed', reason: error.message };
  }
  try {
    await link(partPath, path);
    return { ...attachment, status: 'downloaded', path };
  } catch (error) {
    if (error.code === 'EEXIST') return { ...attachment, status: 'exists', path };
    return { ...attachment, status: 'failed', reason: error.message };
  } finally {
    await unlink(partPath).catch(() => {});
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function byteLimit(maxBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error(`download exceeds limit ${maxBytes} bytes`));
      else callback(null, chunk);
    },
  });
}
