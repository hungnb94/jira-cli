import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSize } from '../src/format.js';

test('formatSize shows sizes under 1 KB in bytes', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(1023), '1023 B');
});

test('formatSize shows sizes under 1 MB in KB with one decimal', () => {
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1048524), '1023.9 KB');
});

test('formatSize shows larger sizes in MB with one decimal', () => {
  assert.equal(formatSize(1024 ** 2), '1.0 MB');
  assert.equal(formatSize(5.25 * 1024 ** 2), '5.3 MB');
  assert.equal(formatSize(3 * 1024 ** 3), '3072.0 MB');
});

test('formatSize switches to MB when the KB value would round up to 1024.0', () => {
  assert.equal(formatSize(1048525), '1.0 MB');
  assert.equal(formatSize(1024 ** 2 - 1), '1.0 MB');
});

test('formatSize shows a question mark for a size that is not finite', () => {
  assert.equal(formatSize(Number.NaN), '?');
  assert.equal(formatSize(Number.POSITIVE_INFINITY), '?');
});
