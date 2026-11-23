import assert from 'node:assert/strict';
import { test } from 'node:test';
import { printable, safeFileName } from '../src/safe-name.js';

test('keeps a normal file name', () => {
  assert.equal(safeFileName('10', 'crash-log_v2.txt'), '10_crash-log_v2.txt');
});

test('strips directory traversal', () => {
  assert.equal(safeFileName('10', '../../.ssh/authorized_keys'), '10_authorized_keys');
  assert.equal(safeFileName('10', '..\\..\\evil.bat'), '10_evil.bat');
});

test('removes leading dots and unsafe characters', () => {
  assert.equal(safeFileName('10', '.bashrc'), '10_bashrc');
  assert.equal(safeFileName('10', 'ảnh lỗi $(rm).png'), '10__nh_l_i___rm_.png');
});

test('falls back when nothing is left', () => {
  assert.equal(safeFileName('10', '...'), '10_attachment');
  assert.equal(safeFileName('10', undefined), '10_attachment');
});

test('caps the length and keeps the extension', () => {
  const name = safeFileName('10', `${'a'.repeat(500)}.mp4`);
  assert.ok(name.length <= 3 + 120);
  assert.ok(name.endsWith('.mp4'));
});

test('printable neutralises terminal escape sequences', () => {
  assert.equal(printable('a\u001b[31mb\n'), 'a?[31mb?');
});
