const MAX_NAME_LENGTH = 120;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export function safeFileName(id, filename) {
  const base = String(filename ?? '').split(/[\\/]/).pop();
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(-MAX_NAME_LENGTH);
  return `${id}_${cleaned || 'attachment'}`;
}

export function printable(text) {
  return String(text ?? '').replace(CONTROL_CHARS, '?');
}
