import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as vc from '../../scripts/version-check.mjs';

describe('suggestBump', () => {
  for (const [title, bump] of [
    ['feat(cli): add list --json', 'minor'],
    ['fix: handle 403', 'patch'],
    ['refactor: split modules', 'patch'],
    ['docs: update README', 'skip'],
    ['ci: add release workflow', 'skip'],
    ['feat!: drop node 20', 'major'],
  ]) {
    test(`${title} -> ${bump}`, () => {
      assert.equal(vc.suggestBump({ title }).bump, bump);
    });
  }

  test('treats a BREAKING CHANGE footer as major', () => {
    assert.equal(vc.suggestBump({ title: 'fix: x', body: 'BREAKING CHANGE: removed flag' }).bump, 'major');
  });

  test('ignores BREAKING CHANGE: in the middle of a sentence', () => {
    const body = 'This is not a BREAKING CHANGE: old flags still work.';
    assert.equal(vc.suggestBump({ title: 'feat: x', body }).bump, 'minor');
  });

  test('skips on a skip-release label', () => {
    assert.equal(vc.suggestBump({ title: 'feat: x', labels: '["skip-release"]' }).bump, 'skip');
  });

  test('rejects a title that is not Conventional Commits', () => {
    assert.throws(() => vc.suggestBump({ title: 'Add reviewers' }), /Conventional Commits/);
  });
});

describe('checkVersion', () => {
  const minor = { bump: 'minor', reason: "type 'feat'" };
  const skip = { bump: 'skip', reason: "type 'docs'" };

  test('passes a matching bump and marks it for release', () => {
    const result = vc.checkVersion('1.2.0', '1.3.0', minor);
    assert.equal(result.ok, true);
    assert.equal(result.release, true);
  });

  test('fails when a releasing PR keeps the version', () => {
    const result = vc.checkVersion('1.2.0', '1.2.0', minor);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /not bumped/);
  });

  test('passes an unchanged version for a non-releasing PR', () => {
    const result = vc.checkVersion('1.2.0', '1.2.0', skip);
    assert.equal(result.ok, true);
    assert.equal(result.release, false);
  });

  test('fails a version that skips ahead or goes back', () => {
    assert.equal(vc.checkVersion('1.2.0', '1.4.0', minor).ok, false);
    assert.equal(vc.checkVersion('1.2.0', '1.1.9', minor).ok, false);
  });

  test('fails a non-major bump for a breaking change', () => {
    assert.equal(vc.checkVersion('1.2.0', '1.3.0', { bump: 'major', reason: 'x' }).ok, false);
  });

  test('only warns when the bump differs from the suggestion', () => {
    const result = vc.checkVersion('1.2.0', '1.2.1', minor);
    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 1);
  });
});

describe('resolveBase', () => {
  test('reads tags with or without a v prefix', () => {
    assert.equal(vc.latestTagVersion(['1.0.2', 'v1.1.0', 'foo', '1.0.10']), '1.1.0');
  });

  test('uses the base branch version when it is ahead of the tags', () => {
    assert.equal(vc.resolveBase('1.1.0', '1.2.0'), '1.2.0');
    assert.equal(vc.resolveBase('1.3.0', '1.2.0'), '1.3.0');
    assert.equal(vc.resolveBase(null, '0.1.0'), '0.1.0');
  });
});
