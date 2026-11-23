const SAFE_VALUE = /^[A-Za-z0-9._@+=/-]+$/;

export function assertSafe(label, value) {
  if (typeof value !== 'string' || !SAFE_VALUE.test(value)) throw new Error(`${label} contains unsupported characters`);
}
