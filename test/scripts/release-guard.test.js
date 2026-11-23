import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as guard from '../../scripts/release-guard.mjs';

const commit = (subject, labels = []) => ({ sha: 'abcdef1234567', subject, labels });

describe('unreleasedChanges', () => {
  test('lists commits whose type needs a release', () => {
    const changes = guard.unreleasedChanges([
      commit('feat(cli): add list --json (#18)'),
      commit('docs: update README (#19)'),
      commit('fix: handle 403 (#20)'),
    ]);
    assert.deepEqual(
      changes.map((c) => c.subject),
      ['feat(cli): add list --json (#18)', 'fix: handle 403 (#20)'],
    );
  });

  test('returns nothing for non-releasing types or no commits', () => {
    assert.deepEqual(guard.unreleasedChanges([commit('ci: add workflow'), commit('chore: tidy')]), []);
    assert.deepEqual(guard.unreleasedChanges([]), []);
  });

  test('skips a commit whose PR has the skip-release label', () => {
    assert.deepEqual(guard.unreleasedChanges([commit('feat: x', ['skip-release'])]), []);
  });

  test('reads a BREAKING CHANGE footer from the commit body', () => {
    const changes = guard.unreleasedChanges([
      { ...commit('fix: drop flag (#20)'), body: '* fix: drop flag\n\nBREAKING CHANGE: removed --x' },
    ]);
    assert.match(guard.formatFailure('1.2.0', changes), /2\.0\.0 \(major\)/);
  });

  test('ignores subjects that are not Conventional Commits instead of throwing', () => {
    assert.deepEqual(guard.unreleasedChanges([commit('Merge pull request #5 from x/y')]), []);
  });
});

describe('formatFailure', () => {
  test('suggests the largest bump needed', () => {
    const changes = guard.unreleasedChanges([commit('fix: a'), commit('feat: b')]);
    const message = guard.formatFailure('1.3.0', changes);
    assert.match(message, /abcdef1 feat: b/);
    assert.match(message, /1\.4\.0 \(minor\)/);
  });

  test('suggests major for a breaking change', () => {
    const changes = guard.unreleasedChanges([commit('feat!: drop flag')]);
    assert.match(guard.formatFailure('1.3.0', changes), /2\.0\.0 \(major\)/);
  });
});
