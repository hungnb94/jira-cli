import { printable } from './safe-name.js';

export const MAX_DETAIL_CHARS = 300;
const MAX_BODY_BYTES = 16 * 1024;

interface JiraErrorBody {
  message?: unknown;
  errorMessages?: unknown;
  errors?: unknown;
}

export async function readErrorDetail(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.includes('json')) {
    await response.body?.cancel();
    return undefined;
  }
  const text = await readCapped(response, MAX_BODY_BYTES);
  if (text === undefined) return undefined;
  try {
    const messages = messagesOf(JSON.parse(text) as JiraErrorBody);
    return messages.length > 0 ? printable(messages.join('; ')).slice(0, MAX_DETAIL_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

function messagesOf({ message, errorMessages, errors }: JiraErrorBody): string[] {
  const candidates = [
    message,
    ...(Array.isArray(errorMessages) ? errorMessages : []),
    ...(errors && typeof errors === 'object' ? Object.values(errors) : []),
  ];
  return candidates.filter((m): m is string => typeof m === 'string' && m.length > 0);
}

async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
